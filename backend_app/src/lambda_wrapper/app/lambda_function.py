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
        logger.info("Received API Gateway event, processing via SQS")
        
        # Generate unique request ID
        request_id = generate_request_id()
        logger.info(f"Generated request_id: {request_id}")
        
        # Send to SQS queue
        if not send_to_sqs(request_id, event):
            return {
                'statusCode': 500,
                'headers': cors_headers,
                'body': json.dumps({
                    'error': 'Failed to queue request'
                })
            }
        
        # Wait for completion (with timeout)
        timeout = int(os.environ.get('WRAPPER_TIMEOUT', 300))
        result = wait_for_completion(request_id, timeout_seconds=timeout)
        
        if result is None:
            # Timeout
            return {
                'statusCode': 504,
                'headers': cors_headers,
                'body': json.dumps({
                    'error': 'Request timeout - worker did not complete within timeout period',
                    'request_id': request_id
                })
            }
        
        # Return result to API Gateway
        return {
            'statusCode': result.get('statusCode', 200),
            'headers': cors_headers,
            'body': json.dumps(result.get('body', {}))
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

