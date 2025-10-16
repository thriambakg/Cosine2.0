"""
File Upload Handler for WebSocket Message Processor
Handles file compression, decompression, and S3 storage for chat attachments
"""

import json
import os
import logging
import uuid
import boto3
import gzip
import base64
from datetime import datetime
from typing import Dict, List, Any, Optional
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger(__name__)

# Initialize AWS clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

def compress_file_data(file_data: bytes, filename: str) -> Dict[str, Any]:
    """
    Compress file data using gzip compression
    
    Args:
        file_data: Raw file bytes
        filename: Original filename
        
    Returns:
        Dict containing compressed data and metadata
    """
    try:
        # Compress the file data
        compressed_data = gzip.compress(file_data)
        
        # Calculate compression ratio
        original_size = len(file_data)
        compressed_size = len(compressed_data)
        compression_ratio = compressed_size / original_size if original_size > 0 else 0
        
        logger.info(f"📦 File compression: {filename} - {original_size} -> {compressed_size} bytes ({compression_ratio:.2%})")
        
        return {
            'compressed_data': base64.b64encode(compressed_data).decode('utf-8'),
            'original_size': original_size,
            'compressed_size': compressed_size,
            'compression_ratio': compression_ratio,
            'filename': filename,
            'compressed_at': datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"❌ Failed to compress file {filename}: {str(e)}")
        raise

def decompress_file_data(compressed_data_b64: str) -> bytes:
    """
    Decompress file data from base64 encoded gzip
    
    Args:
        compressed_data_b64: Base64 encoded compressed data
        
    Returns:
        Decompressed file bytes
    """
    try:
        # Decode base64 and decompress
        compressed_data = base64.b64decode(compressed_data_b64)
        decompressed_data = gzip.decompress(compressed_data)
        
        logger.info(f"📦 File decompression: {len(compressed_data)} -> {len(decompressed_data)} bytes")
        
        return decompressed_data
    except Exception as e:
        logger.error(f"❌ Failed to decompress file data: {str(e)}")
        raise

def upload_file_to_s3(
    file_data: bytes, 
    user_id: str, 
    session_id: str, 
    filename: str,
    content_type: str = 'application/octet-stream'
) -> Dict[str, str]:
    """
    Upload file to S3 with organized directory structure
    
    Args:
        file_data: Raw file bytes
        user_id: User ID for directory structure
        session_id: Session ID for directory structure
        filename: Original filename
        content_type: MIME type of the file
        
    Returns:
        Dict containing S3 object key and URL
    """
    try:
        # Get S3 bucket name from environment
        bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
        if not bucket_name:
            raise ValueError("CHAT_FILES_BUCKET_NAME environment variable not set")
        
        # Generate unique file key with organized structure
        file_extension = os.path.splitext(filename)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        s3_key = f"users/{user_id}/sessions/{session_id}/files/{unique_filename}"
        
        # Upload to S3 with TTL metadata
        s3_client.put_object(
            Bucket=bucket_name,
            Key=s3_key,
            Body=file_data,
            ContentType=content_type,
            Metadata={
                'original_filename': filename,
                'user_id': user_id,
                'session_id': session_id,
                'uploaded_at': datetime.utcnow().isoformat(),
                'ttl_days': '90',  # TTL for automatic deletion
                'auto_delete': 'true'  # Flag for automatic cleanup
            }
        )
        
        # Generate S3 URL
        s3_url = f"s3://{bucket_name}/{s3_key}"
        
        logger.info(f"✅ File uploaded to S3: {s3_key}")
        
        return {
            's3_key': s3_key,
            's3_url': s3_url,
            'bucket_name': bucket_name,
            'original_filename': filename,
            'file_size': len(file_data)
        }
        
    except ClientError as e:
        logger.error(f"❌ S3 upload failed: {str(e)}")
        raise
    except Exception as e:
        logger.error(f"❌ File upload failed: {str(e)}")
        raise

