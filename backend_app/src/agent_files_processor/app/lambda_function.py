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
    
    This Lambda is triggered by direct invocation from agent tools.
    It extracts user_id and session_id, then updates the session_variables
    to include the new agent file in the agent_files array.
    """
    try:
        logger.info(f"Processing agent files notification: {json.dumps(event, cls=DecimalEncoder)}")
        
        # Process direct invocation
        if event.get('type') == 'direct_invocation':
            process_direct_invocation(event)
        else:
            logger.warning(f"Unknown event format - expected direct_invocation: {event}")
        
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

def process_direct_invocation(event):
    """
    Process a direct invocation from agent tools.
    
    Args:
        event: Direct invocation payload with user_id, session_id, s3_key, etc.
    """
    try:
        user_id = event.get('user_id')
        session_id = event.get('session_id')
        s3_key = event.get('s3_key')
        filename = event.get('filename')
        file_metadata = event.get('file_metadata', {})
        
        logger.info(f"Processing direct invocation - User: {user_id}, Session: {session_id}, File: {filename}")
        
        # Use provided file metadata or create default
        if not file_metadata:
            file_metadata = {
                'filename': filename,
                's3_key': s3_key,
                's3_url': f"https://{CHAT_FILES_BUCKET_NAME}.s3.amazonaws.com/{s3_key}",
                'file_size': event.get('file_size', 0),
                'content_type': 'application/octet-stream',
                'upload_timestamp': int(datetime.utcnow().timestamp()),
                'file_id': filename.split('.')[0] if '.' in filename else filename,
                'generated_by': 'agent'
            }
        
        # Update session_variables in DynamoDB
        updated_session_variables = update_session_agent_files(user_id, session_id, file_metadata)
        
        # Send WebSocket notification to frontend
        if updated_session_variables:
            send_session_update_to_websocket(user_id, session_id, updated_session_variables)
        
        logger.info(f"Successfully processed direct invocation for file: {filename}")
        
    except Exception as e:
        logger.error(f"Error processing direct invocation: {str(e)}")
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
