import json
import boto3
import logging
import os
from datetime import datetime
from decimal import Decimal

# Custom JSON encoder to handle Decimal objects
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
lambda_client = boto3.client('lambda')

# Environment variables
CHAT_SESSIONS_TABLE_NAME = os.environ.get('CHAT_SESSIONS_TABLE_NAME')
CHAT_FILES_BUCKET_NAME = os.environ.get('CHAT_FILES_BUCKET_NAME')
WEBSOCKET_PROCESSOR_FUNCTION_NAME = os.environ.get('WEBSOCKET_PROCESSOR_FUNCTION_NAME')

def lambda_handler(event, context):
    """
    Process agent files uploaded to S3 and update session_variables.
    
    This Lambda is triggered by SNS when files are uploaded to the agent-files/ folder.
    It extracts user_id and session_id from the S3 key, then updates the session_variables
    to include the new agent file in the agent_files array.
    """
    try:
        logger.info(f"Processing agent files notification: {json.dumps(event, cls=DecimalEncoder)}")
        
        # Parse SNS message
        if 'Records' in event:
            for record in event['Records']:
                if record.get('EventSource') == 'aws:sns':
                    # Parse SNS message
                    sns_message = json.loads(record['Sns']['Message'])
                    logger.info(f"SNS Message: {json.dumps(sns_message, cls=DecimalEncoder)}")
                    
                    # Process S3 event from SNS
                    if 'Records' in sns_message:
                        for s3_record in sns_message['Records']:
                            if s3_record.get('eventName') == 'ObjectCreated:Put':
                                process_agent_file(s3_record)
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Agent files processed successfully'
            }, cls=DecimalEncoder)
        }
        
    except Exception as e:
        logger.error(f"Error processing agent files: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'error': str(e)
            }, cls=DecimalEncoder)
        }

def process_agent_file(s3_record):
    """
    Process a single agent file upload and update session_variables.
    """
    try:
        # Extract S3 object information
        bucket_name = s3_record['s3']['bucket']['name']
        object_key = s3_record['s3']['object']['key']
        
        logger.info(f"Processing agent file: {object_key}")
        
        # Parse the S3 key to extract user_id and session_id
        # Expected format: users/{user_id}/sessions/{session_id}/agent-files/{filename}
        key_parts = object_key.split('/')
        if len(key_parts) < 5 or key_parts[0] != 'users' or key_parts[2] != 'sessions' or key_parts[4] != 'agent-files':
            logger.warning(f"Invalid agent file key format: {object_key}")
            return
        
        # Additional check to ensure this is an agent-files folder
        if 'agent-files' not in object_key:
            logger.info(f"Skipping non-agent file: {object_key}")
            return
        
        user_id = key_parts[1]
        session_id = key_parts[3]
        filename = key_parts[5] if len(key_parts) > 5 else 'unknown'
        
        logger.info(f"Extracted - User ID: {user_id}, Session ID: {session_id}, Filename: {filename}")
        
        # Get file metadata from S3
        try:
            response = s3_client.head_object(Bucket=bucket_name, Key=object_key)
            file_size = response.get('ContentLength', 0)
            content_type = response.get('ContentType', 'application/octet-stream')
            last_modified = response.get('LastModified', datetime.utcnow())
        except Exception as e:
            logger.error(f"Error getting file metadata: {str(e)}")
            file_size = 0
            content_type = 'application/octet-stream'
            last_modified = datetime.utcnow()
        
        # Create agent file metadata
        agent_file_metadata = {
            'filename': filename,
            's3_key': object_key,
            's3_url': f"https://{bucket_name}.s3.amazonaws.com/{object_key}",
            'file_size': file_size,
            'content_type': content_type,
            'upload_timestamp': int(last_modified.timestamp()),
            'file_id': filename.split('.')[0] if '.' in filename else filename,  # Use filename without extension as file_id
            'generated_by': 'agent'
        }
        
        # Update session_variables in DynamoDB
        updated_session_variables = update_session_agent_files(user_id, session_id, agent_file_metadata)
        
        # Send WebSocket notification to frontend
        if updated_session_variables:
            send_session_update_to_websocket(user_id, session_id, updated_session_variables)
        
        logger.info(f"Successfully processed agent file: {filename}")
        
    except Exception as e:
        logger.error(f"Error processing agent file: {str(e)}")
        raise

def update_session_agent_files(user_id, session_id, agent_file_metadata):
    """
    Update the session_variables to include the new agent file.
    
    Returns:
        Updated session_variables dict or None if error
    """
    try:
        table = dynamodb.Table(CHAT_SESSIONS_TABLE_NAME)
        
        # Get current session
        response = table.get_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        
        if 'Item' not in response:
            logger.error(f"Session not found: {user_id}/{session_id}")
            return None
        
        session = response['Item']
        session_variables = session.get('session_variables', {})
        
        # Get existing agent files or initialize empty list
        agent_files = session_variables.get('agent_files', [])
        
        # Add new agent file
        agent_files.append(agent_file_metadata)
        
        # Update session_variables
        session_variables['agent_files'] = agent_files
        
        # Update the session in DynamoDB
        table.update_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            },
            UpdateExpression='SET session_variables = :sv',
            ExpressionAttributeValues={
                ':sv': session_variables
            }
        )
        
        logger.info(f"Updated session_variables for session {session_id} with agent file: {agent_file_metadata['filename']}")
        return session_variables
        
    except Exception as e:
        logger.error(f"Error updating session agent files: {str(e)}")
        raise

def send_session_update_to_websocket(user_id, session_id, session_variables):
    """
    Send session update notification to WebSocket processor.
    
    Args:
        user_id: User ID
        session_id: Session ID
        session_variables: Updated session variables
    """
    try:
        if not WEBSOCKET_PROCESSOR_FUNCTION_NAME:
            logger.error("WEBSOCKET_PROCESSOR_FUNCTION_NAME not configured")
            return
        
        # Create WebSocket payload for session update
        websocket_payload = {
            'type': 'session_update',
            'user_id': user_id,
            'session_id': session_id,
            'session_variables': session_variables
        }
        
        # Invoke WebSocket processor Lambda
        response = lambda_client.invoke(
            FunctionName=WEBSOCKET_PROCESSOR_FUNCTION_NAME,
            InvocationType='Event',  # Async invocation
            Payload=json.dumps(websocket_payload, cls=DecimalEncoder)
        )
        
        logger.info(f"Sent session update to WebSocket processor for session {session_id}")
        
    except Exception as e:
        logger.error(f"Error sending session update to WebSocket: {str(e)}")
        # Don't raise - this is not critical for file processing
