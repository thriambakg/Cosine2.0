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
# AWS_REGION is automatically available in Lambda runtime context
# Use boto3's default region (Lambda automatically sets this)
AWS_REGION = boto3.Session().region_name or 'us-east-1'

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

def handle_scheduled_event(event: Dict) -> Dict:
    """Handle scheduled EventBridge event - create monthly summary for previous month"""
    logger.info("📅 Processing scheduled monthly summary generation")
    
    # Calculate previous month's date range
    today = datetime.now()
    # First day of current month
    first_of_current = today.replace(day=1)
    # Last day of previous month
    last_of_previous = first_of_current - timedelta(days=1)
    # First day of previous month
    first_of_previous = last_of_previous.replace(day=1)
    
    start_date = first_of_previous.strftime('%Y-%m-%d')
    end_date = (last_of_previous + timedelta(days=1)).strftime('%Y-%m-%d')  # Exclusive end date
    month_key = first_of_previous.strftime('%Y-%m')
    
    logger.info(f"📊 Generating monthly summary for {month_key} ({start_date} to {end_date})")
    
    try:
        # Fetch previous month's cost data WITH grouping for detailed breakdown
        cost_data = get_cost_and_usage(start_date, end_date, include_grouping=True)
        logger.info(f"📈 Cost Explorer response received for previous month")
        
        # Calculate totals
        totals = calculate_totals(cost_data)
        
        # Store monthly detailed CSV
        monthly_csv_key = store_monthly_spending_csv(cost_data, month_key, start_date, end_date)
        
        # Update monthly summary table (include earnings data)
        summary_key = update_monthly_summary(totals, start_date, end_date, month_key)
        
        logger.info(f"✅ Monthly summary generated successfully for {month_key}")
        return {
            'statusCode': 200,
            'body': json.dumps({
                'success': True,
                'month': month_key,
                'period': {
                    'start': start_date,
                    'end': end_date
                },
                'totals': totals,
                'stored': {
                    'monthly_csv': monthly_csv_key,
                    'summary': summary_key
                },
                'message': f'Monthly summary generated for {month_key}'
            }, default=str)
        }
    except Exception as e:
        logger.error(f"❌ Error generating monthly summary: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'body': json.dumps({
                'success': False,
                'error': f'Failed to generate monthly summary: {str(e)}'
            }, default=str)
        }

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

