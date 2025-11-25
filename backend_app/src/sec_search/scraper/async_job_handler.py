"""
Async job handler for SEC search
Handles background processing of large searches to avoid API Gateway timeouts
"""

import json
import os
import logging
import boto3
import uuid
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from decimal import Decimal

logger = logging.getLogger()

# DynamoDB configuration
DYNAMODB_TABLE_NAME = os.environ.get('SEC_FILINGS_CACHE_TABLE')
dynamodb = boto3.resource('dynamodb') if DYNAMODB_TABLE_NAME else None
cache_table = dynamodb.Table(DYNAMODB_TABLE_NAME) if dynamodb and DYNAMODB_TABLE_NAME else None

# Lambda client for async invocation
lambda_client = boto3.client('lambda')
LAMBDA_FUNCTION_NAME = os.environ.get('AWS_LAMBDA_FUNCTION_NAME')

# SNS client for progress updates
sns_client = boto3.client('sns')
SNS_TOPIC_ARN = os.environ.get('SEC_SEARCH_PROGRESS_SNS_TOPIC_ARN')


def create_job(search_params: Dict[str, Any]) -> str:
    """
    Create a new async search job and return job_id
    
    Args:
        search_params: Search parameters
        
    Returns:
        job_id: Unique job identifier
    """
    job_id = f"JOB#{uuid.uuid4().hex[:16]}"
    
    if not cache_table:
        logger.error("DynamoDB table not configured")
        return job_id
    
    try:
        # Store initial job status
        # Use job_id as the primary key (DynamoDB table uses 'filingId' as key)
        job_item = {
            'filingId': job_id,  # Primary key field name in DynamoDB
            'job_status': 'PENDING',
            'job_progress': {
                'current_page': 0,
                'total_pages': None,
                'results_count': 0,
                'total_found': 0
            },
            'search_params': search_params,
            'created_at': datetime.now(timezone.utc).isoformat(),
            'updated_at': datetime.now(timezone.utc).isoformat(),
            'ttl': int((datetime.now(timezone.utc).timestamp() + 3600))  # Expire after 1 hour
        }
        
        cache_table.put_item(Item=job_item)
        logger.info(f"Created job {job_id}")
        
        return job_id
    except Exception as e:
        logger.error(f"Error creating job: {e}")
        return job_id


