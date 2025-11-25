"""
Lambda function that subscribes to SNS progress events and updates DynamoDB
This decouples progress updates from the main search Lambda
"""

import json
import os
import logging
import boto3
from typing import Dict, Any

logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# DynamoDB configuration
DYNAMODB_TABLE_NAME = os.environ.get('SEC_FILINGS_CACHE_TABLE')
dynamodb = boto3.resource('dynamodb') if DYNAMODB_TABLE_NAME else None
cache_table = dynamodb.Table(DYNAMODB_TABLE_NAME) if dynamodb and DYNAMODB_TABLE_NAME else None


def update_job_progress(job_id: str, progress_data: Dict[str, Any]) -> bool:
    """
    Update job progress in DynamoDB
    
    Args:
        job_id: Job identifier
        progress_data: Progress data containing current_page, total_pages, results_count, total_found
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not cache_table:
        logger.error("DynamoDB table not configured")
        return False
    
    try:
        # Update job progress in DynamoDB
        update_expression = "SET job_status = :status, job_progress = :progress, updated_at = :updated_at"
        expression_values = {
            ':status': 'IN_PROGRESS',
            ':progress': {
                'current_page': progress_data.get('current_page', 0),
                'total_pages': progress_data.get('total_pages'),
                'results_count': progress_data.get('results_count', 0),
                'total_found': progress_data.get('total_found', 0)
            },
            ':updated_at': progress_data.get('timestamp', '')
        }
        
        cache_table.update_item(
            Key={'filingId': job_id},
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_values,
            ReturnValues='ALL_NEW'
        )
        
        logger.info(f"Updated progress for job {job_id}: page {progress_data.get('current_page')}/{progress_data.get('total_pages')}")
        return True
        
    except Exception as e:
        logger.error(f"Error updating job progress for {job_id}: {e}")
        return False


def update_job_completion(job_id: str, completion_data: Dict[str, Any]) -> bool:
    """
    Update job completion in DynamoDB
    
    Args:
        job_id: Job identifier
        completion_data: Completion data containing results or results_s3_key
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not cache_table:
        logger.error("DynamoDB table not configured")
        return False
    
    try:
        # Build update expression based on whether results are in S3 or inline
        if 'results_s3_key' in completion_data:
            # Results stored in S3
            update_expression = "SET job_status = :status, job_results_s3_key = :s3_key, updated_at = :updated_at"
            expression_values = {
                ':status': 'COMPLETED',
                ':s3_key': completion_data.get('results_s3_key'),
                ':updated_at': completion_data.get('timestamp', '')
            }
        else:
            # Results included inline
            update_expression = "SET job_status = :status, job_results = :results, updated_at = :updated_at"
            expression_values = {
                ':status': 'COMPLETED',
                ':results': completion_data.get('results'),
                ':updated_at': completion_data.get('timestamp', '')
            }
        
        cache_table.update_item(
            Key={'filingId': job_id},
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_values,
            ReturnValues='ALL_NEW'
        )
        
        results_count = completion_data.get('results_count', 0)
        logger.info(f"Updated completion for job {job_id}: {results_count} results")
        return True
        
    except Exception as e:
        logger.error(f"Error updating job completion for {job_id}: {e}")
        return False


def update_job_failure(job_id: str, failure_data: Dict[str, Any]) -> bool:
    """
    Update job failure in DynamoDB
    
    Args:
        job_id: Job identifier
        failure_data: Failure data containing error message
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not cache_table:
        logger.error("DynamoDB table not configured")
        return False
    
    try:
        update_expression = "SET job_status = :status, error = :error, updated_at = :updated_at"
        expression_values = {
            ':status': 'FAILED',
            ':error': failure_data.get('error', 'Unknown error'),
            ':updated_at': failure_data.get('timestamp', '')
        }
        
        cache_table.update_item(
            Key={'filingId': job_id},
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_values,
            ReturnValues='ALL_NEW'
        )
        
        error_msg = failure_data.get('error', 'Unknown error')
        logger.info(f"Updated failure for job {job_id}: {error_msg}")
        return True
        
    except Exception as e:
        logger.error(f"Error updating job failure for {job_id}: {e}")
        return False


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Handle SNS event and update DynamoDB with progress
    
    Args:
        event: SNS event containing progress update
        context: Lambda context
        
    Returns:
        Dict with statusCode
    """
    try:
        # SNS events come wrapped in Records
        for record in event.get('Records', []):
            if record.get('EventSource') != 'aws:sns':
                logger.warning(f"Unexpected event source: {record.get('EventSource')}")
                continue
            
            # Parse SNS message
            sns_message = record.get('Sns', {})
            message_body = sns_message.get('Message', '{}')
            
            try:
                progress_data = json.loads(message_body)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse SNS message: {e}")
                continue
            
            # Extract job_id and status
            job_id = progress_data.get('job_id')
            if not job_id:
                logger.error("Missing job_id in message data")
                continue
            
            status = progress_data.get('status', 'IN_PROGRESS')
            
            # Route to appropriate handler based on status
            if status == 'IN_PROGRESS':
                success = update_job_progress(job_id, progress_data)
            elif status == 'COMPLETED':
                success = update_job_completion(job_id, progress_data)
            elif status == 'FAILED':
                success = update_job_failure(job_id, progress_data)
            else:
                logger.warning(f"Unknown status '{status}' for job {job_id}, treating as progress update")
                success = update_job_progress(job_id, progress_data)
            
            if success:
                logger.info(f"Successfully processed {status} update for job {job_id}")
            else:
                logger.error(f"Failed to process {status} update for job {job_id}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'Progress updates processed'})
        }
        
    except Exception as e:
        logger.error(f"Error processing SNS event: {e}", exc_info=True)
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }

