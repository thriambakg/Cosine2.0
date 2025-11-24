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

logger = logging.getLogger()

# DynamoDB configuration
DYNAMODB_TABLE_NAME = os.environ.get('SEC_FILINGS_CACHE_TABLE')
dynamodb = boto3.resource('dynamodb') if DYNAMODB_TABLE_NAME else None
cache_table = dynamodb.Table(DYNAMODB_TABLE_NAME) if dynamodb and DYNAMODB_TABLE_NAME else None

# Lambda client for async invocation
lambda_client = boto3.client('lambda')
LAMBDA_FUNCTION_NAME = os.environ.get('AWS_LAMBDA_FUNCTION_NAME')


def create_job(search_params: Dict[str, Any], user_id: Optional[str] = None) -> str:
    """
    Create a new async search job and return job_id
    
    Args:
        search_params: Search parameters
        user_id: User ID for WebSocket streaming (optional)
        
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
        
        # Store user_id if provided (for WebSocket streaming)
        if user_id:
            job_item['user_id'] = user_id
        
        cache_table.put_item(Item=job_item)
        logger.info(f"Created job {job_id} for user {user_id or 'unknown'}")
        
        return job_id
    except Exception as e:
        logger.error(f"Error creating job: {e}")
        return job_id


def update_job_progress(job_id: str, current_page: int, total_pages: Optional[int], 
                       results_count: int, total_found: int, status: str = 'IN_PROGRESS'):
    """
    Update job progress in DynamoDB
    
    Args:
        job_id: Job identifier
        current_page: Current page being processed
        total_pages: Total pages (None if unknown)
        results_count: Number of results collected so far
        total_found: Total results found
        status: Job status (IN_PROGRESS, COMPLETED, FAILED)
    """
    if not cache_table:
        return
    
    try:
        cache_table.update_item(
            Key={'filingId': job_id},
            UpdateExpression='SET job_status = :status, job_progress = :progress, updated_at = :updated',
            ExpressionAttributeValues={
                ':status': status,
                ':progress': {
                    'current_page': current_page,
                    'total_pages': total_pages,
                    'results_count': results_count,
                    'total_found': total_found
                },
                ':updated': datetime.now(timezone.utc).isoformat()
            }
        )
        logger.info(f"📄 Job {job_id}: Page {current_page}{f'/{total_pages}' if total_pages else ''} - {results_count} results")
    except Exception as e:
        logger.error(f"Error updating job progress: {e}")


def complete_job(job_id: str, results: Dict[str, Any]):
    """
    Mark job as completed and store results
    
    Args:
        job_id: Job identifier
        results: Search results to store
    """
    if not cache_table:
        return
    
    try:
        # Store results in DynamoDB (may need to split if too large)
        # For large results, we could store in S3 and reference it
        cache_table.update_item(
            Key={'filingId': job_id},
            UpdateExpression='SET job_status = :status, job_results = :results, updated_at = :updated',
            ExpressionAttributeValues={
                ':status': 'COMPLETED',
                ':results': results,
                ':updated': datetime.now(timezone.utc).isoformat()
            }
        )
        logger.info(f"Completed job {job_id} with {len(results.get('results', []))} results")
    except Exception as e:
        logger.error(f"Error completing job: {e}")
        # If results are too large, store in S3
        try:
            s3_client = boto3.client('s3')
            s3_bucket = os.environ.get('SEC_FILINGS_S3_BUCKET', 'cosine-sec-filings-production')
            s3_key = f"jobs/{job_id}/results.json"
            s3_client.put_object(
                Bucket=s3_bucket,
                Key=s3_key,
                Body=json.dumps(results),
                ContentType='application/json'
            )
            # Store S3 reference in DynamoDB
            cache_table.update_item(
                Key={'filingId': job_id},
                UpdateExpression='SET job_status = :status, job_results_s3_key = :s3_key, updated_at = :updated',
                ExpressionAttributeValues={
                    ':status': 'COMPLETED',
                    ':s3_key': s3_key,
                    ':updated': datetime.now(timezone.utc).isoformat()
                }
            )
            logger.info(f"Stored job {job_id} results in S3: {s3_key}")
        except Exception as s3_error:
            logger.error(f"Error storing results in S3: {s3_error}")


def fail_job(job_id: str, error: str):
    """
    Mark job as failed
    
    Args:
        job_id: Job identifier
        error: Error message
    """
    if not cache_table:
        return
    
    try:
        cache_table.update_item(
            Key={'filingId': job_id},
            UpdateExpression='SET job_status = :status, job_error = :error, updated_at = :updated',
            ExpressionAttributeValues={
                ':status': 'FAILED',
                ':error': error,
                ':updated': datetime.now(timezone.utc).isoformat()
            }
        )
        logger.error(f"Failed job {job_id}: {error}")
    except Exception as e:
        logger.error(f"Error failing job: {e}")


def cancel_job(job_id: str) -> bool:
    """
    Cancel a running job
    
    Args:
        job_id: Job identifier
        
    Returns:
        True if job was cancelled, False otherwise
    """
    if not cache_table:
        logger.error(f"🛑 CANCEL: DynamoDB table not configured, cannot cancel job {job_id}")
        return False
    
    try:
        # Check if job exists and is cancellable
        response = cache_table.get_item(Key={'filingId': job_id})
        if 'Item' not in response:
            logger.warning(f"🛑 CANCEL: Job {job_id} not found for cancellation")
            return False
        
        item = response['Item']
        current_status = item.get('job_status', 'UNKNOWN')
        current_page = item.get('job_progress', {}).get('current_page', 0)
        total_pages = item.get('job_progress', {}).get('total_pages')
        
        # Only cancel if job is pending or in progress
        if current_status not in ['PENDING', 'IN_PROGRESS']:
            logger.info(f"🛑 CANCEL: Job {job_id} cannot be cancelled (status: {current_status})")
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
        logger.info(f"🛑 CANCEL: Job {job_id} cancelled successfully (was on page {current_page}{f'/{total_pages}' if total_pages else ''})")
        return True
    except Exception as e:
        logger.error(f"🛑 CANCEL ERROR: Failed to cancel job {job_id}: {e}")
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
            return {
                'job_id': job_id,
                'status': item.get('job_status', 'UNKNOWN'),
                'progress': item.get('job_progress', {}),
                'results': item.get('job_results'),
                'results_s3_key': item.get('job_results_s3_key'),
                'error': item.get('job_error'),
                'cancelled': item.get('job_cancelled', False),
                'created_at': item.get('created_at'),
                'updated_at': item.get('updated_at')
            }
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
    # AWS_LAMBDA_FUNCTION_NAME is automatically set by Lambda runtime
    function_name = LAMBDA_FUNCTION_NAME or os.environ.get('AWS_LAMBDA_FUNCTION_NAME')
    
    if not function_name:
        error_msg = "Lambda function name not configured - cannot invoke async search"
        logger.error(f"❌ {error_msg}")
        logger.error(f"Environment variables: AWS_LAMBDA_FUNCTION_NAME={os.environ.get('AWS_LAMBDA_FUNCTION_NAME')}")
        fail_job(job_id, error_msg)
        return
    
    try:
        payload = {
            'async_job': True,
            'job_id': job_id,
            'search_params': search_params
        }
        
        logger.info(f"🔄 Invoking async search for job {job_id} with function {function_name}")
        logger.debug(f"Payload: {json.dumps(payload)[:200]}...")
        
        response = lambda_client.invoke(
            FunctionName=function_name,
            InvocationType='Event',  # Async invocation
            Payload=json.dumps(payload)
        )
        
        status_code = response.get('StatusCode')
        logger.info(f"✅ Invoked async search for job {job_id} - StatusCode: {status_code}")
        
        if status_code != 202:
            logger.warning(f"⚠️ Unexpected status code {status_code} for async invocation")
            
    except Exception as e:
        error_msg = f"Failed to invoke async search: {str(e)}"
        logger.error(f"❌ Error invoking async search for job {job_id}: {e}")
        logger.exception(e)  # Log full traceback
        fail_job(job_id, error_msg)

