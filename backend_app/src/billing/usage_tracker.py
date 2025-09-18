"""
Usage Tracking Service for Pay-As-You-Go Billing
Tracks Bedrock API usage, tool calls, and other service consumption
"""

import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, Any, List, Optional

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

class UsageTracker:
    """Tracks user usage for billing purposes"""
    
    def __init__(self):
        self.dynamodb = boto3.resource('dynamodb')
        self.usage_table = self.dynamodb.Table(os.environ['USER_USAGE_TABLE_NAME'])
        self.credits_table = self.dynamodb.Table(os.environ['USER_CREDITS_TABLE_NAME'])
        self.transactions_table = self.dynamodb.Table(os.environ['BILLING_TRANSACTIONS_TABLE_NAME'])
        
        # Pricing configuration (in cents)
        self.pricing = {
            'bedrock_input_tokens': 0.0003,  # $0.003 per 1K tokens
            'bedrock_output_tokens': 0.0015,  # $0.015 per 1K tokens
            'tool_call': 0.001,  # $0.001 per tool call
            'stock_data_fetch': 0.002,  # $0.002 per stock data request
            'portfolio_analysis': 0.005,  # $0.005 per portfolio analysis
            'chat_message': 0.01,  # $0.01 per chat message
        }
    
    def track_bedrock_usage(self, user_id: str, input_tokens: int, output_tokens: int, 
                          model: str = "claude-3-sonnet") -> Dict[str, Any]:
        """Track Bedrock API usage and calculate cost"""
        try:
            # Calculate costs
            input_cost = (input_tokens / 1000) * self.pricing['bedrock_input_tokens']
            output_cost = (output_tokens / 1000) * self.pricing['bedrock_output_tokens']
            total_cost = input_cost + output_cost
            
            # Create usage record
            usage_record = {
                'user_id': user_id,
                'usage_id': f"bedrock_{int(time.time())}_{uuid.uuid4().hex[:8]}",
                'service_type': 'bedrock',
                'timestamp': int(time.time()),
                'details': {
                    'model': model,
                    'input_tokens': input_tokens,
                    'output_tokens': output_tokens,
                    'input_cost': round(input_cost, 4),
                    'output_cost': round(output_cost, 4),
                    'total_cost': round(total_cost, 4)
                },
                'expires_at': int(time.time()) + (90 * 24 * 60 * 60)  # 90 days TTL
            }
            
            # Store usage record
            self.usage_table.put_item(Item=usage_record)
            
            # Deduct from user credits
            self._deduct_credits(user_id, total_cost, 'bedrock_usage', usage_record['usage_id'])
            
            return {
                'success': True,
                'cost': total_cost,
                'usage_id': usage_record['usage_id']
            }
            
        except Exception as e:
            logger.error(f"Error tracking Bedrock usage: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    def track_tool_usage(self, user_id: str, tool_name: str, tool_data: Dict[str, Any]) -> Dict[str, Any]:
        """Track tool usage and calculate cost"""
        try:
            cost = self.pricing.get(f'{tool_name}_call', self.pricing['tool_call'])
            
            usage_record = {
                'user_id': user_id,
                'usage_id': f"tool_{int(time.time())}_{uuid.uuid4().hex[:8]}",
                'service_type': 'tool_call',
                'timestamp': int(time.time()),
                'details': {
                    'tool_name': tool_name,
                    'tool_data': tool_data,
                    'cost': round(cost, 4)
                },
                'expires_at': int(time.time()) + (90 * 24 * 60 * 60)
            }
            
            self.usage_table.put_item(Item=usage_record)
            self._deduct_credits(user_id, cost, 'tool_usage', usage_record['usage_id'])
            
            return {
                'success': True,
                'cost': cost,
                'usage_id': usage_record['usage_id']
            }
            
        except Exception as e:
            logger.error(f"Error tracking tool usage: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    def track_chat_message(self, user_id: str, message_type: str = 'user_message') -> Dict[str, Any]:
        """Track chat message usage"""
        try:
            cost = self.pricing['chat_message']
            
            usage_record = {
                'user_id': user_id,
                'usage_id': f"chat_{int(time.time())}_{uuid.uuid4().hex[:8]}",
                'service_type': 'chat',
                'timestamp': int(time.time()),
                'details': {
                    'message_type': message_type,
                    'cost': round(cost, 4)
                },
                'expires_at': int(time.time()) + (90 * 24 * 60 * 60)
            }
            
            self.usage_table.put_item(Item=usage_record)
            self._deduct_credits(user_id, cost, 'chat_message', usage_record['usage_id'])
            
            return {
                'success': True,
                'cost': cost,
                'usage_id': usage_record['usage_id']
            }
            
        except Exception as e:
            logger.error(f"Error tracking chat message: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    def _deduct_credits(self, user_id: str, amount: float, transaction_type: str, usage_id: str):
        """Deduct credits from user account"""
        try:
            # Get current credits
            response = self.credits_table.get_item(Key={'user_id': user_id})
            
            if 'Item' in response:
                current_credits = float(response['Item'].get('credits', 0))
            else:
                # Initialize user with free credits
                current_credits = 5.0  # $5 free credits for new users
                self.credits_table.put_item(Item={
                    'user_id': user_id,
                    'credits': Decimal(str(current_credits)),
                    'created_at': int(time.time()),
                    'last_updated': int(time.time())
                })
            
            # Check if user has sufficient credits
            if current_credits < amount:
                raise InsufficientCreditsError(f"Insufficient credits. Required: ${amount:.4f}, Available: ${current_credits:.4f}")
            
            # Deduct credits
            new_credits = current_credits - amount
            
            self.credits_table.update_item(
                Key={'user_id': user_id},
                UpdateExpression='SET credits = :credits, last_updated = :timestamp',
                ExpressionAttributeValues={
                    ':credits': Decimal(str(new_credits)),
                    ':timestamp': int(time.time())
                }
            )
            
            # Record transaction
            transaction_id = f"txn_{int(time.time())}_{uuid.uuid4().hex[:8]}"
            self.transactions_table.put_item(Item={
                'transaction_id': transaction_id,
                'user_id': user_id,
                'timestamp': int(time.time()),
                'transaction_type': transaction_type,
                'amount': Decimal(str(amount)),
                'usage_id': usage_id,
                'credits_before': Decimal(str(current_credits)),
                'credits_after': Decimal(str(new_credits)),
                'expires_at': int(time.time()) + (365 * 24 * 60 * 60)  # 1 year TTL
            })
            
            return {
                'success': True,
                'credits_remaining': new_credits,
                'transaction_id': transaction_id
            }
            
        except Exception as e:
            logger.error(f"Error deducting credits: {str(e)}")
            raise
    
    def get_user_credits(self, user_id: str) -> Dict[str, Any]:
        """Get user's current credit balance"""
        try:
            response = self.credits_table.get_item(Key={'user_id': user_id})
            
            if 'Item' in response:
                return {
                    'success': True,
                    'credits': float(response['Item']['credits']),
                    'last_updated': response['Item'].get('last_updated')
                }
            else:
                # Initialize new user with free credits
                initial_credits = 5.0
                self.credits_table.put_item(Item={
                    'user_id': user_id,
                    'credits': Decimal(str(initial_credits)),
                    'created_at': int(time.time()),
                    'last_updated': int(time.time())
                })
                
                return {
                    'success': True,
                    'credits': initial_credits,
                    'is_new_user': True
                }
                
        except Exception as e:
            logger.error(f"Error getting user credits: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    def add_credits(self, user_id: str, amount: float, payment_method: str = 'stripe') -> Dict[str, Any]:
        """Add credits to user account (for purchases)"""
        try:
            # Get current credits
            response = self.credits_table.get_item(Key={'user_id': user_id})
            
            if 'Item' in response:
                current_credits = float(response['Item']['credits'])
            else:
                current_credits = 0.0
            
            # Add credits
            new_credits = current_credits + amount
            
            self.credits_table.update_item(
                Key={'user_id': user_id},
                UpdateExpression='SET credits = :credits, last_updated = :timestamp',
                ExpressionAttributeValues={
                    ':credits': Decimal(str(new_credits)),
                    ':timestamp': int(time.time())
                }
            )
            
            # Record transaction
            transaction_id = f"purchase_{int(time.time())}_{uuid.uuid4().hex[:8]}"
            self.transactions_table.put_item(Item={
                'transaction_id': transaction_id,
                'user_id': user_id,
                'timestamp': int(time.time()),
                'transaction_type': 'credit_purchase',
                'amount': Decimal(str(amount)),
                'payment_method': payment_method,
                'credits_before': Decimal(str(current_credits)),
                'credits_after': Decimal(str(new_credits)),
                'expires_at': int(time.time()) + (365 * 24 * 60 * 60)
            })
            
            return {
                'success': True,
                'credits_added': amount,
                'total_credits': new_credits,
                'transaction_id': transaction_id
            }
            
        except Exception as e:
            logger.error(f"Error adding credits: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    def get_usage_summary(self, user_id: str, days: int = 30) -> Dict[str, Any]:
        """Get user's usage summary for the last N days"""
        try:
            cutoff_time = int(time.time()) - (days * 24 * 60 * 60)
            
            response = self.usage_table.query(
                IndexName='TimestampIndex',
                KeyConditionExpression='user_id = :user_id AND timestamp >= :cutoff',
                ExpressionAttributeValues={
                    ':user_id': user_id,
                    ':cutoff': cutoff_time
                }
            )
            
            usage_items = response.get('Items', [])
            
            # Calculate summary
            total_cost = 0
            service_breakdown = {}
            
            for item in usage_items:
                cost = float(item['details'].get('total_cost', item['details'].get('cost', 0)))
                total_cost += cost
                
                service_type = item['service_type']
                if service_type not in service_breakdown:
                    service_breakdown[service_type] = {'count': 0, 'cost': 0}
                
                service_breakdown[service_type]['count'] += 1
                service_breakdown[service_type]['cost'] += cost
            
            return {
                'success': True,
                'period_days': days,
                'total_usage': len(usage_items),
                'total_cost': round(total_cost, 4),
                'service_breakdown': service_breakdown,
                'usage_items': usage_items
            }
            
        except Exception as e:
            logger.error(f"Error getting usage summary: {str(e)}")
            return {'success': False, 'error': str(e)}

class InsufficientCreditsError(Exception):
    """Raised when user doesn't have enough credits"""
    pass
