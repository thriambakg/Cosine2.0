"""
File Return Service Integration
Tool for the chat agent to call the file return Lambda service
"""

import json
import boto3
import logging
import os
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

class FileReturnService:
    """
    Service for directly invoking the file return Lambda function
    This is more efficient than HTTP requests to API Gateway
    """
    
    def __init__(self, lambda_function_name: str, user_id: str):
        self.lambda_function_name = lambda_function_name
        self.user_id = user_id
        self.lambda_client = boto3.client('lambda')
    
    def _invoke_lambda(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Directly invoke the file return Lambda function"""
        try:
            response = self.lambda_client.invoke(
                FunctionName=self.lambda_function_name,
                InvocationType='RequestResponse',  # Synchronous invocation
                Payload=json.dumps(payload)
            )
            
            # Parse the response
            response_payload = json.loads(response['Payload'].read())
            
            if response['StatusCode'] == 200:
                return response_payload
            else:
                logger.error(f"❌ Lambda invocation error: {response['StatusCode']} - {response_payload}")
                return {'error': f'Lambda error: {response_payload}'}
                
        except Exception as e:
            logger.error(f"❌ Lambda invocation error: {str(e)}")
            return {'error': f'Lambda invocation error: {str(e)}'}
    
    def return_session_files(self, session_id: str, file_indices: List[str] = None) -> Dict[str, Any]:
        """
        Return files from a session to the user
        """
        try:
            payload = {
                'user_id': self.user_id,
                'session_id': session_id,
                'action': 'return_files',
                'file_indices': file_indices or ['all']
            }
            
            return self._invoke_lambda(payload)
            
        except Exception as e:
            logger.error(f"❌ File return service error: {str(e)}")
            return {'error': f'Service error: {str(e)}'}
    
    def create_agent_file(self, session_id: str, filename: str, content: str, file_type: str = 'text/plain') -> Dict[str, Any]:
        """
        Create a new file for the user
        """
        try:
            payload = {
                'user_id': self.user_id,
                'session_id': session_id,
                'action': 'create_file',
                'filename': filename,
                'content': content,
                'file_type': file_type
            }
            
            return self._invoke_lambda(payload)
            
        except Exception as e:
            logger.error(f"❌ File creation service error: {str(e)}")
            return {'error': f'Service error: {str(e)}'}

# Tool functions for the agent to use
def return_session_files_tool(session_id: str, user_id: str, file_indices: List[str] = None) -> str:
    """
    Return files from a session to the user via the file return service
    """
    try:
        lambda_function_name = os.environ.get('FILE_RETURN_LAMBDA_NAME', 'cosine-file-return-production')
        file_service = FileReturnService(lambda_function_name, user_id)
        
        result = file_service.return_session_files(session_id, file_indices)
        
        if 'error' not in result:
            return f"Files have been returned to your chat interface. {len(result.get('file_data', []))} files are ready for download."
        else:
            return f"Sorry, I couldn't retrieve the files: {result['error']}"
            
    except Exception as e:
        logger.error(f"❌ File return service error: {str(e)}")
        return f"Sorry, I couldn't retrieve the files: {str(e)}"

def create_agent_file_tool(session_id: str, user_id: str, filename: str, content: str, file_type: str = 'text/plain') -> str:
    """
    Create a new file for the user via the file return service
    """
    try:
        lambda_function_name = os.environ.get('FILE_RETURN_LAMBDA_NAME', 'cosine-file-return-production')
        file_service = FileReturnService(lambda_function_name, user_id)
        
        result = file_service.create_agent_file(session_id, filename, content, file_type)
        
        if 'error' not in result:
            return f"I've created a new file '{filename}' for you. It's ready for download in your chat interface."
        else:
            return f"Sorry, I couldn't create the file: {result['error']}"
            
    except Exception as e:
        logger.error(f"❌ File creation service error: {str(e)}")
        return f"Sorry, I couldn't create the file: {str(e)}"
