"""
Standard Wrapper Lambda for SQS-based request processing
Handles synchronous API Gateway requests by sending to SQS and waiting for completion via SNS
"""

import json
import os
import logging
import boto3
import uuid
import time
from typing import Dict, Any, Optional
from datetime import datetime, timezone

logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# AWS clients
sqs_client = boto3.client('sqs')
sns_client = boto3.client('sns')
lambda_client = boto3.client('lambda')
dynamodb_client = boto3.client('dynamodb') if os.environ.get('RESPONSE_TABLE_NAME') else None

# Configuration from environment variables
SQS_QUEUE_URL = os.environ.get('SQS_QUEUE_URL')
SNS_TOPIC_ARN = os.environ.get('SNS_TOPIC_ARN')
WORKER_FUNCTION_NAME = os.environ.get('WORKER_FUNCTION_NAME')
RESPONSE_TABLE_NAME = os.environ.get('RESPONSE_TABLE_NAME', '')

# In-memory store for request/response correlation (for single Lambda instance)
# In production with multiple instances, use DynamoDB or SNS message attributes
response_store: Dict[str, Dict[str, Any]] = {}


def generate_request_id() -> str:
    """Generate a unique request ID"""
    return str(uuid.uuid4())


def send_to_sqs(request_id: str, api_gateway_event: Dict[str, Any]) -> bool:
    """
    Send API Gateway event to SQS queue with request_id
    
    Args:
        request_id: Unique request identifier
        api_gateway_event: Original API Gateway event
        
    Returns:
        bool: True if successful, False otherwise
    """
    if not SQS_QUEUE_URL:
        logger.error("SQS_QUEUE_URL not configured")
        return False
    
    try:
        # Prepare message body with request_id and original event
        message_body = {
            'request_id': request_id,
            'api_gateway_event': api_gateway_event,
            'timestamp': datetime.now(timezone.utc).isoformat()
        }
        
        # Send message to SQS
        response = sqs_client.send_message(
            QueueUrl=SQS_QUEUE_URL,
            MessageBody=json.dumps(message_body),
            MessageAttributes={
                'request_id': {
                    'DataType': 'String',
                    'StringValue': request_id
                }
            }
        )
        
        logger.info(f"Sent request {request_id} to SQS queue: {response.get('MessageId')}")
        return True
        
    except Exception as e:
        logger.error(f"Error sending message to SQS: {e}", exc_info=True)
        return False


def wait_for_completion(request_id: str, timeout_seconds: int = 300) -> Optional[Dict[str, Any]]:
    """
    Wait for completion notification by polling DynamoDB or in-memory store
    
    Args:
        request_id: Request identifier to wait for
        timeout_seconds: Maximum time to wait in seconds
        
    Returns:
        Dict with result or None if timeout
    """
    start_time = time.time()
    check_interval = 0.5  # Check every 500ms
    
    logger.info(f"Waiting for completion of request {request_id} (timeout: {timeout_seconds}s)")
    
    while (time.time() - start_time) < timeout_seconds:
        # Check in-memory store first (for same Lambda instance)
        if request_id in response_store:
            result = response_store.pop(request_id)
            logger.info(f"Received completion for request {request_id} from in-memory store")
            return result
        
        # Check DynamoDB (for cross-instance communication)
        if RESPONSE_TABLE_NAME and dynamodb_client:
            try:
                response = dynamodb_client.get_item(
                    TableName=RESPONSE_TABLE_NAME,
                    Key={
                        'request_id': {'S': request_id}
                    }
                )
                
                if 'Item' in response:
                    item = response['Item']
                    # Check if status is 'completed' or 'failed'
                    status = item.get('status', {}).get('S', '')
                    if status in ['completed', 'failed']:
                        result = {
                            'status': status,
                            'body': json.loads(item.get('body', {}).get('S', '{}')),
                            'statusCode': int(item.get('statusCode', {}).get('N', '200'))
                        }
                        # Delete from DynamoDB after reading
                        dynamodb_client.delete_item(
                            TableName=RESPONSE_TABLE_NAME,
                            Key={'request_id': {'S': request_id}}
                        )
                        logger.info(f"Received completion for request {request_id} from DynamoDB")
                        return result
            except Exception as e:
                logger.debug(f"Error checking DynamoDB: {e}")
        
        time.sleep(check_interval)
    
    logger.warning(f"Timeout waiting for completion of request {request_id}")
    return None


