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
            
            # Extract job_id and progress info
            job_id = progress_data.get('job_id')
            if not job_id:
                logger.error("Missing job_id in progress data")
                continue
            
            # Update DynamoDB
            success = update_job_progress(job_id, progress_data)
            
            if success:
                logger.info(f"Successfully processed progress update for job {job_id}")
            else:
                logger.error(f"Failed to process progress update for job {job_id}")
        
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

