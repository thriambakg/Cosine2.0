"""
AWS Lambda function for processing payments via Stripe
Handles donation payments and subscription management
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError
from datetime import datetime, timedelta
import hmac
import hashlib
import csv
import io
import uuid

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Initialize AWS clients
s3_client = boto3.client('s3')
secrets_client = boto3.client('secretsmanager')

# Environment variables
SPENDING_BUCKET_NAME = os.environ.get('SPENDING_BUCKET_NAME')
STRIPE_SECRET_NAME = os.environ.get('STRIPE_SECRET_NAME', 'cosine-stripe-production')

# Try to import stripe (will be in requirements.txt)
try:
    import stripe
    STRIPE_AVAILABLE = True
except ImportError:
    STRIPE_AVAILABLE = False
    logger.warning("Stripe library not available. Install with: pip install stripe")

def create_response(status_code: int, body: Dict) -> Dict:
    """Create a standardized API Gateway response"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        },
        'body': json.dumps(body, default=str)
    }

def get_stripe_secret() -> str:
    """Get Stripe secret key from Secrets Manager"""
    try:
        logger.info(f"🔑 Fetching Stripe secret from Secrets Manager: {STRIPE_SECRET_NAME}")
        response = secrets_client.get_secret_value(SecretId=STRIPE_SECRET_NAME)
        secret_data = json.loads(response['SecretString'])
        
        # Try both key names for compatibility
        secret_key = secret_data.get('stripe_secret_key') or secret_data.get('secret_key', '')
        
        if not secret_key or secret_key.startswith('PLACEHOLDER_'):
            logger.warning(f"⚠️ Stripe secret key not configured or still using placeholder value")
            raise ValueError("Stripe secret key not configured. Please update the secret in AWS Secrets Manager.")
        
        logger.info(f"✅ Successfully retrieved Stripe secret key (length: {len(secret_key)})")
        return secret_key
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        logger.error(f"❌ Error retrieving Stripe secret from Secrets Manager ({error_code}): {error_message}")
        raise
    except (ValueError, KeyError) as e:
        logger.error(f"❌ Invalid Stripe secret format: {str(e)}")
        raise

def get_stripe_webhook_secret() -> str:
    """Get Stripe webhook secret from Secrets Manager (from consolidated secret)"""
    try:
        logger.info(f"🔑 Fetching Stripe webhook secret from Secrets Manager: {STRIPE_SECRET_NAME}")
        response = secrets_client.get_secret_value(SecretId=STRIPE_SECRET_NAME)
        secret_data = json.loads(response['SecretString'])
        
        # Try both key names for compatibility
        webhook_secret = secret_data.get('webhook_secret') or secret_data.get('secret', '')
        
        if not webhook_secret or webhook_secret.startswith('PLACEHOLDER_'):
            logger.warning(f"⚠️ Stripe webhook secret not configured or still using placeholder value")
            raise ValueError("Stripe webhook secret not configured. Please update the secret in AWS Secrets Manager.")
        
        logger.info(f"✅ Successfully retrieved Stripe webhook secret (length: {len(webhook_secret)})")
        return webhook_secret
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        logger.error(f"❌ Error retrieving Stripe webhook secret from Secrets Manager ({error_code}): {error_message}")
        raise
    except (ValueError, KeyError) as e:
        logger.error(f"❌ Invalid Stripe webhook secret format: {str(e)}")
        raise

def verify_stripe_webhook(payload: str, signature: str) -> bool:
    """Verify Stripe webhook signature"""
    if not STRIPE_AVAILABLE:
        logger.error("Stripe library not available for webhook verification")
        return False
    try:
        webhook_secret = get_stripe_webhook_secret()
        stripe.Webhook.construct_event(payload, signature, webhook_secret)
        return True
    except ValueError as e:
        logger.error(f"Invalid payload: {str(e)}")
        return False
    except stripe.error.SignatureVerificationError as e:
        logger.error(f"Invalid signature: {str(e)}")
        return False

