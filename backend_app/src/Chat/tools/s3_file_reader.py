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
            # Try environment variable first
            bucket_name = os.environ.get('CONGRESS_BILLS_DATA_S3_BUCKET_NAME')
            if bucket_name:
                logger.info(f"Using congress bills data bucket from environment: {bucket_name}")
                return bucket_name
            # Fallback: construct from project name and environment
            project_name = os.environ.get('PROJECT_NAME', 'cosine')
            environment = os.environ.get('ENVIRONMENT', 'production')
            bucket_name = f"{project_name}-congress-bills-data-{environment}"
            logger.info(f"Using constructed congress bills data bucket name: {bucket_name}")
            return bucket_name
        
        # If s3_key starts with filings/, use LDA disclosures bucket
        if s3_key and s3_key.startswith('filings/'):
            bucket_name = os.environ.get('LDA_DISCLOSURES_S3_BUCKET_NAME')
            if bucket_name:
                logger.info(f"Using LDA disclosures bucket for filings/ file: {bucket_name}")
                return bucket_name
            # Fallback: try to construct bucket name if env var not set
            project_name = os.environ.get('PROJECT_NAME', 'cosine')
            environment = os.environ.get('ENVIRONMENT', 'production')
            bucket_name = f"{project_name}-lda-disclosures-{environment}"
            logger.info(f"Using constructed LDA disclosures bucket name: {bucket_name}")
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
        
        SECURITY: Validates that the S3 key belongs to the authenticated user.
        
        Args:
            s3_key: The S3 key/path of the file
            file_type: The type of file (auto-detect if not specified)
            
        Returns:
            File content as string
            
        Raises:
            ValueError: If user_id validation fails
        """
        try:
            # SECURITY: Validate user_id from S3 key matches authenticated user
            try:
                from utils.auth_helper import validate_s3_key_user_id, get_secure_user_id
                
                # Get authenticated user_id (from environment set by lambda_handler)
                authenticated_user_id = get_secure_user_id({}, fallback_to_env=True)
                
                if authenticated_user_id:
                    # Validate S3 key belongs to authenticated user
                    if not validate_s3_key_user_id(s3_key, authenticated_user_id):
                        error_msg = f"Access denied: S3 key does not belong to authenticated user"
                        logger.error(f"❌ {error_msg}")
                        return f"Error: {error_msg}. You can only access files in your own user directory."
                else:
                    logger.warning("⚠️ Could not get authenticated user_id for S3 key validation")
            except ImportError:
                logger.warning("⚠️ auth_helper not available, skipping user_id validation")
            except Exception as e:
                logger.error(f"Error validating S3 key user_id: {str(e)}")
                # Continue but log the error
            
            bucket_name = self.get_bucket_name(s3_key)
            logger.info(f"Reading file from S3: {bucket_name}/{s3_key}")
            
            # Get the object from S3
            response = self.s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            content = response['Body'].read()  # This is bytes, not string
            
            # Extract user_id for indexing (needed after .cosine handling)
            user_id = None
            try:
                from utils.auth_helper import get_secure_user_id
                user_id = get_secure_user_id({}, fallback_to_env=True)
            except ImportError:
                user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID')
            
            # If user_id not found yet, try to extract from S3 key
            if not user_id:
                s3_key_parts = s3_key.split('/')
                if len(s3_key_parts) >= 2 and s3_key_parts[0] == 'users':
                    user_id = s3_key_parts[1]
            
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
                        # Fallback: try to get user_id from secure source
                        try:
                            from utils.auth_helper import get_secure_user_id
                            user_id = get_secure_user_id({}, fallback_to_env=True)
                            if user_id:
                                logger.info(f"🔐 Using user_id from secure source: {user_id}")
                            else:
                                logger.error(f"❌ Cannot find user_id in S3 key or secure source")
                                return f"Error: Cannot decrypt .cosine file - user_id not found. S3 key: {s3_key}"
                        except ImportError:
                            # Fallback to environment if auth_helper not available
                            user_id = os.environ.get('USER_ID') or os.environ.get('CURRENT_USER_ID')
                            if user_id:
                                logger.info(f"🔐 Using user_id from environment: {user_id}")
                            else:
                                logger.error(f"❌ Cannot find user_id in S3 key or environment")
                                return f"Error: Cannot decrypt .cosine file - user_id not found. S3 key: {s3_key}"
                    
                    # SECURITY: Validate user_id from S3 key matches authenticated user
                    try:
                        from utils.auth_helper import validate_s3_key_user_id, get_secure_user_id
                        authenticated_user_id = get_secure_user_id({}, fallback_to_env=True)
                        if authenticated_user_id and not validate_s3_key_user_id(s3_key, authenticated_user_id):
                            error_msg = f"Access denied: S3 key does not belong to authenticated user"
                            logger.error(f"❌ {error_msg}")
                            return f"Error: {error_msg}. You can only access files in your own user directory."
                    except ImportError:
                        logger.warning("⚠️ auth_helper not available, skipping user_id validation for decryption")
                    except Exception as e:
                        logger.warning(f"Error validating user_id for decryption: {str(e)}")
                    
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
            
            # Document Detection and Routing (NEW)
            # Detect document type and route to specialized parser if applicable
            try:
                # Import with fallback for path resolution
                try:
                    from document_detector import DocumentDetector
                    from document_router import DocumentRouter
                    from document_indexer import DocumentIndexer
                except ImportError:
                    # Try absolute import
                    tools_dir = os.path.dirname(__file__)
                    if tools_dir not in sys.path:
                        sys.path.insert(0, tools_dir)
                    from document_detector import DocumentDetector
                    from document_router import DocumentRouter
                    from document_indexer import DocumentIndexer
                
                # Extract filename from S3 key
                filename = s3_key.split('/')[-1] if '/' in s3_key else s3_key
                
                # Get content preview for detection (first 2KB)
                content_preview = content[:2048]
                
                # Detect document type
                detector = DocumentDetector()
                doc_info = detector.detect_document_type(s3_key, content_preview, filename)
                
                # If document type detected with confidence > 0.5, route to parser
                if doc_info.get("type") != "unknown" and doc_info.get("confidence", 0) > 0.5:
                    logger.info(f"🔍 Detected document type: {doc_info.get('type')} (confidence: {doc_info.get('confidence')}) for {s3_key}")
                    
                    try:
                        # Route to appropriate parser
                        router = DocumentRouter()
                        parser_result = router.route_document(
                            doc_info.get("type"),
                            s3_key,
                            content,
                            doc_info.get("metadata")
                        )
                        
                        # Index the extracted data if parsing was successful
                        if parser_result.get("success") and user_id:
                            try:
                                indexer = DocumentIndexer()
                                index_id = indexer.index_document(
                                    user_id,
                                    s3_key,
                                    doc_info,
                                    parser_result
                                )
                                
                                if index_id:
                                    logger.info(f"✅ Indexed document {s3_key} as {index_id}")
                            except Exception as index_err:
                                logger.warning(f"⚠️ Failed to index document {s3_key}: {index_err}")
                                # Continue even if indexing fails
                        
                        # Format enhanced response with raw content + extracted data
                        content_type = response.get('ContentType', '')
                        
                        # Decode raw content for LLM context
                        raw_content = self._decode_content_for_type(content, content_type, file_type, s3_key)
                        
                        # Format response with both raw content and extracted data
                        response_parts = [
                            f"📄 Document Type: {doc_info.get('type').value if hasattr(doc_info.get('type'), 'value') else doc_info.get('type')}",
                            f"📊 Confidence: {doc_info.get('confidence', 0):.0%}",
                        ]
                        
                        # Add metadata if available
                        metadata = doc_info.get("metadata", {})
                        if metadata.get("company_name"):
                            response_parts.append(f"🏢 Company: {metadata['company_name']}")
                        if metadata.get("form_type"):
                            response_parts.append(f"📋 Form Type: {metadata['form_type']}")
                        if metadata.get("filing_date"):
                            response_parts.append(f"📅 Filing Date: {metadata['filing_date']}")
                        
                        # Add extracted financial data summary
                        if parser_result.get("success"):
                            extracted = parser_result.get("extracted_data") or parser_result
                            
                            # Income Statement summary
                            income = extracted.get("income_statement", {})
                            if income.get("revenue"):
                                rev_val = income["revenue"].get("value", 0) / 1_000_000_000
                                response_parts.append(f"\n💰 Revenue: ${rev_val:.2f}B")
                            if income.get("net_income"):
                                ni_val = income["net_income"].get("value", 0) / 1_000_000_000
                                response_parts.append(f"💵 Net Income: ${ni_val:.2f}B")
                            
                            # Balance Sheet summary
                            balance = extracted.get("balance_sheet", {})
                            if balance.get("total_assets"):
                                assets_val = balance["total_assets"].get("value", 0) / 1_000_000_000
                                response_parts.append(f"📊 Total Assets: ${assets_val:.2f}B")
                            if balance.get("equity"):
                                equity_val = balance["equity"].get("value", 0) / 1_000_000_000
                                response_parts.append(f"💼 Equity: ${equity_val:.2f}B")
                            
                            # Metrics summary
                            metrics = extracted.get("metrics", {})
                            if metrics.get("gross_margin"):
                                response_parts.append(f"📈 Gross Margin: {metrics['gross_margin']:.1%}")
                            if metrics.get("net_margin"):
                                response_parts.append(f"📉 Net Margin: {metrics['net_margin']:.1%}")
                            
                            # Add note about full structured data
                            response_parts.append(f"\n📋 Full structured financial data has been extracted and indexed for querying.")
                            if index_id:
                                response_parts.append(f"🔍 Index ID: {index_id}")
                        
                        response_parts.append(f"\n📄 Raw Content Preview (first 2000 chars):\n{raw_content[:2000]}")
                        
                        return "\n".join(response_parts)
                        
                    except Exception as parse_err:
                        logger.error(f"Error routing/parsing document {s3_key}: {parse_err}")
                        import traceback
                        logger.error(f"Traceback: {traceback.format_exc()}")
                        # Fall through to regular file reading
                
            except ImportError as import_err:
                logger.warning(f"⚠️ Document detection/routing not available: {import_err}")
                # Fall through to regular file reading
            except Exception as detect_err:
                logger.warning(f"⚠️ Error in document detection: {detect_err}")
                # Fall through to regular file reading
            
            # Decode based on content type (existing logic - fallback for non-detected documents)
            content_type = response.get('ContentType', '')
            return self._decode_content_for_type(content, content_type, file_type, s3_key)
    
    def _decode_content_for_type(self, content: bytes, content_type: str, file_type: str, s3_key: str) -> str:
        """
        Decode content based on file type (helper method)
        
        Args:
            content: File content bytes
            content_type: Content type from S3
            file_type: Explicit file type parameter
            s3_key: S3 key (for extension detection)
            
        Returns:
            Decoded content string
        """
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
        elif 'html' in content_type or s3_key.endswith('.html'):
            # HTML file
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
