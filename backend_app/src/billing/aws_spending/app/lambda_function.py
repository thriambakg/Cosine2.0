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
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from cors_helper import get_cors_headers, validate_origin

# Origin is populated per request inside lambda_handler
origin = None


# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Initialize AWS clients
ce_client = boto3.client('ce')  # Cost Explorer
s3_client = boto3.client('s3')

# Environment variables
SPENDING_BUCKET_NAME = os.environ.get('SPENDING_BUCKET_NAME')
# AWS_REGION is automatically available in Lambda runtime context
# Use boto3's default region (Lambda automatically sets this)
AWS_REGION = boto3.Session().region_name or 'us-east-1'

def create_response(status_code: int, body: Dict) -> Dict:
    """Create a standardized API Gateway response"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            **get_cors_headers(origin),
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

def get_cost_and_usage(start_date: str, end_date: str, include_grouping: bool = True) -> Dict[str, Any]:
    """Fetch cost and usage data from AWS Cost Explorer"""
    try:
        params = {
            'TimePeriod': {
                'Start': start_date,
                'End': end_date
            },
            'Granularity': 'MONTHLY',
            'Metrics': ['BlendedCost', 'UnblendedCost', 'UsageQuantity']
        }
        
        # Only add GroupBy if we want detailed breakdown (for storage)
        if include_grouping:
            params['GroupBy'] = [
                {'Type': 'DIMENSION', 'Key': 'SERVICE'},
                {'Type': 'DIMENSION', 'Key': 'LINKED_ACCOUNT'}
            ]
        
        response = ce_client.get_cost_and_usage(**params)
        logger.info(f"📊 Cost Explorer API call successful. Response keys: {list(response.keys())}")
        if 'ResultsByTime' in response:
            logger.info(f"📈 ResultsByTime count: {len(response['ResultsByTime'])}")
            for idx, result in enumerate(response['ResultsByTime']):
                logger.info(f"   Result {idx}: TimePeriod={result.get('TimePeriod', {})}, Has Total={('Total' in result)}, Groups count={len(result.get('Groups', []))}")
        return response
    except ClientError as e:
        logger.error(f"Error fetching cost data: {str(e)}")
        raise

def get_daily_costs(start_date: str, end_date: str) -> Dict[str, Any]:
    """Get daily cost breakdown by service"""
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
        logger.error(f"Error fetching daily cost data: {str(e)}")
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
            # First try to get from Total (most accurate when no grouping)
            if 'Total' in result:
                total = result['Total']
                if 'BlendedCost' in total:
                    amount = float(total['BlendedCost']['Amount'])
                    totals['blended_cost'] += amount
                    logger.info(f"💰 Found Total BlendedCost: ${amount:.2f}")
                if 'UnblendedCost' in total:
                    amount = float(total['UnblendedCost']['Amount'])
                    totals['unblended_cost'] += amount
                if 'UsageQuantity' in total:
                    amount = float(total['UsageQuantity']['Amount'])
                    totals['usage_quantity'] += amount
            
            # If Total is missing or zero, sum all Groups (when GroupBy is used)
            if 'Groups' in result and len(result['Groups']) > 0:
                group_blended = 0.0
                group_unblended = 0.0
                group_usage = 0.0
                
                for group in result['Groups']:
                    metrics = group.get('Metrics', {})
                    if 'BlendedCost' in metrics:
                        group_blended += float(metrics['BlendedCost']['Amount'])
                    if 'UnblendedCost' in metrics:
                        group_unblended += float(metrics['UnblendedCost']['Amount'])
                    if 'UsageQuantity' in metrics:
                        group_usage += float(metrics['UsageQuantity']['Amount'])
                
                # Use group totals if Total was missing or zero
                if totals['blended_cost'] == 0.0 and group_blended > 0:
                    totals['blended_cost'] = group_blended
                    logger.info(f"💰 Calculated BlendedCost from Groups: ${group_blended:.2f} ({len(result['Groups'])} groups)")
                if totals['unblended_cost'] == 0.0 and group_unblended > 0:
                    totals['unblended_cost'] = group_unblended
                if totals['usage_quantity'] == 0.0 and group_usage > 0:
                    totals['usage_quantity'] = group_usage
    
    logger.info(f"📊 Final totals: Blended=${totals['blended_cost']:.2f}, Unblended=${totals['unblended_cost']:.2f}, Usage={totals['usage_quantity']:.2f}")
    return totals

def store_monthly_spending_csv(cost_data: Dict, month: str, start_date: str, end_date: str) -> str:
    """Store monthly spending CSV in spendings/yyyy/mm.csv format with full details"""
    year_month = month  # Format: YYYY-MM
    year_month_path = year_month.replace('-', '/')  # YYYY/MM for S3 path
    key = f"spendings/{year_month_path}.csv"
    
    # Extract all costs for the month with detailed breakdown
    monthly_costs = []
    if 'ResultsByTime' in cost_data:
        for result in cost_data['ResultsByTime']:
            time_period = result.get('TimePeriod', {})
            period_start = time_period.get('Start', '')
            
            # Extract groups with detailed service/account breakdown
            if 'Groups' in result:
                for group in result['Groups']:
                    keys = group.get('Keys', [])
                    service = keys[0] if len(keys) > 0 else 'Unknown'
                    linked_account = keys[1] if len(keys) > 1 else 'Unknown'
                    
                    metrics = group.get('Metrics', {})
                    blended_cost = float(metrics.get('BlendedCost', {}).get('Amount', 0))
                    unblended_cost = float(metrics.get('UnblendedCost', {}).get('Amount', 0))
                    usage_quantity = float(metrics.get('UsageQuantity', {}).get('Amount', 0))
                    unit = metrics.get('UsageQuantity', {}).get('Unit', 'N/A')
                    
                    monthly_costs.append({
                        'period_start': period_start,
                        'period_end': time_period.get('End', ''),
                        'service': service,
                        'linked_account': linked_account,
                        'blended_cost': f"{blended_cost:.2f}",
                        'unblended_cost': f"{unblended_cost:.2f}",
                        'usage_quantity': f"{usage_quantity:.2f}",
                        'usage_unit': unit,
                        'currency': 'USD'
                    })
            
            # Also include total if available
            if 'Total' in result:
                total = result['Total']
                monthly_costs.append({
                    'period_start': period_start,
                    'period_end': time_period.get('End', ''),
                    'service': 'TOTAL',
                    'linked_account': 'ALL',
                    'blended_cost': f"{float(total.get('BlendedCost', {}).get('Amount', 0)):.2f}",
                    'unblended_cost': f"{float(total.get('UnblendedCost', {}).get('Amount', 0)):.2f}",
                    'usage_quantity': f"{float(total.get('UsageQuantity', {}).get('Amount', 0)):.2f}",
                    'usage_unit': total.get('UsageQuantity', {}).get('Unit', 'N/A'),
                    'currency': 'USD'
                })
    
    # If no costs found, create empty record
    if not monthly_costs:
        monthly_costs.append({
            'period_start': start_date,
            'period_end': end_date,
            'service': 'NoCost',
            'linked_account': 'N/A',
            'blended_cost': '0.00',
            'unblended_cost': '0.00',
            'usage_quantity': '0.00',
            'usage_unit': 'N/A',
            'currency': 'USD'
        })
    
    # Write CSV
    output = io.StringIO()
    fieldnames = ['period_start', 'period_end', 'service', 'linked_account', 'blended_cost', 'unblended_cost', 'usage_quantity', 'usage_unit', 'currency']
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(monthly_costs)
    
    try:
        s3_client.put_object(
            Bucket=SPENDING_BUCKET_NAME,
            Key=key,
            Body=output.getvalue(),
            ContentType='text/csv',
            ServerSideEncryption='aws:kms'
        )
        logger.info(f"✅ Stored monthly spending CSV: {key}")
        return key
    except ClientError as e:
        logger.error(f"Error storing monthly spending CSV: {str(e)}")
        raise

def get_earnings_for_month(month_key: str) -> Dict[str, Any]:
    """Get earnings data for a specific month from earnings_summary.csv"""
    try:
        response = s3_client.get_object(Bucket=SPENDING_BUCKET_NAME, Key='earnings_summary.csv')
        csv_content = response['Body'].read().decode('utf-8')
        reader = csv.DictReader(io.StringIO(csv_content))
        
        for row in reader:
            if row.get('month') == month_key:
                return {
                    'total_earnings': float(row.get('total_earnings', 0)),
                    'payment_count': int(row.get('payment_count', 0)),
                    'currency': row.get('currency', 'USD')
                }
    except ClientError as e:
        if e.response['Error']['Code'] != 'NoSuchKey':
            logger.warning(f"⚠️ Error reading earnings summary: {str(e)}")
    
    # Return zero if not found
    return {
        'total_earnings': 0.0,
        'payment_count': 0,
        'currency': 'USD'
    }

def lambda_handler(event: Dict, context: Any) -> Dict:
    """Main Lambda handler - HTTP API Gateway requests only"""
    logger.info(f"📥 Received event: {json.dumps(event, default=str)}")
    global origin
    headers = event.get('headers', {}) if isinstance(event, dict) else {}
    origin = headers.get('Origin') or headers.get('origin')
    
    try:
        # Handle HTTP API Gateway request
        http_method = event.get('httpMethod', 'GET')
        logger.info(f"🔍 Processing {http_method} request")
        
        # Handle CORS preflight
        if http_method == 'OPTIONS':
            logger.info("✅ Handling CORS preflight request")
            return create_response(200, {'message': 'CORS preflight'})
        
        # Handle GET requests - can fetch current spending or historical data
        if http_method == 'GET':
            # Check if requesting summary data
            query_params = event.get('queryStringParameters') or {}
            logger.info(f"📋 Query parameters: {query_params}")
            
            if query_params.get('summary') == 'true':
                requested_year = query_params.get('year')
                # Fetch live spending data from AWS Cost Explorer
                logger.info("📊 Fetching live spending data from AWS Cost Explorer")
                
                # Get current billing period (end_date should be tomorrow to include today)
                start_date, end_date = get_current_billing_period()
                # For live data, include today by setting end_date to tomorrow
                today = datetime.now()
                end_date_live = (today + timedelta(days=1)).strftime('%Y-%m-%d')
                current_month = today.strftime('%Y-%m')
                logger.info(f"🗓️ Current month: {current_month} ({start_date} to {end_date_live})")
                
                try:
                    # Fetch current month's cost data WITHOUT grouping for accurate total
                    cost_data = get_cost_and_usage(start_date, end_date_live, include_grouping=False)
                    logger.info(f"📈 Cost Explorer response received")
                    
                    # Log response structure for debugging (truncated to avoid log limits)
                    if 'ResultsByTime' in cost_data and len(cost_data['ResultsByTime']) > 0:
                        first_result = cost_data['ResultsByTime'][0]
                        logger.info(f"🔍 First result structure: TimePeriod={first_result.get('TimePeriod')}, Has Total={'Total' in first_result}, Total keys={list(first_result.get('Total', {}).keys()) if 'Total' in first_result else []}")
                    
                    # Calculate totals for current month
                    totals = calculate_totals(cost_data)
                    current_total = totals.get('blended_cost', 0.0)
                    logger.info(f"💰 Current month total (live): ${current_total:.2f}")
                    
                    # Store current month data to spendings/YYYY/MM.csv
                    year_month = current_month.replace('-', '/')
                    csv_key = f"spendings/{year_month}.csv"
                    
                    try:
                        # Prepare current month CSV
                        current_month_row = {
                            'month': current_month,
                            'start_date': start_date,
                            'end_date': today.strftime('%Y-%m-%d'),
                            'blended_cost': f"{current_total:.2f}",
                            'unblended_cost': f"{totals.get('unblended_cost', 0.0):.2f}",
                            'usage_quantity': f"{totals.get('usage_quantity', 0.0):.2f}",
                            'currency': 'USD',
                            'updated_at': datetime.now().isoformat()
                        }
                        
                        # Write current month CSV
                        output = io.StringIO()
                        fieldnames = ['month', 'start_date', 'end_date', 'blended_cost', 'unblended_cost', 'usage_quantity', 'currency', 'updated_at']
                        writer = csv.DictWriter(output, fieldnames=fieldnames)
                        writer.writeheader()
                        writer.writerow(current_month_row)
                        
                        s3_client.put_object(
                            Bucket=SPENDING_BUCKET_NAME,
                            Key=csv_key,
                            Body=output.getvalue(),
                            ContentType='text/csv',
                            ServerSideEncryption='aws:kms'
                        )
                        logger.info(f"✅ Stored current month spending to: {csv_key}")
                    except ClientError as e:
                        logger.error(f"⚠️ Failed to store current month CSV: {str(e)}")
                        # Don't fail the request, just log warning
                    
                    # Get all historical spending months from spendings/ folder
                    monthly_data = []
                    seen_months = set()
                    available_years = set()
                    try:
                        # List all YYYY/MM.csv files in spendings/
                        paginator = s3_client.get_paginator('list_objects_v2')
                        pages = paginator.paginate(
                            Bucket=SPENDING_BUCKET_NAME,
                            Prefix='spendings/'
                        )
                        
                        month_files = []
                        for page in pages:
                            if 'Contents' in page:
                                for obj in page['Contents']:
                                    key = obj['Key']
                                    # Match pattern: spendings/YYYY/MM.csv
                                    if key.endswith('.csv') and key.count('/') == 2:
                                        month_files.append(key)
                        
                        logger.info(f"📚 Found {len(month_files)} month files in spendings/")
                        
                        # Read each month file and extract data
                        for month_file in sorted(month_files, reverse=True):  # Newest first
                            try:
                                response = s3_client.get_object(Bucket=SPENDING_BUCKET_NAME, Key=month_file)
                                csv_content = response['Body'].read().decode('utf-8')
                                reader = csv.DictReader(io.StringIO(csv_content))
                                
                                for row in reader:
                                    month_key = row.get('month')
                                    if not month_key:
                                        # Derive from key if missing
                                        parts = month_file.split('/')
                                        if len(parts) >= 3:
                                            month_key = f"{parts[1]}-{parts[2].replace('.csv', '')}"
                                    if month_key:
                                        year = month_key.split('-')[0]
                                        available_years.add(year)
                                        if requested_year and year != requested_year:
                                            continue
                                        # Get earnings for this month
                                        earnings = get_earnings_for_month(month_key)
                                        
                                        # Add earnings data to spending row
                                        row['total_earnings'] = f"{earnings['total_earnings']:.2f}"
                                        row['payment_count'] = str(earnings['payment_count'])
                                        monthly_data.append(row)
                                        seen_months.add(month_key)
                            except ClientError as e:
                                logger.warning(f"⚠️ Failed to read {month_file}: {str(e)}")
                                continue
                        
                        logger.info(f"📊 Loaded {len(monthly_data)} months with earnings data")

                        # Sort combined data newest first
                        monthly_data = sorted(monthly_data, key=lambda r: r.get('month', ''), reverse=True)
                        available_years_list = sorted(list(available_years), reverse=True)
                    except Exception as e:
                        logger.error(f"❌ Error listing spending months: {str(e)}")
                        monthly_data = []
                        available_years_list = []
                    
                    return create_response(200, {
                        'success': True,
                        'current_month_total': current_total,
                        'monthly_data': monthly_data,
                        'available_years': available_years_list,
                        'requested_year': requested_year,
                        'live_data': True
                    })
                except ClientError as e:
                    error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                    error_message = e.response.get('Error', {}).get('Message', str(e))
                    logger.error(f"❌ Cost Explorer error ({error_code}): {error_message}")
                    return create_response(500, {
                        'success': False,
                        'error': f'Failed to fetch spending data: {error_message}',
                        'code': error_code
                    })
            else:
                # No query parameters or unsupported query params - return error
                logger.warning("❌ Invalid or unsupported query parameters")
                return create_response(400, {
                    'success': False,
                    'error': 'Missing required query parameter: summary=true'
                })
        else:
            logger.warning(f"❌ Unsupported HTTP method: {http_method}")
            return create_response(405, {'error': 'Method not allowed'})
        
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