def create_payment_intent(amount: float, currency: str = 'usd', metadata: Optional[Dict] = None) -> Dict:
    """Create a Stripe payment intent for a donation"""
    if not STRIPE_AVAILABLE:
        raise Exception("Stripe library not available")
    
    # Fetch Stripe secret key from Secrets Manager
    try:
        stripe.api_key = get_stripe_secret()
        # Set API version to match webhook endpoint configuration (2025-12-15.clover)
        stripe.api_version = '2025-12-15.clover'
        logger.info(f"💳 Creating Stripe payment intent for ${amount:.2f} {currency.upper()} (API: {stripe.api_version})")
    except Exception as e:
        logger.error(f"❌ Failed to retrieve Stripe secret key: {str(e)}")
        raise Exception(f"Stripe payment processing not configured: {str(e)}")
    
    try:
        intent = stripe.PaymentIntent.create(
            amount=int(amount * 100),  # Convert to cents
            currency=currency,
            metadata=metadata or {},
            description='Cosine Platform Donation'
        )
        logger.info(f"✅ Successfully created Stripe payment intent: {intent.id}")
        return {
            'client_secret': intent.client_secret,
            'payment_intent_id': intent.id,
            'amount': amount,
            'currency': currency
        }
    except stripe.error.StripeError as e:
        logger.error(f"❌ Stripe API error creating payment intent: {str(e)}")
        raise

def record_donation_csv(payment_data: Dict) -> str:
    """Record donation as individual CSV in earnings/yyyy/mm/dd-UUID.csv format"""
    now = datetime.now()
    date_str = now.strftime('%Y-%m-%d')
    year_month = now.strftime('%Y/%m')
    payment_id = payment_data.get('payment_intent_id', str(uuid.uuid4()))
    # Use UUID from payment intent or generate one
    payment_uuid = payment_id.split('_')[-1] if '_' in payment_id else payment_id[:8]
    key = f"earnings/{year_month}/{date_str}-{payment_uuid}.csv"
    
    # Create CSV record
    donation_record = {
        'date': date_str,
        'timestamp': now.isoformat(),
        'payment_intent_id': payment_data.get('payment_intent_id'),
        'amount': f"{payment_data.get('amount', 0):.2f}",
        'currency': payment_data.get('currency', 'usd'),
        'status': payment_data.get('status', 'pending'),
        'metadata': json.dumps(payment_data.get('metadata', {}))
    }
    
    # Write CSV
    output = io.StringIO()
    fieldnames = ['date', 'timestamp', 'payment_intent_id', 'amount', 'currency', 'status', 'metadata']
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerow(donation_record)
    
    try:
        s3_client.put_object(
            Bucket=SPENDING_BUCKET_NAME,
            Key=key,
            Body=output.getvalue(),
            ContentType='text/csv',
            ServerSideEncryption='aws:kms'
        )
        logger.info(f"✅ Recorded donation CSV: {key}")
        return key
    except ClientError as e:
        logger.error(f"Error recording donation CSV: {str(e)}")
        raise

def update_earnings_summary(amount: float, currency: str = 'usd') -> str:
    """Update earnings summary CSV at root with monthly totals"""
    now = datetime.now()
    month_key = now.strftime('%Y-%m')
    csv_key = "earnings_summary.csv"
    
    # Try to get existing CSV
    existing_data = []
    try:
        response = s3_client.get_object(Bucket=SPENDING_BUCKET_NAME, Key=csv_key)
        csv_content = response['Body'].read().decode('utf-8')
        reader = csv.DictReader(io.StringIO(csv_content))
        existing_data = list(reader)
    except ClientError as e:
        if e.response['Error']['Code'] != 'NoSuchKey':
            logger.warning(f"Error reading existing earnings CSV: {str(e)}")
    
    # Find or create month row
    month_row = None
    for row in existing_data:
        if row.get('month') == month_key:
            month_row = row
            break
    
    if month_row:
        # Update existing month
        current_total = float(month_row.get('total_earnings', 0))
        current_count = int(month_row.get('payment_count', 0))
        month_row['total_earnings'] = f"{current_total + amount:.2f}"
        month_row['payment_count'] = str(current_count + 1)
        month_row['updated_at'] = now.isoformat()
    else:
        # Add new month
        month_row = {
            'month': month_key,
            'total_earnings': f"{amount:.2f}",
            'payment_count': '1',
            'currency': currency,
            'updated_at': now.isoformat()
        }
        existing_data.append(month_row)
    
    # Write back to S3
    output = io.StringIO()
    fieldnames = ['month', 'total_earnings', 'payment_count', 'currency', 'updated_at']
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(existing_data)
    
    try:
        s3_client.put_object(
            Bucket=SPENDING_BUCKET_NAME,
            Key=csv_key,
            Body=output.getvalue(),
            ContentType='text/csv',
            ServerSideEncryption='aws:kms'
        )
        logger.info(f"✅ Updated earnings summary CSV: {csv_key}")
        return csv_key
    except ClientError as e:
        logger.error(f"Error storing earnings summary: {str(e)}")
        raise

