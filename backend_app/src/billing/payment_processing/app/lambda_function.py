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
from datetime import datetime
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
STRIPE_SECRET_NAME = os.environ.get('STRIPE_SECRET_NAME', 'cosine-stripe-secret-production')
STRIPE_WEBHOOK_SECRET_NAME = os.environ.get('STRIPE_WEBHOOK_SECRET_NAME', 'cosine-stripe-webhook-secret-production')

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
        response = secrets_client.get_secret_value(SecretId=STRIPE_SECRET_NAME)
        secret_data = json.loads(response['SecretString'])
        return secret_data.get('stripe_secret_key') or secret_data.get('secret_key', '')
    except ClientError as e:
        logger.error(f"Error retrieving Stripe secret: {str(e)}")
        raise

def get_stripe_webhook_secret() -> str:
    """Get Stripe webhook secret from Secrets Manager"""
    try:
        response = secrets_client.get_secret_value(SecretId=STRIPE_WEBHOOK_SECRET_NAME)
        secret_data = json.loads(response['SecretString'])
        return secret_data.get('webhook_secret') or secret_data.get('secret', '')
    except ClientError as e:
        logger.error(f"Error retrieving Stripe webhook secret: {str(e)}")
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
    
    stripe.api_key = get_stripe_secret()
    
    try:
        intent = stripe.PaymentIntent.create(
            amount=int(amount * 100),  # Convert to cents
            currency=currency,
            metadata=metadata or {},
            description='Cosine Platform Donation'
        )
        return {
            'client_secret': intent.client_secret,
            'payment_intent_id': intent.id,
            'amount': amount,
            'currency': currency
        }
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error creating payment intent: {str(e)}")
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

def handle_webhook_event(event_data: Dict) -> Dict:
    """Handle Stripe webhook events"""
    event_type = event_data.get('type')
    event_object = event_data.get('data', {}).get('object', {})
    
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
    
    return {
        'event_type': event_type,
        'payment_data': payment_data,
        'processed': True
    }

def lambda_handler(event: Dict, context: Any) -> Dict:
    """Main Lambda handler"""
    try:
        http_method = event.get('httpMethod', 'POST')
        
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            return create_response(200, {'message': 'CORS preflight'})
        
        # Parse body
        body_str = event.get('body', '{}')
        if isinstance(body_str, str):
            body = json.loads(body_str) if body_str else {}
        else:
            body = body_str
        
        # Check if this is a Stripe webhook
        stripe_signature = event.get('headers', {}).get('stripe-signature') or event.get('headers', {}).get('Stripe-Signature')
        
        if stripe_signature:
            # Handle webhook
            if not verify_stripe_webhook(body_str, stripe_signature):
                return create_response(400, {'error': 'Invalid webhook signature'})
            
            event_data = json.loads(body_str) if isinstance(body_str, str) else body_str
            result = handle_webhook_event(event_data)
            return create_response(200, result)
        
        # Handle GET requests - fetch earnings summary
        if http_method == 'GET':
            query_params = event.get('queryStringParameters') or {}
            if query_params.get('summary') == 'true':
                # Get month from query params or default to current month
                target_month = query_params.get('month')
                if not target_month:
                    target_month = datetime.now().strftime('%Y-%m')
                
                # Return earnings summary CSV data
                try:
                    response = s3_client.get_object(Bucket=SPENDING_BUCKET_NAME, Key='earnings_summary.csv')
                    csv_content = response['Body'].read().decode('utf-8')
                    reader = csv.DictReader(io.StringIO(csv_content))
                    earnings_data = list(reader)
                    
                    # Find current month's total
                    current_month_total = 0.0
                    for row in earnings_data:
                        if row.get('month') == target_month:
                            current_month_total = float(row.get('total_earnings', 0))
                            break
                    
                    # Calculate all-time total raised (for historical data)
                    total_raised = sum(float(row.get('total_earnings', 0)) for row in earnings_data)
                    
                    return create_response(200, {
                        'success': True,
                        'current_month_total': current_month_total,
                        'total_raised': total_raised,
                        'monthly_earnings': earnings_data
                    })
                except ClientError as e:
                    if e.response['Error']['Code'] == 'NoSuchKey':
                        return create_response(200, {
                            'success': True,
                            'current_month_total': 0.0,
                            'total_raised': 0.0,
                            'monthly_earnings': []
                        })
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

