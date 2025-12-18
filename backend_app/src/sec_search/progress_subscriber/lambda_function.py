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

# DynamoDB configuration for job storage (query cache table)
QUERY_CACHE_TABLE_NAME = os.environ.get('SEC_SEARCH_QUERY_CACHE_TABLE')
dynamodb = boto3.resource('dynamodb') if QUERY_CACHE_TABLE_NAME else None
query_cache_table = dynamodb.Table(QUERY_CACHE_TABLE_NAME) if dynamodb and QUERY_CACHE_TABLE_NAME else None

# AWS clients
sns_client = boto3.client('sns')


def update_job_progress(job_id: str, progress_data: Dict[str, Any]) -> bool:
    """
    Update job progress in DynamoDB query cache table
    
    Args:
        job_id: Job identifier
        progress_data: Progress data containing current_page, total_pages, results_count, total_found
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not query_cache_table:
        logger.error("DynamoDB table not configured")
        return False
    
    try:
        # Query GSI to find job by job_id and get queryHash
        response = query_cache_table.query(
            IndexName='JobIdIndex',
            KeyConditionExpression='job_id = :job_id',
            ExpressionAttributeValues={':job_id': job_id}
        )
        
        if not response.get('Items'):
            logger.warning(f"Job {job_id} not found for progress update")
            return False
        
        # Get queryHash from the first item
        query_hash = response['Items'][0].get('queryHash')
        if not query_hash:
            logger.error(f"Job {job_id} found but missing queryHash")
            return False
        
        # Update job progress using queryHash as primary key
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
        
        query_cache_table.update_item(
            Key={'queryHash': query_hash},
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
    Update job completion in DynamoDB query cache table
    
    Args:
        job_id: Job identifier
        completion_data: Completion data containing results or results_s3_key
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not query_cache_table:
        logger.error("DynamoDB table not configured")
        return False
    
    try:
        # Query GSI to find job by job_id and get queryHash
        response = query_cache_table.query(
            IndexName='JobIdIndex',
            KeyConditionExpression='job_id = :job_id',
            ExpressionAttributeValues={':job_id': job_id}
        )
        
        if not response.get('Items'):
            logger.warning(f"Job {job_id} not found for completion update")
            return False
        
        # Get queryHash from the first item
        query_hash = response['Items'][0].get('queryHash')
        if not query_hash:
            logger.error(f"Job {job_id} found but missing queryHash")
            return False
        
        # Build update expression based on whether results are in S3 or inline
        if 'results_s3_key' in completion_data:
            # Results stored in S3 - update both job_results_s3_key and results_s3_key
            update_expression = "SET job_status = :status, job_results_s3_key = :s3_key, results_s3_key = :s3_key, updated_at = :updated_at"
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
        
        query_cache_table.update_item(
            Key={'queryHash': query_hash},
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
    Update job failure in DynamoDB query cache table
    
    Args:
        job_id: Job identifier
        failure_data: Failure data containing error message
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not query_cache_table:
        logger.error("DynamoDB table not configured")
        return False
    
    try:
        # Query GSI to find job by job_id and get queryHash
        response = query_cache_table.query(
            IndexName='JobIdIndex',
            KeyConditionExpression='job_id = :job_id',
            ExpressionAttributeValues={':job_id': job_id}
        )
        
        if not response.get('Items'):
            logger.warning(f"Job {job_id} not found for failure update")
            return False
        
        # Get queryHash from the first item
        query_hash = response['Items'][0].get('queryHash')
        if not query_hash:
            logger.error(f"Job {job_id} found but missing queryHash")
            return False
        
        update_expression = "SET job_status = :status, error = :error, updated_at = :updated_at"
        expression_values = {
            ':status': 'FAILED',
            ':error': failure_data.get('error', 'Unknown error'),
            ':updated_at': failure_data.get('timestamp', '')
        }
        
        query_cache_table.update_item(
            Key={'queryHash': query_hash},
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


def process_progress_subscriber_request(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Process progress subscriber request (extracted from lambda_handler for reuse)
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


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Handle SNS event and update DynamoDB with progress
    Supports SQS events from wrapper Lambda (though primarily SNS-triggered)
    
    Args:
        event: SNS event containing progress update, or SQS event
        context: Lambda context
        
    Returns:
        Dict with statusCode
    """
    completion_sns_topic = os.environ.get('SEC_SEARCH_PROGRESS_SUBSCRIBER_COMPLETION_SNS_TOPIC_ARN')
    
    # Handle SQS events (from wrapper Lambda when worker is at concurrency)
    if 'Records' in event and isinstance(event.get('Records'), list) and len(event.get('Records', [])) > 0:
        first_record = event['Records'][0]
        if first_record.get('eventSource') == 'aws:sqs':
            logger.info("📬 SQS EVENT DETECTED - Processing queued request")
            try:
                # Parse SQS message body
                message_body_str = first_record.get('body', '{}')
                message_body = json.loads(message_body_str) if isinstance(message_body_str, str) else message_body_str
                
                # Extract request_id and API Gateway event (or SNS event)
                request_id = message_body.get('request_id')
                api_gateway_event = message_body.get('api_gateway_event', event)
                
                logger.info(f"📬 Processing SQS message - request_id: {request_id}")
                
                # Replace event with API Gateway event for processing
                event = api_gateway_event
                
                # Process the request
                try:
                    result = process_progress_subscriber_request(event, context)
                    
                    # Publish completion notification
                    if completion_sns_topic and request_id:
                        sns_client.publish(
                            TopicArn=completion_sns_topic,
                            Message=json.dumps({
                                'request_id': request_id,
                                'status': 'completed',
                                'response': result
                            }),
                            MessageAttributes={
                                'request_id': {
                                    'DataType': 'String',
                                    'StringValue': request_id
                                }
                            }
                        )
                    
                    return result
                except Exception as e:
                    logger.error(f"❌ Error processing SQS event: {str(e)}", exc_info=True)
                    
                    # Publish failure notification
                    if completion_sns_topic and request_id:
                        sns_client.publish(
                            TopicArn=completion_sns_topic,
                            Message=json.dumps({
                                'request_id': request_id,
                                'status': 'failed',
                                'error': str(e)
                            }),
                            MessageAttributes={
                                'request_id': {
                                    'DataType': 'String',
                                    'StringValue': request_id
                                }
                            }
                        )
                    
                    raise
            except Exception as e:
                logger.error(f"❌ Error parsing SQS message: {e}", exc_info=True)
                return {
                    'statusCode': 500,
                    'body': json.dumps({'error': f'Failed to parse SQS message: {str(e)}'})
                }
    
    # Regular SNS event or direct invocation
    return process_progress_subscriber_request(event, context)

