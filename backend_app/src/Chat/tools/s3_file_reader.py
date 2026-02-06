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
    "description": "Read and analyze files uploaded to S3 by users. Use this tool when users ask about uploaded files or when you need to analyze file content. When context items include s3_bucket and s3_key (or s3_uri), pass s3_bucket so the correct bucket is used.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "s3_key": {
                    "type": "string",
                    "description": "The S3 key/path of the file to read (e.g., 'users/user_id/sessions/session_id/files/file_id_filename.json' or 'filings/4-xxx/documentformatfiles/file.txt')"
                },
                "file_type": {
                    "type": "string",
                    "description": "The type of file being read (e.g., 'json', 'csv', 'txt', 'pdf')",
                    "default": "auto"
                },
                "s3_bucket": {
                    "type": "string",
                    "description": "Optional. The S3 bucket name. When provided (e.g. from context item data.s3_bucket), the file is read from this bucket instead of inferring from the key. Use when context has s3_bucket and s3_key for SEC filings, congress bills, LDA, politician trades, etc."
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
        
        # If s3_key starts with filings/, distinguish SEC EDGAR vs LDA (lobbying) disclosures
        # LDA uses filings/RR/ or filings/LDA/; SEC search stores filings/{accession}/documentformatfiles/ etc.
        if s3_key and s3_key.startswith('filings/'):
            is_lda = s3_key.startswith('filings/RR/') or s3_key.startswith('filings/LDA/')
            if is_lda:
                bucket_name = os.environ.get('LDA_DISCLOSURES_S3_BUCKET_NAME')
                if bucket_name:
                    logger.info(f"Using LDA disclosures bucket for LDA filings/ file: {bucket_name}")
                    return bucket_name
                project_name = os.environ.get('PROJECT_NAME', 'cosine')
                environment = os.environ.get('ENVIRONMENT', 'production')
                bucket_name = f"{project_name}-lda-disclosures-{environment}"
                logger.info(f"Using constructed LDA disclosures bucket name: {bucket_name}")
                return bucket_name
            # SEC EDGAR filings (e.g. filings/4-0001179864-001-36743-21587910/documentformatfiles/...)
            bucket_name = os.environ.get('SEC_FILINGS_S3_BUCKET') or os.environ.get('SEC_FILINGS_BUCKET')
            if bucket_name:
                logger.info(f"Using SEC filings bucket for filings/ file: {bucket_name}")
                return bucket_name
            project_name = os.environ.get('PROJECT_NAME', 'cosine')
            environment = os.environ.get('ENVIRONMENT', 'production')
            bucket_name = f"{project_name}-sec-filings-{environment}"
            logger.info(f"Using constructed SEC filings bucket name: {bucket_name}")
            return bucket_name
        
        # Default to chat files bucket
        if self.bucket_name is None:
            self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
            if not self.bucket_name:
                raise ValueError("CHAT_FILES_BUCKET_NAME environment variable not set")
        return self.bucket_name
    
    def read_file(self, s3_key: str, file_type: str = "auto", s3_bucket: str = None) -> str:
        """
        Read a file from S3 and return its content as a string
        
        SECURITY: Validates that the S3 key belongs to the authenticated user.
        
        Args:
            s3_key: The S3 key/path of the file
            file_type: The type of file (auto-detect if not specified)
            s3_bucket: Optional. When provided, use this bucket instead of inferring from key (for context items with explicit bucket).
            
        Returns:
            File content as string
            
        Raises:
            ValueError: If user_id validation fails
        """
        try:
            # SECURITY: Validate user_id for user-scoped keys (users/...); skip for public/app keys
            is_public_key = s3_key and (
                s3_key.startswith('billtext/') or
                s3_key.startswith('filings/') or
                s3_key.startswith('trades/')
            )
            if not is_public_key:
                try:
                    from utils.auth_helper import validate_s3_key_user_id, get_secure_user_id
                    authenticated_user_id = get_secure_user_id({}, fallback_to_env=True)
                    if authenticated_user_id:
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
            else:
                logger.info(f"Reading public/app S3 key (no user validation): {s3_key[:80]}...")
            bucket_name = s3_bucket if s3_bucket else self.get_bucket_name(s3_key)
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
            logger.info(f"📄 [DOCUMENT_PROCESSING] Starting document processing for file: {s3_key}")
            logger.info(f"📊 [DOCUMENT_PROCESSING] File size: {len(content):,} bytes")
            try:
                # Import with fallback for path resolution
                logger.info(f"📦 [DOCUMENT_PROCESSING] Attempting to import document processing modules...")
                try:
                    from document_detector import DocumentDetector
                    from document_router import DocumentRouter
                    from document_indexer import DocumentIndexer
                    logger.info(f"✅ [DOCUMENT_PROCESSING] Successfully imported document processing modules (direct import)")
                except ImportError as import_err:
                    logger.warning(f"⚠️ [DOCUMENT_PROCESSING] Direct import failed: {import_err}, trying absolute import...")
                    # Try absolute import
                    tools_dir = os.path.dirname(__file__)
                    if tools_dir not in sys.path:
                        sys.path.insert(0, tools_dir)
                        logger.info(f"📁 [DOCUMENT_PROCESSING] Added tools directory to sys.path: {tools_dir}")
                    try:
                        from document_detector import DocumentDetector
                        from document_router import DocumentRouter
                        from document_indexer import DocumentIndexer
                        logger.info(f"✅ [DOCUMENT_PROCESSING] Successfully imported document processing modules (absolute import)")
                    except ImportError as abs_import_err:
                        logger.error(f"❌ [DOCUMENT_PROCESSING] Failed to import document processing modules: {abs_import_err}")
                        raise
                
                # Extract filename from S3 key
                filename = s3_key.split('/')[-1] if '/' in s3_key else s3_key
                logger.info(f"📝 [DOCUMENT_PROCESSING] Extracted filename: {filename} from S3 key: {s3_key}")
                
                # Get content preview for detection (first 2KB)
                content_preview = content[:2048]
                content_size = len(content)
                logger.info(f"📊 [DOCUMENT_PROCESSING] Content size: {content_size:,} bytes, preview: {len(content_preview)} bytes")
                
                # Check if file is large and needs special handling (for HTML/TXT SEC filings)
                is_large_file = content_size > 5 * 1024 * 1024  # 5MB threshold
                file_extension = filename.lower().split('.')[-1] if '.' in filename else ''
                is_html_or_txt = file_extension in ['htm', 'html', 'txt', 'xml']
                
                if is_large_file:
                    logger.info(f"📦 [DOCUMENT_PROCESSING] Large file detected ({content_size:,} bytes, extension: {file_extension}) - will pass s3_key only to parser")
                    logger.info(f"📦 [DOCUMENT_PROCESSING] Parser will read from S3 and process in chunks to avoid memory issues")
                
                # Detect document type
                logger.info(f"🔍 [DOCUMENT_PROCESSING] Starting document type detection...")
                detector = DocumentDetector()
                doc_info = detector.detect_document_type(s3_key, content_preview, filename)
                doc_type = doc_info.get("type")
                confidence = doc_info.get("confidence", 0)
                logger.info(f"🔍 [DOCUMENT_PROCESSING] Detection result - Type: {doc_type}, Confidence: {confidence:.2%}, Metadata: {doc_info.get('metadata', {})}")
                
                # If document type detected with confidence > 0.5, route to parser
                if doc_type != "unknown" and confidence > 0.5:
                    logger.info(f"✅ [DOCUMENT_PROCESSING] Document type detected: {doc_type} (confidence: {confidence:.2%}) for {s3_key} - proceeding to routing")
                    
                    try:
                        # Route to appropriate parser
                        logger.info(f"🔄 [DOCUMENT_PROCESSING] Routing document to parser (type: {doc_type})...")
                        router = DocumentRouter()
                        
                        # For large files, pass None for content and let parser read from S3 using s3_key
                        # This prevents context window overflow and memory issues
                        content_to_pass = None if is_large_file else content
                        if is_large_file:
                            logger.info(f"📦 [DOCUMENT_PROCESSING] Large file detected ({content_size:,} bytes) - passing s3_key only, parser will read from S3")
                        else:
                            logger.info(f"📦 [DOCUMENT_PROCESSING] Passing full content ({content_size:,} bytes) to parser")
                        
                        parser_result = router.route_document(
                            doc_type,
                            s3_key,
                            content_to_pass,  # Pass None for large files, full content for small files
                            doc_info.get("metadata")
                        )
                        
                        parser_success = parser_result.get("success", False)
                        logger.info(f"{'✅' if parser_success else '❌'} [DOCUMENT_PROCESSING] Parser routing complete - Success: {parser_success}")
                        if parser_success:
                            extracted_data = parser_result.get("extracted_data", {})
                            logger.info(f"📊 [DOCUMENT_PROCESSING] Extracted data keys: {list(extracted_data.keys()) if isinstance(extracted_data, dict) else 'N/A'}")
                        
                        # Index the extracted data if parsing was successful
                        if parser_success and user_id:
                            logger.info(f"💾 [DOCUMENT_PROCESSING] Starting document indexing for user: {user_id}...")
                            try:
                                indexer = DocumentIndexer()
                                index_id = indexer.index_document(
                                    user_id,
                                    s3_key,
                                    doc_info,
                                    parser_result
                                )
                                
                                if index_id:
                                    logger.info(f"✅ [DOCUMENT_PROCESSING] Successfully indexed document {s3_key} with index_id: {index_id}")
                                else:
                                    logger.warning(f"⚠️ [DOCUMENT_PROCESSING] Indexing returned no index_id for {s3_key}")
                            except Exception as index_err:
                                logger.error(f"❌ [DOCUMENT_PROCESSING] Failed to index document {s3_key}: {index_err}")
                                import traceback
                                logger.error(f"❌ [DOCUMENT_PROCESSING] Indexing traceback: {traceback.format_exc()}")
                                # Continue even if indexing fails
                        elif not parser_success:
                            logger.warning(f"⚠️ [DOCUMENT_PROCESSING] Skipping indexing - parser did not succeed")
                        elif not user_id:
                            logger.warning(f"⚠️ [DOCUMENT_PROCESSING] Skipping indexing - user_id not available")
                        
                        # Format response with structured data summary (NO raw content for large files)
                        processing_info = parser_result.get("processing_info", {})
                        was_chunked = processing_info.get("chunked", False)
                        chunks_count = processing_info.get("chunks_processed", 1)
                        file_type_info = processing_info.get("file_type", "unknown")
                        file_size_bytes = processing_info.get("file_size_bytes", content_size)
                        text_length_chars = processing_info.get("text_length_chars", 0)
                        
                        logger.info(f"📊 [DOCUMENT_PROCESSING] Formatting response - Large file: {is_large_file}, Chunked: {was_chunked}, Size: {file_size_bytes:,} bytes")
                        
                        response_parts = [
                            f"📄 Document Type: {doc_info.get('type').value if hasattr(doc_info.get('type'), 'value') else doc_info.get('type')}",
                            f"📊 Confidence: {doc_info.get('confidence', 0):.0%}",
                        ]
                        
                        # Add chunking info if file was chunked
                        if was_chunked or is_large_file:
                            response_parts.append(f"📦 Processing: Large file processed in {chunks_count} chunks (file type: {file_type_info})")
                            response_parts.append(f"📏 File Size: {file_size_bytes:,} bytes ({text_length_chars:,} characters)")
                            response_parts.append(f"ℹ️ Note: Raw content not included due to file size. Structured data extracted below.")
                        
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
                            
                            logger.info(f"✅ [DOCUMENT_PROCESSING] Parser succeeded - extracted keys: {list(extracted.keys()) if isinstance(extracted, dict) else 'N/A'}")
                            
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
                            
                            # Add structured data JSON for agent to parse
                            response_parts.append(f"\n📋 Structured Financial Data (JSON):")
                            structured_data_json = json.dumps({
                                "document_type": doc_info.get('type').value if hasattr(doc_info.get('type'), 'value') else str(doc_info.get('type')),
                                "metadata": metadata,
                                "income_statement": income,
                                "balance_sheet": balance,
                                "cash_flow": extracted.get("cash_flow", {}),
                                "metrics": metrics
                            }, indent=2, default=str)
                            response_parts.append(structured_data_json)
                            
                            # Add note about indexing
                            response_parts.append(f"\n💾 Full structured financial data has been extracted and indexed for querying.")
                            if index_id:
                                response_parts.append(f"🔍 Index ID: {index_id}")
                        else:
                            logger.warning(f"⚠️ [DOCUMENT_PROCESSING] Parser did not succeed - result: {parser_result}")
                            response_parts.append(f"\n⚠️ Parsing completed but no structured data extracted.")
                        
                        # For large files, DO NOT include raw content preview (causes context window overflow)
                        if not is_large_file:
                            content_type = response.get('ContentType', '')
                            raw_content = self._decode_content_for_type(content, content_type, file_type, s3_key)
                            response_parts.append(f"\n📄 Raw Content Preview (first 2000 chars):\n{raw_content[:2000]}")
                        else:
                            logger.info(f"📦 [DOCUMENT_PROCESSING] Skipping raw content preview for large file ({file_size_bytes:,} bytes)")
                            response_parts.append(f"\n📄 Raw content available in S3 at: {s3_key} (not included due to size)")
                        
                        final_response = "\n".join(response_parts)
                        logger.info(f"✅ [DOCUMENT_PROCESSING] Response formatted - length: {len(final_response):,} characters")
                        return final_response
                        
                    except Exception as parse_err:
                        logger.error(f"❌ [DOCUMENT_PROCESSING] Error routing/parsing document {s3_key}: {parse_err}")
                        import traceback
                        logger.error(f"❌ [DOCUMENT_PROCESSING] Parse error traceback: {traceback.format_exc()}")
                        # Fall through to regular file reading
                else:
                    logger.info(f"ℹ️ [DOCUMENT_PROCESSING] Document type '{doc_type}' has low confidence ({confidence:.2%}) or is unknown - skipping specialized processing")
                
            except ImportError as import_err:
                logger.warning(f"⚠️ [DOCUMENT_PROCESSING] Document detection/routing not available: {import_err}")
                import traceback
                logger.warning(f"⚠️ [DOCUMENT_PROCESSING] Import error traceback: {traceback.format_exc()}")
                # Fall through to regular file reading
            except Exception as detect_err:
                logger.error(f"❌ [DOCUMENT_PROCESSING] Error in document detection: {detect_err}")
                import traceback
                logger.error(f"❌ [DOCUMENT_PROCESSING] Detection error traceback: {traceback.format_exc()}")
                # Fall through to regular file reading
            
            # Decode based on content type (existing logic - fallback for non-detected documents)
            content_type = response.get('ContentType', '')
            return self._decode_content_for_type(content, content_type, file_type, s3_key)
                    
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
    
<<<<<<< HEAD
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
    
    def get_file_info(self, s3_key: str) -> Dict[str, Any]:
=======
    def get_file_info(self, s3_key: str, s3_bucket: str = None) -> Dict[str, Any]:
>>>>>>> e946d9d50161ab4b0348cbf1209c39ad7a82d52a
        """
        Get metadata about a file in S3
        
        Args:
            s3_key: The S3 key/path of the file
            s3_bucket: Optional. When provided, use this bucket instead of inferring from key.
            
        Returns:
            Dictionary with file metadata
        """
        try:
            bucket_name = s3_bucket if s3_bucket else self.get_bucket_name(s3_key)
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
def read_s3_file_tool(s3_key: str, file_type: str = "auto", s3_bucket: str = None) -> str:
    """
    Tool function to read files from S3
    
    Args:
        s3_key: The S3 key/path of the file to read
        file_type: The type of file (auto-detect if not specified)
        s3_bucket: Optional. When provided (e.g. from context item data.s3_bucket), read from this bucket instead of inferring from key.
        
    Returns:
        String with file content or error message
    """
    try:
        if not s3_key:
            return "Error: s3_key parameter is required"
        
        # Create S3 file reader instance
        reader = S3FileReader()
        
        # Read the file (use explicit bucket when provided so SEC/LDA/bills/trades go to correct bucket)
        content = reader.read_file(s3_key, file_type, s3_bucket=s3_bucket)
        
        # Get file info for context
        file_info = reader.get_file_info(s3_key, s3_bucket=s3_bucket)
        
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
