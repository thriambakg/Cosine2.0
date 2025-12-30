"""
AWS Lambda function for fetching AWS account spending data
Gets current month billing cycle costs and stores them in S3
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, Optional
from botocore.exceptions import ClientError
from datetime import datetime, timedelta
import csv
import io

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Initialize AWS clients
ce_client = boto3.client('ce')  # Cost Explorer
s3_client = boto3.client('s3')

# Environment variables
SPENDING_BUCKET_NAME = os.environ.get('SPENDING_BUCKET_NAME')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')

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

def get_current_billing_period() -> tuple:
    """Get the start and end dates for the current billing period"""
    today = datetime.now()
    # AWS billing periods typically start on the 1st of the month
    start_date = today.replace(day=1).strftime('%Y-%m-%d')
    # End date is today (for current month) or end of month
    end_date = today.strftime('%Y-%m-%d')
    return start_date, end_date

def get_cost_and_usage(start_date: str, end_date: str) -> Dict[str, Any]:
    """Fetch cost and usage data from AWS Cost Explorer"""
    try:
        response = ce_client.get_cost_and_usage(
            TimePeriod={
                'Start': start_date,
                'End': end_date
            },
            Granularity='MONTHLY',
            Metrics=['BlendedCost', 'UnblendedCost', 'UsageQuantity'],
            GroupBy=[
                {'Type': 'DIMENSION', 'Key': 'SERVICE'},
                {'Type': 'DIMENSION', 'Key': 'LINKED_ACCOUNT'}
            ]
        )
        return response
    except ClientError as e:
        logger.error(f"Error fetching cost data: {str(e)}")
        raise

def get_detailed_costs(start_date: str, end_date: str) -> Dict[str, Any]:
    """Get detailed cost breakdown by service"""
    try:
        response = ce_client.get_cost_and_usage(
            TimePeriod={
                'Start': start_date,
                'End': end_date
            },
            Granularity='DAILY',
            Metrics=['BlendedCost', 'UnblendedCost'],
            GroupBy=[
                {'Type': 'DIMENSION', 'Key': 'SERVICE'},
                {'Type': 'DIMENSION', 'Key': 'USAGE_TYPE'}
            ]
        )
        return response
    except ClientError as e:
        logger.error(f"Error fetching detailed cost data: {str(e)}")
        raise

def calculate_totals(cost_data: Dict) -> Dict[str, float]:
    """Calculate total costs from Cost Explorer response"""
    totals = {
        'blended_cost': 0.0,
        'unblended_cost': 0.0,
        'usage_quantity': 0.0
    }
    
    if 'ResultsByTime' in cost_data:
        for result in cost_data['ResultsByTime']:
            if 'Total' in result:
                total = result['Total']
                if 'BlendedCost' in total:
                    amount = float(total['BlendedCost']['Amount'])
                    totals['blended_cost'] += amount
                if 'UnblendedCost' in total:
                    amount = float(total['UnblendedCost']['Amount'])
                    totals['unblended_cost'] += amount
                if 'UsageQuantity' in total:
                    amount = float(total['UsageQuantity']['Amount'])
                    totals['usage_quantity'] += amount
    
    return totals

def store_detailed_summary(cost_data: Dict, start_date: str, end_date: str) -> str:
    """Store detailed monthly summary in S3"""
    month_key = datetime.now().strftime('%Y-%m')
    key = f"detailed/{month_key}_detailed.json"
    
    summary = {
        'period': {
            'start': start_date,
            'end': end_date,
            'month': month_key
        },
        'cost_data': cost_data,
        'generated_at': datetime.now().isoformat()
    }
    
    try:
        s3_client.put_object(
            Bucket=SPENDING_BUCKET_NAME,
            Key=key,
            Body=json.dumps(summary, indent=2, default=str),
            ContentType='application/json',
            ServerSideEncryption='aws:kms'
        )
        logger.info(f"✅ Stored detailed summary: {key}")
        return key
    except ClientError as e:
        logger.error(f"Error storing detailed summary: {str(e)}")
        raise

def append_monthly_summary(totals: Dict[str, float], start_date: str, end_date: str) -> str:
    """Append monthly totals to aggregated table CSV"""
    month_key = datetime.now().strftime('%Y-%m')
    csv_key = "monthly_summary.csv"
    
    # Try to get existing CSV
    existing_data = []
    try:
        response = s3_client.get_object(Bucket=SPENDING_BUCKET_NAME, Key=csv_key)
        csv_content = response['Body'].read().decode('utf-8')
        reader = csv.DictReader(io.StringIO(csv_content))
        existing_data = list(reader)
    except ClientError as e:
        if e.response['Error']['Code'] != 'NoSuchKey':
            logger.warning(f"Error reading existing CSV: {str(e)}")
    
    # Add new row
    new_row = {
        'month': month_key,
        'start_date': start_date,
        'end_date': end_date,
        'blended_cost': f"{totals['blended_cost']:.2f}",
        'unblended_cost': f"{totals['unblended_cost']:.2f}",
        'usage_quantity': f"{totals['usage_quantity']:.2f}",
        'currency': 'USD',
        'updated_at': datetime.now().isoformat()
    }
    
    # Check if month already exists, update if so
    updated = False
    for i, row in enumerate(existing_data):
        if row.get('month') == month_key:
            existing_data[i] = new_row
            updated = True
            break
    
    if not updated:
        existing_data.append(new_row)
    
    # Write back to S3
    output = io.StringIO()
    fieldnames = ['month', 'start_date', 'end_date', 'blended_cost', 'unblended_cost', 'usage_quantity', 'currency', 'updated_at']
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
        logger.info(f"✅ Updated monthly summary CSV: {csv_key}")
        return csv_key
    except ClientError as e:
        logger.error(f"Error storing monthly summary: {str(e)}")
        raise

def lambda_handler(event: Dict, context: Any) -> Dict:
    """Main Lambda handler"""
    try:
        http_method = event.get('httpMethod', 'GET')
        
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            return create_response(200, {'message': 'CORS preflight'})
        
        if http_method != 'GET':
            return create_response(405, {'error': 'Method not allowed'})
        
        # Get current billing period
        start_date, end_date = get_current_billing_period()
        logger.info(f"📊 Fetching AWS spending for period: {start_date} to {end_date}")
        
        # Fetch cost data
        cost_data = get_cost_and_usage(start_date, end_date)
        detailed_data = get_detailed_costs(start_date, end_date)
        
        # Calculate totals
        totals = calculate_totals(cost_data)
        
        # Store detailed summary
        detailed_key = store_detailed_summary(detailed_data, start_date, end_date)
        
        # Append to monthly summary table
        summary_key = append_monthly_summary(totals, start_date, end_date)
        
        # Return response
        return create_response(200, {
            'success': True,
            'period': {
                'start': start_date,
                'end': end_date,
                'month': datetime.now().strftime('%Y-%m')
            },
            'totals': totals,
            'stored': {
                'detailed': detailed_key,
                'summary': summary_key
            },
            'message': 'AWS spending data fetched and stored successfully'
        })
        
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        logger.error(f"❌ AWS Client Error: {error_code} - {error_message}")
        return create_response(500, {
            'success': False,
            'error': f'AWS API error: {error_message}',
            'code': error_code
        })
    except Exception as e:
        logger.error(f"❌ Unexpected error: {str(e)}", exc_info=True)
        return create_response(500, {
            'success': False,
            'error': f'Internal server error: {str(e)}'
        })

