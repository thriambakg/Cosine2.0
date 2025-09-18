"""
Billing API Lambda Function
Handles credit management, usage tracking, and payment processing
"""

import json
import logging
import os
from typing import Dict, Any

from usage_tracker import UsageTracker

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def get_cors_headers() -> Dict[str, str]:
    """Get standard CORS headers"""
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }

def lambda_handler(event, context):
    """
    Lambda handler for billing operations
    
    Expected event structure:
    {
        "httpMethod": "GET|POST|PUT",
        "pathParameters": {"action": "credits|usage|purchase"},
        "queryStringParameters": {"user_id": "required"},
        "body": "JSON string for POST/PUT"
    }
    """
    try:
        # Parse request
        http_method = event.get('httpMethod', 'GET')
        path_params = event.get('pathParameters') or {}
        query_params = event.get('queryStringParameters') or {}
        user_id = query_params.get('user_id')
        
        if not user_id:
            return {
                'statusCode': 400,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'user_id is required'})
            }
        
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': ''
            }
        
        # Initialize usage tracker
        usage_tracker = UsageTracker()
        
        # Route to appropriate handler
        action = path_params.get('action', 'credits')
        
        if action == 'credits':
            if http_method == 'GET':
                return get_user_credits(usage_tracker, user_id)
            elif http_method == 'POST':
                body = json.loads(event.get('body', '{}'))
                return add_credits(usage_tracker, user_id, body)
        
        elif action == 'usage':
            if http_method == 'GET':
                days = int(query_params.get('days', 30))
                return get_usage_summary(usage_tracker, user_id, days)
        
        elif action == 'purchase':
            if http_method == 'POST':
                body = json.loads(event.get('body', '{}'))
                return process_purchase(usage_tracker, user_id, body)
        
        else:
            return {
                'statusCode': 404,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Action not found'})
            }
    
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Internal server error'})
        }

def get_user_credits(usage_tracker: UsageTracker, user_id: str) -> Dict[str, Any]:
    """Get user's current credit balance"""
    try:
        result = usage_tracker.get_user_credits(user_id)
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({
                    'credits': result['credits'],
                    'is_new_user': result.get('is_new_user', False),
                    'last_updated': result.get('last_updated')
                })
            }
        else:
            return {
                'statusCode': 500,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': result.get('error', 'Failed to get credits')})
            }
    
    except Exception as e:
        logger.error(f"Error getting user credits: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Failed to get user credits'})
        }

def add_credits(usage_tracker: UsageTracker, user_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """Add credits to user account"""
    try:
        amount = body.get('amount')
        payment_method = body.get('payment_method', 'stripe')
        
        if not amount or amount <= 0:
            return {
                'statusCode': 400,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Valid amount is required'})
            }
        
        result = usage_tracker.add_credits(user_id, amount, payment_method)
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({
                    'credits_added': result['credits_added'],
                    'total_credits': result['total_credits'],
                    'transaction_id': result['transaction_id']
                })
            }
        else:
            return {
                'statusCode': 500,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': result.get('error', 'Failed to add credits')})
            }
    
    except Exception as e:
        logger.error(f"Error adding credits: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Failed to add credits'})
        }

def get_usage_summary(usage_tracker: UsageTracker, user_id: str, days: int) -> Dict[str, Any]:
    """Get user's usage summary"""
    try:
        result = usage_tracker.get_usage_summary(user_id, days)
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({
                    'period_days': result['period_days'],
                    'total_usage': result['total_usage'],
                    'total_cost': result['total_cost'],
                    'service_breakdown': result['service_breakdown']
                })
            }
        else:
            return {
                'statusCode': 500,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': result.get('error', 'Failed to get usage summary')})
            }
    
    except Exception as e:
        logger.error(f"Error getting usage summary: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Failed to get usage summary'})
        }

def process_purchase(usage_tracker: UsageTracker, user_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """Process a credit purchase (integrate with Stripe)"""
    try:
        # This would integrate with Stripe or other payment processor
        # For now, we'll simulate a successful purchase
        
        amount = body.get('amount')
        payment_intent_id = body.get('payment_intent_id')  # From Stripe
        
        if not amount or amount <= 0:
            return {
                'statusCode': 400,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'Valid amount is required'})
            }
        
        # TODO: Verify payment with Stripe
        # stripe.PaymentIntent.retrieve(payment_intent_id)
        
        # Add credits
        result = usage_tracker.add_credits(user_id, amount, 'stripe')
        
        if result['success']:
            return {
                'statusCode': 200,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({
                    'success': True,
                    'credits_added': result['credits_added'],
                    'total_credits': result['total_credits'],
                    'transaction_id': result['transaction_id']
                })
            }
        else:
            return {
                'statusCode': 500,
                'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
                'body': json.dumps({'error': result.get('error', 'Failed to process purchase')})
            }
    
    except Exception as e:
        logger.error(f"Error processing purchase: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {**get_cors_headers(), 'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Failed to process purchase'})
        }