def check_event_processed(event_id: str) -> bool:
    """Check if a webhook event has already been processed (idempotency)"""
    try:
        # Use S3 to track processed events (simple key-based check)
        key = f"webhook_events/{event_id}.processed"
        s3_client.head_object(Bucket=SPENDING_BUCKET_NAME, Key=key)
        logger.info(f"⚠️ Event {event_id} already processed (idempotency check)")
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == '404':
            return False
        logger.warning(f"⚠️ Error checking event processing status: {str(e)}")
        return False

def mark_event_processed(event_id: str) -> None:
    """Mark a webhook event as processed (idempotency)"""
    try:
        key = f"webhook_events/{event_id}.processed"
        s3_client.put_object(
            Bucket=SPENDING_BUCKET_NAME,
            Key=key,
            Body=json.dumps({'event_id': event_id, 'processed_at': datetime.now().isoformat()}, indent=2),
            ContentType='application/json',
            ServerSideEncryption='aws:kms'
        )
        logger.info(f"✅ Marked event {event_id} as processed")
    except ClientError as e:
        logger.error(f"❌ Error marking event as processed: {str(e)}")
        # Don't raise - this is not critical, just logging

def handle_webhook_event(event_data: Dict) -> Dict:
    """Handle Stripe webhook events with idempotency"""
    event_type = event_data.get('type')
    event_id = event_data.get('id')
    event_object = event_data.get('data', {}).get('object', {})
    
    logger.info(f"📨 Processing webhook event: {event_type} (ID: {event_id})")
    
    # Idempotency check - prevent duplicate processing
    if event_id and check_event_processed(event_id):
        return {
            'event_type': event_type,
            'event_id': event_id,
            'processed': False,
            'message': 'Event already processed (idempotency)'
        }
    
    payment_data = {
        'payment_intent_id': event_object.get('id'),
        'amount': event_object.get('amount', 0) / 100.0,  # Convert from cents
        'currency': event_object.get('currency', 'usd'),
        'status': event_object.get('status'),
        'metadata': event_object.get('metadata', {})
    }
    
    if event_type == 'payment_intent.succeeded':
        # Record individual payment CSV
        donation_key = record_donation_csv(payment_data)
        # Update earnings summary
        update_earnings_summary(payment_data.get('amount', 0), payment_data.get('currency', 'usd'))
        logger.info(f"✅ Payment succeeded: {payment_data['payment_intent_id']}")
        # Mark event as processed
        if event_id:
            mark_event_processed(event_id)
    elif event_type == 'payment_intent.payment_failed':
        # Log failed payment for monitoring (don't record as earnings)
        logger.warning(f"❌ Payment failed: {payment_data['payment_intent_id']} - Amount: ${payment_data['amount']:.2f}")
        # Still mark as processed to prevent duplicate processing
        if event_id:
            mark_event_processed(event_id)
    else:
        # Log other event types for monitoring
        logger.info(f"ℹ️ Received webhook event type: {event_type} (not processing)")
        # Mark as processed to prevent reprocessing
        if event_id:
            mark_event_processed(event_id)
    
    return {
        'event_type': event_type,
        'event_id': event_id,
        'payment_data': payment_data,
        'processed': True
    }

def calculate_previous_month_earnings() -> Dict[str, float]:
    """Calculate total earnings for the previous month from individual payment CSVs"""
    today = datetime.now()
    # First day of current month
    first_of_current = today.replace(day=1)
    # Last day of previous month
    last_of_previous = first_of_current - timedelta(days=1)
    # First day of previous month
    first_of_previous = last_of_previous.replace(day=1)
    
    month_key = first_of_previous.strftime('%Y-%m')
    year_month_path = first_of_previous.strftime('%Y/%m')
    prefix = f"earnings/{year_month_path}/"
    
    logger.info(f"📊 Calculating earnings for previous month: {month_key} (prefix: {prefix})")
    
    total_earnings = 0.0
    payment_count = 0
    
    try:
        # List all objects in the previous month's earnings folder
        paginator = s3_client.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=SPENDING_BUCKET_NAME, Prefix=prefix)
        
        for page in pages:
            if 'Contents' in page:
                for obj in page['Contents']:
                    key = obj['Key']
                    # Only process CSV files
                    if key.endswith('.csv'):
                        try:
                            response = s3_client.get_object(Bucket=SPENDING_BUCKET_NAME, Key=key)
                            csv_content = response['Body'].read().decode('utf-8')
                            reader = csv.DictReader(io.StringIO(csv_content))
                            
                            for row in reader:
                                amount = float(row.get('amount', 0))
                                status = row.get('status', '').lower()
                                # Only count succeeded payments
                                if status == 'succeeded':
                                    total_earnings += amount
                                    payment_count += 1
                        except Exception as e:
                            logger.warning(f"⚠️ Error reading payment CSV {key}: {str(e)}")
                            continue
        
        logger.info(f"💰 Previous month ({month_key}) totals: ${total_earnings:.2f} from {payment_count} payments")
        
        return {
            'month': month_key,
            'total_earnings': total_earnings,
            'payment_count': payment_count,
            'currency': 'USD'
        }
    except ClientError as e:
        logger.error(f"❌ Error calculating previous month earnings: {str(e)}")
        return {
            'month': month_key,
            'total_earnings': 0.0,
            'payment_count': 0,
            'currency': 'USD'
        }