def process_file_upload(
    compressed_file_data: Dict[str, Any],
    user_id: str,
    session_id: str
) -> Dict[str, Any]:
    """
    Process a compressed file upload: decompress and upload to S3
    
    Args:
        compressed_file_data: Compressed file data from frontend
        user_id: User ID
        session_id: Session ID
        
    Returns:
        Dict containing file metadata and S3 information
    """
    try:
        # Extract file information
        filename = compressed_file_data.get('filename', 'unknown')
        content_type = compressed_file_data.get('content_type', 'application/octet-stream')
        compressed_data_b64 = compressed_file_data.get('compressed_data')
        
        if not compressed_data_b64:
            raise ValueError("No compressed data provided")
        
        # Decompress the file
        file_data = decompress_file_data(compressed_data_b64)
        
        # Upload to S3
        s3_info = upload_file_to_s3(
            file_data=file_data,
            user_id=user_id,
            session_id=session_id,
            filename=filename,
            content_type=content_type
        )
        
        # Return file metadata
        return {
            'file_id': str(uuid.uuid4()),
            'original_filename': filename,
            'file_size': compressed_file_data.get('original_size', len(file_data)),
            'compressed_size': compressed_file_data.get('compressed_size', 0),
            'compression_ratio': compressed_file_data.get('compression_ratio', 0),
            'content_type': content_type,
            's3_key': s3_info['s3_key'],
            's3_url': s3_info['s3_url'],
            'uploaded_at': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ File processing failed: {str(e)}")
        raise

def store_file_metadata_in_session(
    user_id: str,
    session_id: str,
    file_metadata_list: List[Dict[str, Any]]
) -> bool:
    """
    Store file metadata in a separate uploaded_files column (not in session_variables)
    
    Args:
        user_id: User ID
        session_id: Session ID
        file_metadata_list: List of file metadata dictionaries
        
    Returns:
        True if successful, False otherwise
    """
    try:
        # Get current uploaded files from separate column
        response = chat_sessions_table.get_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        
        session_item = response.get('Item', {})
        current_files = session_item.get('uploaded_files', [])
        
        # Add new files to the list
        updated_files = current_files + file_metadata_list
        
        # Update uploaded_files column (separate from session_variables)
        chat_sessions_table.update_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            },
            UpdateExpression='SET uploaded_files = :files, files_uploaded_at = :timestamp, last_updated = :updated',
            ExpressionAttributeValues={
                ':files': updated_files,
                ':timestamp': int(datetime.now().timestamp()),
                ':updated': int(datetime.now().timestamp())
            }
        )
        
        logger.info(f"✅ Stored {len(file_metadata_list)} files in uploaded_files column for session {session_id}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to store file metadata in session: {str(e)}")
        return False

def get_file_content_from_s3(s3_key: str) -> Optional[str]:
    """
    Retrieve file content from S3 for the chat agent
    
    Args:
        s3_key: S3 object key
        
    Returns:
        File content as string or None if failed
    """
    try:
        bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
        if not bucket_name:
            logger.error("❌ CHAT_FILES_BUCKET_NAME environment variable not set")
            return None
        
        # Get file from S3
        response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
        file_content = response['Body'].read()
        
        # Try to decode as text (for text files)
        try:
            return file_content.decode('utf-8')
        except UnicodeDecodeError:
            # For binary files, return base64 encoded content
            import base64
            return base64.b64encode(file_content).decode('utf-8')
            
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            logger.warning(f"⚠️ File not found in S3: {s3_key}")
        else:
            logger.error(f"❌ Failed to get file from S3: {str(e)}")
        return None
    except Exception as e:
        logger.error(f"❌ File content retrieval failed: {str(e)}")
        return None

