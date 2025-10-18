"""
File Return Service Integration
Example of how the chat agent would call the file return Lambda service
"""

import json
import requests
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

class FileReturnService:
    """
    Service for calling the file return Lambda function
    This replaces the direct file return tools in the chat agent
    """
    
    def __init__(self, api_gateway_url: str, user_id: str):
        self.api_gateway_url = api_gateway_url
        self.user_id = user_id
        self.file_return_endpoint = f"{api_gateway_url}/file-return"
    
    def return_session_files(self, session_id: str, file_indices: List[int] = None) -> Dict[str, Any]:
        """
        Return files from a session to the user
        This would be called by the chat agent when user requests files
        """
        try:
            payload = {
                'session_id': session_id,
                'user_id': self.user_id,
                'action': 'return_files',
                'file_indices': file_indices or ['all']
            }
            
            response = requests.post(
                self.file_return_endpoint,
                json=payload,
                headers={'Content-Type': 'application/json'},
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"✅ File return successful: {len(result.get('file_data', []))} files")
                return result
            else:
                logger.error(f"❌ File return failed: {response.status_code} - {response.text}")
                return {'error': f'File return failed: {response.status_code}'}
                
        except Exception as e:
            logger.error(f"❌ File return service error: {str(e)}")
            return {'error': f'Service error: {str(e)}'}
    
    def create_agent_file(self, session_id: str, filename: str, content: str, file_type: str = 'text/plain') -> Dict[str, Any]:
        """
        Create a new file for the user
        This would be called by the chat agent when creating new files
        """
        try:
            payload = {
                'session_id': session_id,
                'user_id': self.user_id,
                'action': 'create_file',
                'filename': filename,
                'content': content,
                'file_type': file_type
            }
            
            response = requests.post(
                self.file_return_endpoint,
                json=payload,
                headers={'Content-Type': 'application/json'},
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                logger.info(f"✅ File creation successful: {filename}")
                return result
            else:
                logger.error(f"❌ File creation failed: {response.status_code} - {response.text}")
                return {'error': f'File creation failed: {response.status_code}'}
                
        except Exception as e:
            logger.error(f"❌ File creation service error: {str(e)}")
            return {'error': f'Service error: {str(e)}'}

# Example usage in chat agent:
"""
# In the chat agent, instead of using direct file return tools:

# 1. Initialize the service
file_service = FileReturnService(
    api_gateway_url=os.environ.get('API_GATEWAY_URL'),
    user_id=user_id
)

# 2. When user asks for files, call the service
if user_wants_files:
    result = file_service.return_session_files(session_id, file_indices=['all'])
    if 'error' not in result:
        # The service handles pushing the message to the chat interface
        # The agent can continue with normal response
        return "Files have been returned to your chat interface."
    else:
        return f"Sorry, I couldn't retrieve the files: {result['error']}"

# 3. When creating new files
if user_needs_new_file:
    result = file_service.create_agent_file(
        session_id=session_id,
        filename="analysis_report.txt",
        content=analysis_content,
        file_type="text/plain"
    )
    if 'error' not in result:
        return "I've created a new analysis report for you."
    else:
        return f"Sorry, I couldn't create the file: {result['error']}"
"""