def handle_scheduled_event(event: Dict) -> Dict:
    """Handle scheduled EventBridge event - calculate previous month's earnings"""
    logger.info("📅 Processing scheduled monthly earnings calculation")
    
    try:
        # Calculate previous month's earnings from individual payment CSVs
        earnings_data = calculate_previous_month_earnings()
        
        # Update earnings summary CSV (this ensures the summary is up to date)
        month_key = earnings_data['month']
        csv_key = "earnings_summary.csv"
        
        # Read existing summary
        existing_data = []
        try:
            response = s3_client.get_object(Bucket=SPENDING_BUCKET_NAME, Key=csv_key)
            csv_content = response['Body'].read().decode('utf-8')
            reader = csv.DictReader(io.StringIO(csv_content))
            existing_data = list(reader)
        except ClientError as e:
            if e.response['Error']['Code'] != 'NoSuchKey':
                logger.warning(f"Error reading existing earnings CSV: {str(e)}")
        
        # Update or add the month's data
        updated = False
        for i, row in enumerate(existing_data):
            if row.get('month') == month_key:
                existing_data[i] = {
                    'month': month_key,
                    'total_earnings': f"{earnings_data['total_earnings']:.2f}",
                    'payment_count': str(earnings_data['payment_count']),
                    'currency': earnings_data['currency'],
                    'updated_at': datetime.now().isoformat()
                }
                updated = True
                break
        
        if not updated:
            existing_data.append({
                'month': month_key,
                'total_earnings': f"{earnings_data['total_earnings']:.2f}",
                'payment_count': str(earnings_data['payment_count']),
                'currency': earnings_data['currency'],
                'updated_at': datetime.now().isoformat()
            })
        
        # Write back to S3
        output = io.StringIO()
        fieldnames = ['month', 'total_earnings', 'payment_count', 'currency', 'updated_at']
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(existing_data)
        
        s3_client.put_object(
            Bucket=SPENDING_BUCKET_NAME,
            Key=csv_key,
            Body=output.getvalue(),
            ContentType='text/csv',
            ServerSideEncryption='aws:kms'
        )
        
        logger.info(f"✅ Monthly earnings summary updated for {month_key}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'success': True,
                'month': month_key,
                'earnings': earnings_data,
                'message': f'Monthly earnings calculated for {month_key}'
            }, default=str)
        }
    except Exception as e:
        logger.error(f"❌ Error processing scheduled earnings event: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'body': json.dumps({
                'success': False,
                'error': f'Failed to calculate monthly earnings: {str(e)}'
            }, default=str)
        }