def upload_agent_generated_file(
    file_content: bytes,
    filename: str,
    content_type: str,
    user_id: str,
    session_id: str,
    file_description: str = ""
) -> Dict[str, Any]:
    """
    Upload a file generated by the chat agent to S3
    
    Args:
        file_content: File content as bytes
        filename: Original filename
        content_type: MIME type
        user_id: User ID
        session_id: Session ID
        file_description: Description of the generated file
        
    Returns:
        File metadata dictionary
    """
    try:
        # Generate unique file key for agent-generated files
        file_extension = os.path.splitext(filename)[1]
        unique_filename = f"agent_{uuid.uuid4()}{file_extension}"
        s3_key = f"users/{user_id}/sessions/{session_id}/files/{unique_filename}"
        
        # Upload to S3 with agent-specific metadata
        s3_client.put_object(
            Bucket=os.environ.get('CHAT_FILES_BUCKET_NAME'),
            Key=s3_key,
            Body=file_content,
            ContentType=content_type,
            Metadata={
                'original_filename': filename,
                'user_id': user_id,
                'session_id': session_id,
                'uploaded_at': datetime.utcnow().isoformat(),
                'generated_by': 'agent',
                'file_description': file_description,
                'ttl_days': '90',
                'auto_delete': 'true'
            }
        )
        
        # Generate S3 URL
        s3_url = f"s3://{os.environ.get('CHAT_FILES_BUCKET_NAME')}/{s3_key}"
        
        logger.info(f"✅ Agent-generated file uploaded to S3: {s3_key}")
        
        return {
            'file_id': str(uuid.uuid4()),
            'original_filename': filename,
            'file_size': len(file_content),
            'content_type': content_type,
            's3_key': s3_key,
            's3_url': s3_url,
            'generated_by': 'agent',
            'file_description': file_description,
            'uploaded_at': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to upload agent-generated file: {str(e)}")
        raise

def store_agent_file_in_session(
    user_id: str,
    session_id: str,
    file_metadata: Dict[str, Any]
) -> bool:
    """
    Store agent-generated file metadata in uploaded_files column (not in session_variables)
    
    Args:
        user_id: User ID
        session_id: Session ID
        file_metadata: File metadata dictionary
        
    Returns:
        True if successful, False otherwise
    """
    try:
        # Get current uploaded files from separate column
        response = chat_sessions_table.get_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            }
        )
        
        session_item = response.get('Item', {})
        current_files = session_item.get('uploaded_files', [])
        
        # Add agent-generated file to the list
        updated_files = current_files + [file_metadata]
        
        # Update uploaded_files column (separate from session_variables)
        chat_sessions_table.update_item(
            Key={
                'user_id': user_id,
                'session_id': session_id
            },
            UpdateExpression='SET uploaded_files = :files, agent_files_generated_at = :timestamp, last_updated = :updated',
            ExpressionAttributeValues={
                ':files': updated_files,
                ':timestamp': int(datetime.now().timestamp()),
                ':updated': int(datetime.now().timestamp())
            }
        )
        
        logger.info(f"✅ Stored agent-generated file in uploaded_files column for session {session_id}")
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to store agent file in session: {str(e)}")
        return False

def validate_file_upload(file_data: Dict[str, Any]) -> bool:
    """
    Validate file upload data
    
    Args:
        file_data: File upload data
        
    Returns:
        True if valid, False otherwise
    """
    try:
        # Check required fields
        required_fields = ['filename', 'compressed_data', 'content_type']
        for field in required_fields:
            if field not in file_data:
                logger.warning(f"⚠️ Missing required field: {field}")
                return False
        
        # Check file size limits
        max_file_size = 50 * 1024 * 1024  # 50MB
        original_size = file_data.get('original_size', 0)
        if original_size > max_file_size:
            logger.warning(f"⚠️ File too large: {original_size} bytes (max: {max_file_size})")
            return False
        
        # Check file type (basic validation)
        allowed_types = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'text/plain', 'text/csv',
            'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]
        
        content_type = file_data.get('content_type', '')
        if content_type not in allowed_types:
            logger.warning(f"⚠️ Unsupported file type: {content_type}")
            return False
        
        return True
        
    except Exception as e:
        logger.error(f"❌ File validation failed: {str(e)}")
        return False

def get_file_metadata(s3_key: str) -> Optional[Dict[str, Any]]:
    """
    Get file metadata from S3
    
    Args:
        s3_key: S3 object key
        
    Returns:
        File metadata or None if not found
    """
    try:
        bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
        if not bucket_name:
            return None
        
        response = s3_client.head_object(Bucket=bucket_name, Key=s3_key)
        
        return {
            'file_size': response.get('ContentLength', 0),
            'content_type': response.get('ContentType', ''),
            'last_modified': response.get('LastModified', '').isoformat(),
            'metadata': response.get('Metadata', {})
        }
        
    except ClientError as e:
        if e.response['Error']['Code'] == '404':
            logger.warning(f"⚠️ File not found: {s3_key}")
        else:
            logger.error(f"❌ Failed to get file metadata: {str(e)}")
        return None
    except Exception as e:
        logger.error(f"❌ File metadata retrieval failed: {str(e)}")
        return None

def delete_file_from_s3(s3_key: str) -> bool:
    """
    Delete file from S3
    
    Args:
        s3_key: S3 object key
        
    Returns:
        True if successful, False otherwise
    """
    try:
        bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME')
        if not bucket_name:
            return False
        
        s3_client.delete_object(Bucket=bucket_name, Key=s3_key)
        logger.info(f"✅ File deleted from S3: {s3_key}")
        return True
        
    except ClientError as e:
        logger.error(f"❌ Failed to delete file from S3: {str(e)}")
        return False
    except Exception as e:
        logger.error(f"❌ File deletion failed: {str(e)}")
        return False
