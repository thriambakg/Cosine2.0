"""
S3 File Reader tool for the chat agent to read uploaded files from S3
"""

import json
import os
import boto3
import logging
from typing import Dict, Any
from botocore.exceptions import ClientError
import sys

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
            content = response['Body'].read()  # This is bytes, not string
            
            # Handle .cosine encrypted files (context items from filesystem)
            # Check this FIRST before other file type logic
            s3_key_lower = s3_key.lower()
            file_type_lower = file_type.lower() if file_type else ''
            
            # Check if this is a .cosine file by extension or explicit file_type
            is_cosine_file = s3_key_lower.endswith('.cosine') or file_type_lower == 'cosine'
            
            # Also check if content looks like Fernet-encrypted data (starts with gAAAAAB)
            content_preview = content[:20] if len(content) >= 20 else content
            looks_encrypted = isinstance(content_preview, bytes) and content_preview.startswith(b'gAAAAAB')
            
            if is_cosine_file or (looks_encrypted and '/filesys/' in s3_key):
                logger.info(f"🔐 Detected .cosine file or encrypted content, attempting decryption")
                logger.info(f"🔐 s3_key: {s3_key}, file_type: {file_type}, is_cosine_file: {is_cosine_file}, looks_encrypted: {looks_encrypted}")
                try:
                    # Import decryption helper (following pattern used by other tools)
                    try:
                        from utils.decryption_helper import decrypt_cosine_file
                        logger.info(f"✅ Successfully imported decryption_helper from utils")
                    except ImportError as import_err:
                        logger.error(f"❌ Failed to import from utils.decryption_helper: {str(import_err)}")
                        # Try direct import as fallback
                        try:
                            from decryption_helper import decrypt_cosine_file
                            logger.info(f"✅ Successfully imported decryption_helper directly")
                        except ImportError as import_err2:
                            logger.error(f"❌ Also failed direct import: {str(import_err2)}")
                            # Try adding path and importing
                            try:
                                import_path = os.path.join(os.path.dirname(__file__), '..', 'utils')
                                if import_path not in sys.path:
                                    sys.path.insert(0, import_path)
                                from decryption_helper import decrypt_cosine_file
                                logger.info(f"✅ Successfully imported after adding path")
                            except ImportError as import_err3:
                                logger.error(f"❌ All import attempts failed: {str(import_err3)}")
                                return f"Error: Failed to import decryption helper. Tried: utils.decryption_helper, decryption_helper, and path-based import. Last error: {str(import_err3)}"
                    
                    # Extract user_id from s3_key (format: users/{user_id}/filesys/...)
                    s3_key_parts = s3_key.split('/')
                    user_id = None
                    
                    if len(s3_key_parts) >= 2 and s3_key_parts[0] == 'users':
                        user_id = s3_key_parts[1]
                        logger.info(f"🔐 Extracted user_id from S3 key: {user_id}")
                    else:
                        # Fallback: try to get user_id from environment
                        user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID')
                        if user_id:
                            logger.info(f"🔐 Using user_id from environment: {user_id}")
                        else:
                            logger.error(f"❌ Cannot find user_id in S3 key or environment")
                            logger.error(f"❌ S3 key parts: {s3_key_parts}")
                            logger.error(f"❌ Environment USER_ID: {os.environ.get('USER_ID')}")
                            logger.error(f"❌ Environment CURRENT_USER_ID: {os.environ.get('CURRENT_USER_ID')}")
                            return f"Error: Cannot decrypt .cosine file - user_id not found in S3 key or environment. S3 key: {s3_key}"
                    
                    # Ensure content is bytes (not string)
                    if isinstance(content, str):
                        logger.warning(f"⚠️ Content is string, converting to bytes")
                        content = content.encode('utf-8')
                    
                    # Attempt decryption
                    logger.info(f"🔐 Attempting to decrypt .cosine file (size: {len(content)} bytes, type: {type(content).__name__}) for user {user_id}")
                    logger.info(f"🔐 Content preview (first 50 bytes): {content[:50] if len(content) >= 50 else content}")
                    try:
                        decrypted_data = decrypt_cosine_file(user_id, content)
                        logger.info(f"✅ Successfully decrypted .cosine file, returning JSON data")
                        logger.info(f"✅ Decrypted data keys: {list(decrypted_data.keys()) if isinstance(decrypted_data, dict) else 'N/A'}")
                        return json.dumps(decrypted_data, indent=2, default=str)
                    except ValueError as ve:
                        logger.error(f"❌ Decryption failed with ValueError: {str(ve)}")
                        return f"Error decrypting .cosine file: {str(ve)}"
                    except Exception as decrypt_err:
                        logger.error(f"❌ Decryption failed with exception: {str(decrypt_err)}")
                        import traceback
                        logger.error(f"❌ Decryption traceback: {traceback.format_exc()}")
                        return f"Error decrypting .cosine file: {str(decrypt_err)}"
                        
                except Exception as e:
                    logger.error(f"❌ Unexpected error in .cosine decryption block: {str(e)}")
                    import traceback
                    logger.error(f"❌ Traceback: {traceback.format_exc()}")
                    return f"Error decrypting .cosine file: {str(e)}"
            
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