def handle_sns_notification(event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle SNS notification (called when worker Lambda publishes completion)
    
    Args:
        event: SNS event containing completion notification
        
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
                completion_data = json.loads(message_body)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse SNS message: {e}")
                continue
            
            # Extract request_id from message attributes or body
            request_id = None
            if 'MessageAttributes' in sns_message:
                request_id = sns_message['MessageAttributes'].get('request_id', {}).get('Value')
            
            if not request_id:
                request_id = completion_data.get('request_id')
            
            if not request_id:
                logger.error("Missing request_id in SNS message")
                continue
            
            # Store result in in-memory store (for same Lambda instance)
            response_store[request_id] = {
                'statusCode': completion_data.get('statusCode', 200),
                'body': completion_data.get('body', {}),
                'status': completion_data.get('status', 'completed')
            }
            
            # Store in DynamoDB (for cross-instance communication)
            if RESPONSE_TABLE_NAME and dynamodb_client:
                try:
                    # Prepare body - handle S3 key for large results
                    body_data = completion_data.get('body', {})
                    if isinstance(body_data, dict) and 'results_s3_key' in body_data:
                        # Large results stored in S3 - keep S3 key reference
                        body_json = json.dumps(body_data)
                    else:
                        body_json = json.dumps(body_data)
                    
                    dynamodb_client.put_item(
                        TableName=RESPONSE_TABLE_NAME,
                        Item={
                            'request_id': {'S': request_id},
                            'statusCode': {'N': str(completion_data.get('statusCode', 200))},
                            'body': {'S': body_json},
                            'status': {'S': completion_data.get('status', 'completed')},
                            'timestamp': {'S': datetime.now(timezone.utc).isoformat()},
                            'ttl': {'N': str(int(time.time()) + 3600)}  # 1 hour TTL
                        }
                    )
                    logger.info(f"Stored completion result in DynamoDB for request {request_id}")
                except Exception as e:
                    logger.error(f"Error storing result in DynamoDB: {e}", exc_info=True)
            
            logger.info(f"Stored completion result for request {request_id}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({'message': 'Completion notification processed'})
        }
        
    except Exception as e:
        logger.error(f"Error processing SNS event: {e}", exc_info=True)
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(e)})
        }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler - routes between API Gateway requests and SNS notifications
    
    Args:
        event: API Gateway event or SNS event
        context: Lambda context
        
    Returns:
        API Gateway response format
    """
    # CORS headers for API Gateway responses
    cors_headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Content-Type': 'application/json'
    }
    
    try:
        # Handle OPTIONS request for CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            logger.info("Handling OPTIONS request for CORS preflight")
            return {
                'statusCode': 200,
                'headers': cors_headers,
                'body': ''
            }
        
        # Check if this is an SNS notification (from worker Lambda completion)
        if 'Records' in event and len(event.get('Records', [])) > 0:
            first_record = event['Records'][0]
            if first_record.get('EventSource') == 'aws:sns':
                logger.info("Received SNS notification (completion callback)")
                return handle_sns_notification(event)
        
        # Otherwise, treat as API Gateway event
        logger.info("Received API Gateway event, forwarding to worker Lambda")
        
        # Invoke worker Lambda synchronously to get job_id immediately
        # The worker handles the request, creates job_id, and returns 202 immediately
        # The worker then processes asynchronously via its own async invocation
        worker_function_name = WORKER_FUNCTION_NAME
        
        if not worker_function_name:
            logger.error("WORKER_FUNCTION_NAME not configured")
            return {
                'statusCode': 500,
                'headers': cors_headers,
                'body': json.dumps({
                    'error': 'Worker Lambda not configured'
                })
            }
        
        try:
            # Try to invoke worker Lambda synchronously with a short timeout
            # If it succeeds quickly, return results immediately
            # If it's throttled or times out, fall back to SQS queue
            logger.info(f"Attempting synchronous invoke of worker Lambda {worker_function_name}")
            
            try:
                # Use a shorter timeout to detect throttling quickly
                invoke_response = lambda_client.invoke(
                    FunctionName=worker_function_name,
                    InvocationType='RequestResponse',
                    Payload=json.dumps(event)
                )
                
                # Check for throttling errors in the response
                if 'FunctionError' in invoke_response:
                    error_type = invoke_response.get('FunctionError')
                    if error_type == 'Throttled' or 'Throttled' in str(invoke_response):
                        logger.warning(f"Worker Lambda throttled, falling back to SQS queue")
                        raise Exception("Lambda throttled - using SQS fallback")
                
                # Parse response
                response_payload = json.loads(invoke_response['Payload'].read())
                status_code = response_payload.get('statusCode', 500)
                response_body_str = response_payload.get('body', '{}')
                
                # Parse body if it's a string
                if isinstance(response_body_str, str):
                    try:
                        response_body = json.loads(response_body_str)
                    except json.JSONDecodeError:
                        response_body = {'error': response_body_str}
                else:
                    response_body = response_body_str
                
                # If worker returned results immediately (200), return them
                if status_code == 200 and 'results' in response_body:
                    logger.info(f"Worker Lambda returned results immediately: {len(response_body.get('results', []))} results")
                    return {
                        'statusCode': status_code,
                        'headers': cors_headers,
                        'body': json.dumps(response_body)
                    }
                
                # If worker returned job_id (202), return it
                if status_code == 202 and 'job_id' in response_body:
                    logger.info(f"Worker Lambda returned job_id: {response_body.get('job_id')}")
                    return {
                        'statusCode': status_code,
                        'headers': cors_headers,
                        'body': json.dumps(response_body)
                    }
                
                # Otherwise return the response as-is
                logger.info(f"Worker Lambda returned status {status_code}")
                return {
                    'statusCode': status_code,
                    'headers': cors_headers,
                    'body': json.dumps(response_body)
                }
                
            except Exception as invoke_error:
                # Check if it's a throttling error
                error_str = str(invoke_error).lower()
                is_throttled = (
                    'throttled' in error_str or
                    'provisionedconcurrencyexceeded' in error_str or
                    'reservedconcurrency' in error_str or
                    'toomanyrequests' in error_str
                )
                
                if is_throttled:
                    logger.warning(f"Worker Lambda at concurrency limit, queueing request via SQS")
                    # Fall through to SQS queueing
                else:
                    # Re-raise other errors
                    raise
            
            # Fallback: Send to SQS queue and return job_id
            if not SQS_QUEUE_URL:
                logger.error("SQS_QUEUE_URL not configured, cannot queue request")
                return {
                    'statusCode': 503,  # Service Unavailable
                    'headers': cors_headers,
                    'body': json.dumps({
                        'error': 'Service temporarily unavailable - worker at capacity and queue not configured'
                    })
                }
            
            # Generate a job_id for tracking
            job_id = f"JOB#{uuid.uuid4().hex[:16]}"
            request_id = generate_request_id()
            
            logger.info(f"Queueing request {request_id} to SQS with job_id {job_id}")
            
            # Send to SQS with job_id
            message_body = {
                'request_id': request_id,
                'job_id': job_id,
                'api_gateway_event': event,
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
            
            sqs_client.send_message(
                QueueUrl=SQS_QUEUE_URL,
                MessageBody=json.dumps(message_body),
                MessageAttributes={
                    'request_id': {
                        'DataType': 'String',
                        'StringValue': request_id
                    },
                    'job_id': {
                        'DataType': 'String',
                        'StringValue': job_id
                    }
                }
            )
            
            # Return job_id for polling
            logger.info(f"Request queued, returning job_id: {job_id}")
            return {
                'statusCode': 202,  # Accepted
                'headers': cors_headers,
                'body': json.dumps({
                    'success': True,
                    'job_id': job_id,
                    'status': 'PENDING',
                    'message': 'Request queued - worker Lambda at capacity'
                })
            }
                
        except Exception as e:
            logger.error(f"Error in wrapper Lambda: {e}", exc_info=True)
            return {
                'statusCode': 500,
                'headers': cors_headers,
                'body': json.dumps({
                    'error': f'Failed to process request: {str(e)}'
                })
            }
        
    except Exception as e:
        logger.error(f"Error in wrapper Lambda handler: {e}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'error': str(e)
            })
        }