def update_monthly_summary(totals: Dict[str, float], start_date: str, end_date: str, month_key: str = None) -> str:
    """Update monthly totals in shared summary CSV at root, including earnings data"""
    if month_key is None:
        month_key = datetime.now().strftime('%Y-%m')
    csv_key = "monthly_summary.csv"
    
    # Get earnings data for this month
    earnings_data = get_earnings_for_month(month_key)
    logger.info(f"💰 Earnings for {month_key}: ${earnings_data['total_earnings']:.2f} ({earnings_data['payment_count']} payments)")
    
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
    
    # Add new row with earnings data
    new_row = {
        'month': month_key,
        'start_date': start_date,
        'end_date': end_date,
        'blended_cost': f"{totals['blended_cost']:.2f}",
        'unblended_cost': f"{totals['unblended_cost']:.2f}",
        'usage_quantity': f"{totals['usage_quantity']:.2f}",
        'total_earnings': f"{earnings_data['total_earnings']:.2f}",
        'payment_count': str(earnings_data['payment_count']),
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
    fieldnames = ['month', 'start_date', 'end_date', 'blended_cost', 'unblended_cost', 'usage_quantity', 'total_earnings', 'payment_count', 'currency', 'updated_at']
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
        logger.info(f"✅ Updated monthly summary CSV: {csv_key} (with earnings: ${earnings_data['total_earnings']:.2f})")
        return csv_key
    except ClientError as e:
        logger.error(f"Error storing monthly summary: {str(e)}")
        raise

def lambda_handler(event: Dict, context: Any) -> Dict:
    """Main Lambda handler"""
    logger.info(f"📥 Received event: {json.dumps(event, default=str)}")
    
    try:
        # Check if this is a scheduled EventBridge event
        if 'source' in event and event.get('source') == 'aws.events':
            logger.info("📅 Processing scheduled EventBridge event - creating monthly summary")
            return handle_scheduled_event(event)
        
        # Otherwise, handle HTTP API Gateway request
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
                    
                    # Get historical data from S3 for the table (no fallbacks)
                    monthly_data = []
                    try:
                        response = s3_client.get_object(Bucket=SPENDING_BUCKET_NAME, Key='monthly_summary.csv')
                        csv_content = response['Body'].read().decode('utf-8')
                        reader = csv.DictReader(io.StringIO(csv_content))
                        monthly_data = list(reader)
                        logger.info(f"📚 Found {len(monthly_data)} months of historical data from S3")
                        
                        # Update current month in historical data with live value
                        updated = False
                        earnings_data = get_earnings_for_month(current_month)
                        for row in monthly_data:
                            if row.get('month') == current_month:
                                row['blended_cost'] = f"{current_total:.2f}"
                                row['unblended_cost'] = f"{totals.get('unblended_cost', 0.0):.2f}"
                                row['usage_quantity'] = f"{totals.get('usage_quantity', 0.0):.2f}"
                                row['total_earnings'] = f"{earnings_data['total_earnings']:.2f}"
                                row['payment_count'] = str(earnings_data['payment_count'])
                                row['updated_at'] = datetime.now().isoformat()
                                updated = True
                                logger.info(f"🔄 Updated current month in historical data")
                                break
                    except ClientError as e:
                        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
                        if error_code == 'NoSuchKey':
                            logger.warning("⚠️ monthly_summary.csv not found in S3 - returning empty data. Run scheduled event to generate summary files.")
                            monthly_data = []
                        else:
                            logger.error(f"❌ Error reading monthly summary from S3: {str(e)}")
                            raise
                    
                    return create_response(200, {
                        'success': True,
                        'current_month_total': current_total,
                        'monthly_data': monthly_data,
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
            elif query_params.get('list_reports') == 'true':
                # List all monthly reports available for download
                logger.info("📋 Listing monthly spending reports")
                try:
                    # List all objects in spendings/ prefix
                    response = s3_client.list_objects_v2(
                        Bucket=SPENDING_BUCKET_NAME,
                        Prefix='spendings/',
                        Delimiter='/'
                    )
                    
                    reports = []
                    if 'CommonPrefixes' in response:
                        # Get monthly folders (YYYY/MM/)
                        for prefix in response['CommonPrefixes']:
                            folder_path = prefix['Prefix']  # e.g., "spendings/2025/12/"
                            parts = folder_path.rstrip('/').split('/')
                            if len(parts) >= 3:
                                year = parts[1]
                                month = parts[2]
                                month_key = f"{year}-{month}"
                                
                                # Check if CSV file exists in this folder
                                csv_key = f"spendings/{year}/{month}.csv"
                                try:
                                    s3_client.head_object(Bucket=SPENDING_BUCKET_NAME, Key=csv_key)
                                    reports.append({
                                        'month': month_key,
                                        'year': year,
                                        'month_num': month,
                                        's3_key': csv_key,
                                        'filename': f"{month_key}-spending-report.csv"
                                    })
                                except ClientError:
                                    logger.warning(f"⚠️ Monthly report not found: {csv_key}")
                    
                    # Sort by month (newest first)
                    reports.sort(key=lambda x: x['month'], reverse=True)
                    
                    logger.info(f"📊 Found {len(reports)} monthly reports")
                    return create_response(200, {
                        'success': True,
                        'reports': reports
                    })
                except ClientError as e:
                    logger.error(f"❌ Error listing reports: {str(e)}")
                    return create_response(500, {
                        'success': False,
                        'error': f'Failed to list reports: {str(e)}'
                    })
            elif query_params.get('download') and query_params.get('month'):
                # Generate presigned URL for monthly report download
                month = query_params.get('month')  # Format: YYYY-MM
                year_month_path = month.replace('-', '/')
                csv_key = f"spendings/{year_month_path}.csv"
                
                logger.info(f"🔗 Generating presigned URL for: {csv_key}")
                try:
                    # Verify file exists
                    s3_client.head_object(Bucket=SPENDING_BUCKET_NAME, Key=csv_key)
                    
                    # Generate presigned URL (valid for 1 hour)
                    presigned_url = s3_client.generate_presigned_url(
                        'get_object',
                        Params={'Bucket': SPENDING_BUCKET_NAME, 'Key': csv_key},
                        ExpiresIn=3600
                    )
                    
                    logger.info(f"✅ Generated presigned URL for {csv_key}")
                    return create_response(200, {
                        'success': True,
                        'month': month,
                        's3_key': csv_key,
                        'presigned_url': presigned_url,
                        'expires_in': 3600
                    })
                except ClientError as e:
                    if e.response.get('Error', {}).get('Code') == '404':
                        logger.warning(f"⚠️ Report not found: {csv_key}")
                        return create_response(404, {
                            'success': False,
                            'error': f'Monthly report for {month} not found'
                        })
                    logger.error(f"❌ Error generating presigned URL: {str(e)}")
                    return create_response(500, {
                        'success': False,
                        'error': f'Failed to generate download URL: {str(e)}'
                    })
            else:
                # Default behavior - just return current month summary (no storage)
                logger.info("🔄 Fetching current month spending data (no storage)")
                start_date, end_date = get_current_billing_period()
                today = datetime.now()
                end_date_live = (today + timedelta(days=1)).strftime('%Y-%m-%d')
                current_month = today.strftime('%Y-%m')
                
                cost_data = get_cost_and_usage(start_date, end_date_live, include_grouping=False)
                totals = calculate_totals(cost_data)
                
                return create_response(200, {
                    'success': True,
                    'period': {
                        'start': start_date,
                        'end': end_date_live,
                        'month': current_month
                    },
                    'totals': totals,
                    'message': 'Current month spending data fetched'
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