def lambda_handler(event: Dict, context: Any) -> Dict:
    """Main Lambda handler"""
    logger.info(f"📥 Received event: {json.dumps(event, default=str)}")
    
    try:
        # Check if this is a scheduled EventBridge event
        if 'source' in event and event.get('source') == 'aws.events':
            logger.info("📅 Processing scheduled EventBridge event - calculating monthly earnings")
            return handle_scheduled_event(event)
        
        # Otherwise, handle HTTP API Gateway request
        http_method = event.get('httpMethod', 'POST')
        logger.info(f"🔍 Processing {http_method} request")
        
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            logger.info("✅ Handling CORS preflight request")
            return create_response(200, {'message': 'CORS preflight'})
        
        # Check if this is a Stripe webhook (must check BEFORE parsing body)
        stripe_signature = event.get('headers', {}).get('stripe-signature') or event.get('headers', {}).get('Stripe-Signature')
        
        if stripe_signature:
            # Handle webhook - need raw body for signature verification
            body_str = event.get('body', '{}')
            
            # Handle base64 encoded body (API Gateway may encode binary content)
            if event.get('isBase64Encoded', False):
                import base64
                try:
                    body_str = base64.b64decode(body_str).decode('utf-8')
                    logger.info("📦 Decoded base64 encoded webhook body")
                except Exception as e:
                    logger.error(f"❌ Error decoding base64 body: {str(e)}")
                    return create_response(400, {'error': 'Invalid webhook body encoding'})
            
            # Verify webhook signature with raw body
            if not verify_stripe_webhook(body_str, stripe_signature):
                logger.error("❌ Invalid webhook signature - rejecting request")
                return create_response(400, {'error': 'Invalid webhook signature'})
            
            # Parse body after verification
            try:
                event_data = json.loads(body_str) if isinstance(body_str, str) else body_str
            except json.JSONDecodeError as e:
                logger.error(f"❌ Error parsing webhook JSON: {str(e)}")
                return create_response(400, {'error': 'Invalid webhook JSON'})
            
            result = handle_webhook_event(event_data)
            return create_response(200, result)
        
        # Parse body for non-webhook requests
        body_str = event.get('body', '{}')
        if isinstance(body_str, str):
            body = json.loads(body_str) if body_str else {}
        else:
            body = body_str
        
        # Handle GET requests - fetch earnings summary
        if http_method == 'GET':
            query_params = event.get('queryStringParameters') or {}
            logger.info(f"📋 Query parameters: {query_params}")
            
            if query_params.get('summary') == 'true':
                # Get month from query params or default to current month
                target_month = query_params.get('month')
                if not target_month:
                    target_month = datetime.now().strftime('%Y-%m')
                logger.info(f"🗓️ Target month: {target_month}")
                
                # Return earnings summary CSV data
                logger.info(f"📊 Fetching earnings summary from S3 bucket: {SPENDING_BUCKET_NAME}")
                try:
                    response = s3_client.get_object(Bucket=SPENDING_BUCKET_NAME, Key='earnings_summary.csv')
                    csv_content = response['Body'].read().decode('utf-8')
                    logger.info(f"📄 CSV content length: {len(csv_content)} bytes")
                    
                    reader = csv.DictReader(io.StringIO(csv_content))
                    earnings_data = list(reader)
                    logger.info(f"💰 Found {len(earnings_data)} months of earnings data: {[row.get('month') for row in earnings_data]}")
                    
                    # Find current month's total
                    current_month_total = 0.0
                    for row in earnings_data:
                        if row.get('month') == target_month:
                            current_month_total = float(row.get('total_earnings', 0))
                            logger.info(f"💵 Current month ({target_month}) total: ${current_month_total:.2f}")
                            break
                    
                    if current_month_total == 0.0:
                        logger.info(f"ℹ️ No earnings data found for month {target_month}")
                    
                    # Calculate all-time total raised (for historical data)
                    total_raised = sum(float(row.get('total_earnings', 0)) for row in earnings_data)
                    logger.info(f"📊 All-time total raised: ${total_raised:.2f}")
                    
                    return create_response(200, {
                        'success': True,
                        'current_month_total': current_month_total,
                        'total_raised': total_raised,
                        'monthly_earnings': earnings_data
                    })
                except ClientError as e:
                    error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                    if error_code == 'NoSuchKey':
                        logger.warning("⚠️ earnings_summary.csv not found in S3 - returning empty data. Run scheduled event to generate summary files.")
                        return create_response(200, {
                            'success': True,
                            'current_month_total': 0.0,
                            'total_raised': 0.0,
                            'monthly_earnings': []
                        })
                    logger.error(f"❌ Error reading earnings summary from S3: {str(e)}")
                    raise
        
        # Handle payment intent creation
        if http_method == 'POST':
            operation = body.get('operation', 'create_payment_intent')
            
            if operation == 'create_payment_intent':
                amount = float(body.get('amount', 0))
                currency = body.get('currency', 'usd')
                metadata = body.get('metadata', {})
                
                if amount <= 0:
                    return create_response(400, {'error': 'Amount must be greater than 0'})
                
                payment_intent = create_payment_intent(amount, currency, metadata)
                return create_response(200, {
                    'success': True,
                    'payment_intent': payment_intent
                })
            else:
                return create_response(400, {'error': f'Unknown operation: {operation}'})
        else:
            return create_response(405, {'error': 'Method not allowed'})
        
    except Exception as e:
        logger.error(f"❌ Unexpected error: {str(e)}", exc_info=True)
        return create_response(500, {
            'success': False,
            'error': f'Internal server error: {str(e)}'
        })