def publish_progress_to_sns(job_id: str, current_page: int, total_pages: Optional[int], 
                            results_count: int, total_found: int, status: str = 'IN_PROGRESS'):
    """
    Publish job progress to SNS topic (decoupled from DynamoDB update)
    
    Args:
        job_id: Job identifier
        current_page: Current page being processed
        total_pages: Total pages (None if unknown)
        results_count: Number of results collected so far
        total_found: Total results found
        status: Job status (IN_PROGRESS, COMPLETED, FAILED)
    """
    if not SNS_TOPIC_ARN:
        logger.warning("SNS topic ARN not configured, skipping progress publish")
        return
    
    try:
        progress_message = {
            'job_id': job_id,
            'current_page': current_page,
            'total_pages': total_pages,
            'results_count': results_count,
            'total_found': total_found,
            'status': status,
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        sns_client.publish(
            TopicArn=SNS_TOPIC_ARN,
            Message=json.dumps(progress_message),
            Subject=f'SEC Search Progress: {job_id}'
        )
        
        logger.info(f"Published progress to SNS for job {job_id}: page {current_page}/{total_pages}")
    except Exception as e:
        logger.error(f"Error publishing progress to SNS: {e}")


def update_job_progress(job_id: str, current_page: int, total_pages: Optional[int], 
                       results_count: int, total_found: int, status: str = 'IN_PROGRESS'):
    """
    Update job progress in DynamoDB via SNS (decoupled approach)
    
    Args:
        job_id: Job identifier
        current_page: Current page being processed
        total_pages: Total pages (None if unknown)
        results_count: Number of results collected so far
        total_found: Total results found
        status: Job status (IN_PROGRESS, COMPLETED, FAILED)
    """
    # Publish to SNS - subscriber Lambda will update DynamoDB
    publish_progress_to_sns(job_id, current_page, total_pages, results_count, total_found, status)


def complete_job(job_id: str, results: Dict[str, Any]):
    """
    Mark job as completed and publish results to SNS (subscriber will update DynamoDB)
    
    Args:
        job_id: Job identifier
        results: Search results to store
    """
    if not SNS_TOPIC_ARN:
        logger.warning("SNS topic ARN not configured, cannot complete job")
        return
    
    try:
        # Check if results are too large for SNS (256KB limit)
        results_json = json.dumps(results)
        results_size = len(results_json.encode('utf-8'))
        
        # If results are too large (>200KB to leave room for other fields), store in S3 first
        if results_size > 200 * 1024:  # 200KB threshold
            logger.info(f"Results for job {job_id} are large ({results_size} bytes), storing in S3")
            s3_client = boto3.client('s3')
            s3_bucket = os.environ.get('SEC_FILINGS_S3_BUCKET', 'cosine-sec-filings-production')
            s3_key = f"jobs/{job_id}/results.json"
            s3_client.put_object(
                Bucket=s3_bucket,
                Key=s3_key,
                Body=results_json,
                ContentType='application/json'
            )
            logger.info(f"Stored job {job_id} results in S3: {s3_key}")
            
            # Publish S3 reference to SNS
            completion_message = {
                'job_id': job_id,
                'status': 'COMPLETED',
                'results_s3_key': s3_key,
                'results_count': len(results.get('results', [])),
                'total_found': results.get('total_found', 0),
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
        else:
            # Results are small enough, include them directly
            completion_message = {
                'job_id': job_id,
                'status': 'COMPLETED',
                'results': results,
                'results_count': len(results.get('results', [])),
                'total_found': results.get('total_found', 0),
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
        
        # Publish completion to SNS
        sns_client.publish(
            TopicArn=SNS_TOPIC_ARN,
            Message=json.dumps(completion_message),
            Subject=f'SEC Search Completed: {job_id}'
        )
        
        logger.info(f"Published job {job_id} completion to SNS with {completion_message.get('results_count', 0)} results")
    except Exception as e:
        logger.error(f"Error completing job {job_id}: {e}", exc_info=True)


def fail_job(job_id: str, error: str):
    """
    Mark job as failed and publish to SNS (subscriber will update DynamoDB)
    
    Args:
        job_id: Job identifier
        error: Error message
    """
    if not SNS_TOPIC_ARN:
        logger.warning("SNS topic ARN not configured, cannot fail job")
        return
    
    try:
        failure_message = {
            'job_id': job_id,
            'status': 'FAILED',
            'error': error,
            'timestamp': datetime.now(timezone.utc).isoformat()
            }
        
        # Publish failure to SNS
        sns_client.publish(
            TopicArn=SNS_TOPIC_ARN,
            Message=json.dumps(failure_message),
            Subject=f'SEC Search Failed: {job_id}'
        )
        
        logger.info(f"Published job {job_id} failure to SNS: {error}")
    except Exception as e:
        logger.error(f"Error failing job {job_id}: {e}", exc_info=True)


def cancel_job(job_id: str) -> bool:
    """
    Cancel a running job
    
    Args:
        job_id: Job identifier
        
    Returns:
        True if job was cancelled, False otherwise
    """
    if not cache_table:
        return False
    
    try:
        # Check if job exists and is cancellable
        response = cache_table.get_item(Key={'filingId': job_id})
        if 'Item' not in response:
            logger.warning(f"Job {job_id} not found for cancellation")
            return False
        
        item = response['Item']
        current_status = item.get('job_status', 'UNKNOWN')
        
        # Only cancel if job is pending or in progress
        if current_status not in ['PENDING', 'IN_PROGRESS']:
            logger.info(f"Job {job_id} cannot be cancelled (status: {current_status})")
            return False
        
        # Set cancellation flag
        cache_table.update_item(
            Key={'filingId': job_id},
            UpdateExpression='SET job_status = :status, job_cancelled = :cancelled, updated_at = :updated',
            ExpressionAttributeValues={
                ':status': 'CANCELLED',
                ':cancelled': True,
                ':updated': datetime.now(timezone.utc).isoformat()
            }
        )
        logger.info(f"Cancelled job {job_id}")
        return True
    except Exception as e:
        logger.error(f"Error cancelling job: {e}")
        return False


def is_job_cancelled(job_id: str) -> bool:
    """
    Check if a job has been cancelled
    
    Args:
        job_id: Job identifier
        
    Returns:
        True if job is cancelled, False otherwise
    """
    if not cache_table:
        return False
    
    try:
        response = cache_table.get_item(Key={'filingId': job_id})
        if 'Item' in response:
            item = response['Item']
            return item.get('job_cancelled', False) or item.get('job_status') == 'CANCELLED'
        return False
    except Exception as e:
        logger.error(f"Error checking job cancellation status: {e}")
        return False


def convert_decimals(obj):
    """
    Recursively convert Decimal types to native Python types for JSON serialization
    
    Args:
        obj: Object that may contain Decimal values
        
    Returns:
        Object with Decimal values converted to int or float
    """
    if isinstance(obj, Decimal):
        # Convert Decimal to int if it's a whole number, otherwise float
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    elif isinstance(obj, dict):
        return {key: convert_decimals(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimals(item) for item in obj]
    return obj


def get_job_status(job_id: str) -> Optional[Dict[str, Any]]:
    """
    Get job status from DynamoDB
    
    Args:
        job_id: Job identifier
        
    Returns:
        Job status dictionary or None if not found
    """
    if not cache_table:
        return None
    
    try:
        response = cache_table.get_item(Key={'filingId': job_id})
        if 'Item' in response:
            item = response['Item']
            job_status = {
                'job_id': job_id,
                'status': item.get('job_status', 'UNKNOWN'),
                'progress': item.get('job_progress', {}),
                'results': item.get('job_results'),
                'results_s3_key': item.get('job_results_s3_key'),
                'error': item.get('error') or item.get('job_error'),  # Support both field names
                'cancelled': item.get('job_cancelled', False) or item.get('job_status') == 'CANCELLED',
                'created_at': item.get('created_at'),
                'updated_at': item.get('updated_at')
            }
            # Convert Decimal types to native Python types for JSON serialization
            return convert_decimals(job_status)
        return None
    except Exception as e:
        logger.error(f"Error getting job status: {e}")
        return None


def invoke_async_search(job_id: str, search_params: Dict[str, Any]):
    """
    Invoke Lambda function asynchronously to process search
    
    Args:
        job_id: Job identifier
        search_params: Search parameters
    """
    if not LAMBDA_FUNCTION_NAME:
        logger.error("Lambda function name not configured")
        return
    
    try:
        payload = {
            'async_job': True,
            'job_id': job_id,
            'search_params': search_params
        }
        
        lambda_client.invoke(
            FunctionName=LAMBDA_FUNCTION_NAME,
            InvocationType='Event',  # Async invocation
            Payload=json.dumps(payload)
        )
        logger.info(f"Invoked async search for job {job_id}")
    except Exception as e:
        logger.error(f"Error invoking async search: {e}")
        fail_job(job_id, f"Failed to invoke async search: {str(e)}")


