"""
Agent Files Helper
Utility for uploading agent files to S3 and updating session_variables in DynamoDB.
This replaces the agent_files_processor Lambda functionality.
"""

import json
import boto3
import logging
import os
from datetime import datetime
from decimal import Decimal
from typing import Dict, Any, Optional

# Configure logging
logger = logging.getLogger(__name__)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
lambda_client = boto3.client('lambda')

# Environment variables (will be set by Lambda environment)
CHAT_SESSIONS_TABLE_NAME = os.environ.get('CHAT_SESSIONS_TABLE_NAME')
CHAT_FILES_BUCKET_NAME = os.environ.get('CHAT_FILES_BUCKET_NAME')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'cosine')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'production')

# Custom JSON encoder to handle Decimal objects
class DecimalEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def get_chat_agent_function_name() -> str:
    """Get chat agent function name by constructing it from environment variables"""
    websocket_processor_name = os.environ.get('WEBSOCKET_PROCESSOR_FUNCTION_NAME')
    if websocket_processor_name:
        return websocket_processor_name
    # Fallback: construct from standard naming pattern
    return f"{PROJECT_NAME}-chat-agent-{ENVIRONMENT}"


class AgentFilesHelper:
    """
    Helper class for processing agent files.
    Handles uploading files to S3 and updating session_variables in DynamoDB.
    """
    
    @staticmethod
    def upload_file_and_update_session(
        user_id: str,
        session_id: str,
        file_bytes: bytes,
        filename: str,
        content_type: str = 'application/octet-stream',
        file_metadata: Optional[Dict[str, Any]] = None,
        s3_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Upload a file to S3 and update session_variables in DynamoDB.
        
        Args:
            user_id: User ID
            session_id: Session ID
            file_bytes: File content as bytes
            filename: Name of the file
            content_type: MIME type of the file (default: 'application/octet-stream')
            file_metadata: Optional additional metadata for the file
            s3_key: Optional S3 key (if not provided, will be generated)
        
        Returns:
            Dictionary with status, s3_key, and file metadata
        """
        try:
            # Generate S3 key if not provided
            if not s3_key:
                s3_key = f"users/{user_id}/sessions/{session_id}/agent-files/{filename}"
            
            # Upload file to S3
            bucket_name = CHAT_FILES_BUCKET_NAME
            if not bucket_name:
                raise ValueError("CHAT_FILES_BUCKET_NAME environment variable not set")
            
            logger.info(f"Uploading file to S3: {bucket_name}/{s3_key}")
            s3_client.put_object(
                Bucket=bucket_name,
                Key=s3_key,
                Body=file_bytes,
                ContentType=content_type,
                Metadata={
                    'user_id': user_id,
                    'session_id': session_id,
                    'filename': filename,
                    'upload_timestamp': str(int(datetime.utcnow().timestamp()))
                }
            )
            
            # Create file metadata
            if not file_metadata:
                file_metadata = {}
            
            file_metadata.update({
                'filename': filename,
                's3_key': s3_key,
                's3_url': f"https://{bucket_name}.s3.amazonaws.com/{s3_key}",
                'file_size': len(file_bytes),
                'content_type': content_type,
                'upload_timestamp': int(datetime.utcnow().timestamp()),
                'file_id': filename.split('.')[0] if '.' in filename else filename,
                'generated_by': 'agent'
            })
            
            # Update session_variables
            updated_session_variables = AgentFilesHelper.update_session_agent_files(
                user_id, session_id, file_metadata
            )
            
            # Send WebSocket notification
            if updated_session_variables:
                AgentFilesHelper.send_session_update_to_websocket(
                    user_id, session_id, updated_session_variables
                )
            
            logger.info(f"Successfully processed agent file: {filename}")
            
            return {
                'status': 'success',
                's3_key': s3_key,
                'filename': filename,
                'file_metadata': file_metadata,
                'message': f'File uploaded and session updated successfully'
            }
            
        except Exception as e:
            error_msg = f"Error uploading file and updating session: {str(e)}"
            logger.error(error_msg, exc_info=True)
            raise
    
    @staticmethod
    def update_session_for_existing_file(
        user_id: str,
        session_id: str,
        s3_key: str,
        filename: str,
        file_metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Update session_variables for an existing file in S3.
        Useful when a file was already uploaded and you just need to update the session.
        
        Args:
            user_id: User ID
            session_id: Session ID
            s3_key: S3 key of the existing file
            filename: Name of the file
            file_metadata: Optional additional metadata for the file
        
        Returns:
            Dictionary with status and file metadata
        """
        try:
            # Get file size from S3
            bucket_name = CHAT_FILES_BUCKET_NAME
            if not bucket_name:
                raise ValueError("CHAT_FILES_BUCKET_NAME environment variable not set")
            
            try:
                head_response = s3_client.head_object(Bucket=bucket_name, Key=s3_key)
                file_size = head_response.get('ContentLength', 0)
                content_type = head_response.get('ContentType', 'application/octet-stream')
            except Exception as e:
                logger.warning(f"Could not get file metadata from S3: {str(e)}")
                file_size = 0
                content_type = 'application/octet-stream'
            
            # Create file metadata
            if not file_metadata:
                file_metadata = {}
            
            file_metadata.update({
                'filename': filename,
                's3_key': s3_key,
                's3_url': f"https://{bucket_name}.s3.amazonaws.com/{s3_key}",
                'file_size': file_size,
                'content_type': content_type,
                'upload_timestamp': int(datetime.utcnow().timestamp()),
                'file_id': filename.split('.')[0] if '.' in filename else filename,
                'generated_by': 'agent'
            })
            
            # Update session_variables
            updated_session_variables = AgentFilesHelper.update_session_agent_files(
                user_id, session_id, file_metadata
            )
            
            # Send WebSocket notification
            if updated_session_variables:
                AgentFilesHelper.send_session_update_to_websocket(
                    user_id, session_id, updated_session_variables
                )
            
            logger.info(f"Successfully updated session for existing file: {filename}")
            
            return {
                'status': 'success',
                's3_key': s3_key,
                'filename': filename,
                'file_metadata': file_metadata,
                'message': f'Session updated for existing file'
            }
            
        except Exception as e:
            error_msg = f"Error updating session for existing file: {str(e)}"
            logger.error(error_msg, exc_info=True)
            raise
    
    @staticmethod
    def update_session_agent_files(
        user_id: str,
        session_id: str,
        agent_file_metadata: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Update the session_variables to include the new agent file.
        
        Args:
            user_id: User ID
            session_id: Session ID
            agent_file_metadata: Metadata for the agent file
        
        Returns:
            Updated session_variables dict or None if error
        """
        try:
            if not CHAT_SESSIONS_TABLE_NAME:
                raise ValueError("CHAT_SESSIONS_TABLE_NAME environment variable not set")
            
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
            logger.error(f"Error updating session agent files: {str(e)}", exc_info=True)
            raise
    
    @staticmethod
    def send_session_update_to_websocket(
        user_id: str,
        session_id: str,
        session_variables: Dict[str, Any]
    ) -> None:
        """
        Send session update notification to WebSocket processor.
        
        Args:
            user_id: User ID
            session_id: Session ID
            session_variables: Updated session variables
        """
        try:
            websocket_processor_name = get_chat_agent_function_name()
            if not websocket_processor_name:
                logger.warning("WEBSOCKET_PROCESSOR_FUNCTION_NAME not configured, skipping WebSocket notification")
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
                FunctionName=websocket_processor_name,
                InvocationType='Event',  # Async invocation
                Payload=json.dumps(websocket_payload, cls=DecimalEncoder)
            )
            
            logger.info(f"Sent session update to WebSocket processor for session {session_id}")
            
        except Exception as e:
            logger.error(f"Error sending session update to WebSocket: {str(e)}", exc_info=True)
            # Don't raise - this is not critical for file processing





