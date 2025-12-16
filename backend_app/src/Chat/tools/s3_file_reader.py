"""
S3 File Reader tool for the chat agent to read uploaded files from S3
"""

import json
import os
import boto3
import logging
from typing import Dict, Any
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()

# Import Strands types (available in Lambda layer)
try:
    from strands.types.tools import ToolResult, ToolUse
    from strands import tool
    # Import successful - no need to log
except ImportError as e:
    logger.error(f"Failed to import Strands types: {e}")
    raise

# Tool specification following Strands pattern
TOOL_SPEC = {
    "name": "read_s3_file",
    "description": "Read and analyze files uploaded to S3 by users. Use this tool when users ask about uploaded files or when you need to analyze file content.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "s3_key": {
                    "type": "string",
                    "description": "The S3 key/path of the file to read (e.g., 'users/user_id/sessions/session_id/files/file_id_filename.json')"
                },
                "file_type": {
                    "type": "string",
                    "description": "The type of file being read (e.g., 'json', 'csv', 'txt', 'pdf')",
                    "default": "auto"
                }
            },
            "required": ["s3_key"]
        }
    }
}

class S3FileReader:
    def __init__(self):
        self.s3_client = boto3.client('s3')
        self.bucket_name = None
        
    def get_bucket_name(self, s3_key: str = None):
        """
        Get the appropriate bucket name based on the S3 key pattern.
        
        Args:
            s3_key: The S3 key/path to determine which bucket to use
            
        Returns:
            Bucket name string
        """
        # If s3_key starts with billtext/, use congress bills data bucket
        if s3_key and s3_key.startswith('billtext/'):
            bucket_name = os.environ.get('CONGRESS_BILLS_DATA_S3_BUCKET_NAME')
            if bucket_name:
                logger.info(f"Using congress bills data bucket for billtext file: {bucket_name}")
                return bucket_name
            # Fallback: try to construct bucket name if env var not set
            project_name = os.environ.get('PROJECT_NAME', 'cosine')
            environment = os.environ.get('ENVIRONMENT', 'production')
            bucket_name = f"{project_name}-congress-bills-data-{environment}"
            logger.info(f"Using constructed congress bills data bucket name: {bucket_name}")
            return bucket_name
        
        # Default to chat files bucket
        if self.bucket_name is None:
            self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
            if not self.bucket_name:
                raise ValueError("CHAT_FILES_BUCKET_NAME environment variable not set")
        return self.bucket_name
    
    def read_file(self, s3_key: str, file_type: str = "auto") -> str:
        """
        Read a file from S3 and return its content as a string
        
        Args:
            s3_key: The S3 key/path of the file
            file_type: The type of file (auto-detect if not specified)
            
        Returns:
            File content as string
        """
        try:
            bucket_name = self.get_bucket_name(s3_key)
            logger.info(f"Reading file from S3: {bucket_name}/{s3_key}")
            
            # Get the object from S3
            response = self.s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            content = response['Body'].read()
            
            # Decode based on content type
            content_type = response.get('ContentType', '')
            if 'json' in content_type or file_type == 'json' or s3_key.endswith('.json'):
                # JSON file
                try:
                    json_data = json.loads(content.decode('utf-8'))
                    return json.dumps(json_data, indent=2)
                except json.JSONDecodeError as e:
                    return f"Error parsing JSON: {str(e)}\nRaw content: {content.decode('utf-8')}"
            elif 'csv' in content_type or file_type == 'csv' or s3_key.endswith('.csv'):
                # CSV file
                return content.decode('utf-8')
            elif 'text' in content_type or file_type == 'txt' or s3_key.endswith('.txt'):
                # Text file
                return content.decode('utf-8')
            else:
                # Try to decode as UTF-8, fallback to base64 if it fails
                try:
                    return content.decode('utf-8')
                except UnicodeDecodeError:
                    import base64
                    return f"Binary file content (base64): {base64.b64encode(content).decode('utf-8')}"
                    
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'NoSuchKey':
                # If file not found in first bucket, try congress bills bucket if it's a billtext file
                if s3_key.startswith('billtext/') and bucket_name != self.get_bucket_name(s3_key):
                    logger.info(f"File not found in {bucket_name}, trying congress bills bucket")
                    try:
                        congress_bucket = self.get_bucket_name(s3_key)
                        response = self.s3_client.get_object(Bucket=congress_bucket, Key=s3_key)
                        content = response['Body'].read()
                        # Decode and return (same logic as above)
                        content_type = response.get('ContentType', '')
                        if 'html' in content_type or s3_key.endswith('.html'):
                            return content.decode('utf-8')
                        else:
                            return content.decode('utf-8')
                    except ClientError as e2:
                        return f"File not found in either bucket: {s3_key}"
                return f"File not found: {s3_key} in bucket {bucket_name}"
            elif error_code == 'NoSuchBucket':
                return f"Bucket not found: {bucket_name}"
            elif error_code == 'AccessDenied':
                return f"Access denied to bucket {bucket_name} for key {s3_key}. Check IAM permissions."
            else:
                return f"S3 error ({error_code}): {str(e)}"
        except Exception as e:
            return f"Error reading file: {str(e)}"
    
    def get_file_info(self, s3_key: str) -> Dict[str, Any]:
        """
        Get metadata about a file in S3
        
        Args:
            s3_key: The S3 key/path of the file
            
        Returns:
            Dictionary with file metadata
        """
        try:
            bucket_name = self.get_bucket_name(s3_key)
            response = self.s3_client.head_object(Bucket=bucket_name, Key=s3_key)
            
            return {
                'size': response['ContentLength'],
                'last_modified': response['LastModified'].isoformat(),
                'content_type': response.get('ContentType', 'unknown'),
                'etag': response['ETag']
            }
        except ClientError as e:
            return {'error': str(e)}
        except Exception as e:
            return {'error': str(e)}

@tool
def read_s3_file_tool(s3_key: str, file_type: str = "auto") -> str:
    """
    Tool function to read files from S3
    
    Args:
        s3_key: The S3 key/path of the file to read
        file_type: The type of file (auto-detect if not specified)
        
    Returns:
        String with file content or error message
    """
    try:
        if not s3_key:
            return "Error: s3_key parameter is required"
        
        # Create S3 file reader instance
        reader = S3FileReader()
        
        # Read the file
        content = reader.read_file(s3_key, file_type)
        
        # Get file info for context
        file_info = reader.get_file_info(s3_key)
        
        # Format the response
        if 'error' in file_info:
            result = f"File Content:\n{content}\n\nFile Info: {file_info['error']}"
        else:
            result = f"""File Content:
{content}

File Information:
- Size: {file_info['size']} bytes
- Last Modified: {file_info['last_modified']}
- Content Type: {file_info['content_type']}
- ETag: {file_info['etag']}"""
        
        return result
        
    except Exception as e:
        logger.error(f"Error in read_s3_file_tool: {str(e)}")
        return f"Error reading file: {str(e)}"
