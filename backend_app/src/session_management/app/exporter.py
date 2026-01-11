"""
Chat Session Exporter
Helper class for exporting chat sessions to .cs files
Handles both download (presigned URL) and share link functionality
Exports all DynamoDB data and associated S3 objects (files, agent files)
"""

import json
import os
import uuid
import logging
import boto3
import base64
import hashlib
import gzip
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger(__name__)

# Environment variables
ENCRYPTION_SECRET = os.environ.get('ENCRYPTION_SECRET', 'default-secret-change-in-production')
CHAT_FILES_BUCKET_NAME = os.environ.get('CHAT_FILES_BUCKET_NAME', 'cosine-chat-files-production')
CHAT_SESSIONS_TABLE_NAME = os.environ.get('CHAT_SESSIONS_TABLE_NAME', 'cosine-chat-sessions-production')
CONTEXT_ITEM_EXTENSION = '.cs'

# Initialize AWS clients
s3_client = boto3.client('s3', config=boto3.session.Config(signature_version='s3v4'))
dynamodb = boto3.resource('dynamodb')


class ChatSessionExporter:
    """
    Exports chat sessions to encrypted .cs files
    Supports both direct download (presigned URL) and share links
    Exports all DynamoDB data and associated S3 objects
    """
    
    def __init__(self):
        self.s3_client = s3_client
        self.bucket_name = CHAT_FILES_BUCKET_NAME
        self.encryption_secret = ENCRYPTION_SECRET
        self.dynamodb_table = dynamodb.Table(CHAT_SESSIONS_TABLE_NAME)
    
    def derive_platform_key(self) -> bytes:
        """Derive platform-wide encryption key from ENCRYPTION_SECRET (not user-specific)
        This allows chat sessions to be shared across all users in the platform"""
        salt = hashlib.sha256(f"{self.encryption_secret}platform-wide".encode()).digest()[:16]
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(f"platform-wide{self.encryption_secret}".encode()))
        return key
    
    def derive_key_from_user_id(self, user_id: str) -> bytes:
        """Derive encryption key from user ID using PBKDF2 (for filesystem items)"""
        salt = hashlib.sha256(f"{self.encryption_secret}{user_id}".encode()).digest()[:16]
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(f"{user_id}{self.encryption_secret}".encode()))
        return key
    
    def decrypt_context_data(self, user_id: str, encrypted_data: bytes) -> Dict[str, Any]:
        """Decrypt context data using Fernet with platform-wide key (shareable across all users)
        Falls back to user-specific keys for backward compatibility with old files"""
        from cryptography.fernet import InvalidToken
        
        # Try platform-wide key first (new format - shareable)
        try:
            logger.debug(f"🔐 Starting decryption with platform-wide key, data length: {len(encrypted_data)} bytes")
            key = self.derive_platform_key()
            fernet = Fernet(key)
            decrypted_data = fernet.decrypt(encrypted_data)
            json_data = json.loads(decrypted_data.decode('utf-8'))
            logger.debug(f"🔐 Successfully decrypted with platform-wide key")
            return json_data
        except InvalidToken:
            logger.debug(f"⚠️ Platform-wide key failed, trying user-specific key for backward compatibility...")
            # Fallback: Try with user-specific key (for backward compatibility with old files)
            try:
                key = self.derive_key_from_user_id(user_id)
                fernet = Fernet(key)
                decrypted_data = fernet.decrypt(encrypted_data)
                json_data = json.loads(decrypted_data.decode('utf-8'))
                logger.debug(f"🔐 Successfully decrypted with user-specific key (backward compatibility)")
                return json_data
            except Exception as e:
                logger.error(f"❌ Error decrypting context data with all methods: {str(e)}")
                raise
    
    def encrypt_session_data(self, session_data: Dict[str, Any]) -> bytes:
        """Encrypt session data using Fernet with platform-wide key (shareable across all users)"""
        try:
            key = self.derive_platform_key()
            fernet = Fernet(key)
            json_data = json.dumps(session_data, default=str)
            # Compress before encryption
            compressed_data = gzip.compress(json_data.encode('utf-8'))
            encrypted_data = fernet.encrypt(compressed_data)
            logger.info(f"✅ Encrypted session data with platform-wide key: {len(encrypted_data)} bytes")
            return encrypted_data
        except Exception as e:
            logger.error(f"❌ Error encrypting session data: {str(e)}")
            raise
    
    def get_filesystem_items_for_session(self, user_id: str, session_id: str) -> Dict[str, bytes]:
        """
        Get all filesystem items referenced in the session's context_items
        Downloads and decrypts .cs files from filesystem
        
        Args:
            user_id: User ID
            session_id: Session ID
            
        Returns:
            Dict mapping S3 keys to decrypted file content (bytes)
        """
        try:
            # Get session from DynamoDB
            response = self.dynamodb_table.get_item(
                Key={'user_id': user_id, 'session_id': session_id}
            )
            
            if 'Item' not in response:
                logger.warning(f"Session not found: {session_id}")
                return {}
            
            session_variables = response['Item'].get('session_variables', {})
            context_items = session_variables.get('context_items', [])
            
            filesystem_items = {}
            filesys_prefix = f"users/{user_id}/filesys/"
            
            # Check context_items for filesystem references
            for context_item in context_items:
                # Check if context item references a filesystem item
                s3_key = None
                
                # Check for direct s3_key reference
                if isinstance(context_item, dict):
                    s3_key = context_item.get('s3_key') or context_item.get('data', {}).get('s3_key')
                    
                    # Also check for filesystem folder references
                    if not s3_key and context_item.get('data', {}).get('filesystem_type') == 'folder':
                        # Folder reference - get all nested S3 keys
                        nested_keys = context_item.get('data', {}).get('s3_keys', [])
                        for nested_key in nested_keys:
                            if nested_key.startswith(filesys_prefix):
                                try:
                                    obj_response = self.s3_client.get_object(
                                        Bucket=self.bucket_name,
                                        Key=nested_key
                                    )
                                    file_content = obj_response['Body'].read()
                                    
                                    # Decrypt if it's a .cs file
                                    if nested_key.endswith(CONTEXT_ITEM_EXTENSION):
                                        try:
                                            decrypted_data = self.decrypt_context_data(user_id, file_content)
                                            # Store as JSON string for export
                                            filesystem_items[nested_key] = json.dumps(decrypted_data).encode('utf-8')
                                            logger.info(f"✅ Downloaded and decrypted filesystem item: {nested_key}")
                                        except Exception as e:
                                            logger.warning(f"⚠️ Failed to decrypt filesystem item {nested_key}: {str(e)}")
                                            # Store encrypted version as fallback
                                            filesystem_items[nested_key] = file_content
                                    else:
                                        # Regular file - store as-is
                                        filesystem_items[nested_key] = file_content
                                        logger.info(f"✅ Downloaded filesystem file: {nested_key}")
                                except Exception as e:
                                    logger.warning(f"⚠️ Failed to download filesystem item {nested_key}: {str(e)}")
                
                # Download individual filesystem item
                if s3_key and s3_key.startswith(filesys_prefix):
                    try:
                        obj_response = self.s3_client.get_object(
                            Bucket=self.bucket_name,
                            Key=s3_key
                        )
                        file_content = obj_response['Body'].read()
                        
                        # Decrypt if it's a .cs file
                        if s3_key.endswith(CONTEXT_ITEM_EXTENSION):
                            try:
                                decrypted_data = self.decrypt_context_data(user_id, file_content)
                                # Store as JSON string for export
                                filesystem_items[s3_key] = json.dumps(decrypted_data).encode('utf-8')
                                logger.info(f"✅ Downloaded and decrypted filesystem item: {s3_key}")
                            except Exception as e:
                                logger.warning(f"⚠️ Failed to decrypt filesystem item {s3_key}: {str(e)}")
                                # Store encrypted version as fallback
                                filesystem_items[s3_key] = file_content
                        else:
                            # Regular file - store as-is
                            filesystem_items[s3_key] = file_content
                            logger.info(f"✅ Downloaded filesystem file: {s3_key}")
                    except ClientError as e:
                        if e.response['Error']['Code'] == 'NoSuchKey':
                            logger.warning(f"⚠️ Filesystem item not found: {s3_key}")
                        else:
                            logger.warning(f"⚠️ Failed to download filesystem item {s3_key}: {str(e)}")
                    except Exception as e:
                        logger.warning(f"⚠️ Failed to download filesystem item {s3_key}: {str(e)}")
            
            logger.info(f"✅ Retrieved {len(filesystem_items)} filesystem items for session {session_id}")
            return filesystem_items
            
        except Exception as e:
            logger.error(f"❌ Error getting filesystem items for session: {str(e)}")
            return {}
    
    def get_s3_objects_for_session(self, user_id: str, session_id: str) -> Dict[str, bytes]:
        """
        Get all S3 objects associated with a session
        Includes uploaded_files, agent_files, and filesystem items from session_variables
        
        Args:
            user_id: User ID
            session_id: Session ID
            
        Returns:
            Dict mapping S3 keys to file content (bytes)
        """
        try:
            # Get session from DynamoDB
            response = self.dynamodb_table.get_item(
                Key={'user_id': user_id, 'session_id': session_id}
            )
            
            if 'Item' not in response:
                logger.warning(f"Session not found: {session_id}")
                return {}
            
            session_variables = response['Item'].get('session_variables', {})
            uploaded_files = session_variables.get('uploaded_files', [])
            agent_files = session_variables.get('agent_files', [])
            
            s3_objects = {}
            
            # Download uploaded files
            for file_meta in uploaded_files:
                s3_key = file_meta.get('s3_key')
                if s3_key:
                    try:
                        obj_response = self.s3_client.get_object(
                            Bucket=self.bucket_name,
                            Key=s3_key
                        )
                        s3_objects[s3_key] = obj_response['Body'].read()
                        logger.info(f"✅ Downloaded uploaded file: {s3_key}")
                    except Exception as e:
                        logger.warning(f"⚠️ Failed to download uploaded file {s3_key}: {str(e)}")
            
            # Download agent files
            for file_meta in agent_files:
                s3_key = file_meta.get('s3_key')
                if s3_key:
                    try:
                        obj_response = self.s3_client.get_object(
                            Bucket=self.bucket_name,
                            Key=s3_key
                        )
                        s3_objects[s3_key] = obj_response['Body'].read()
                        logger.info(f"✅ Downloaded agent file: {s3_key}")
                    except Exception as e:
                        logger.warning(f"⚠️ Failed to download agent file {s3_key}: {str(e)}")
            
            # Get filesystem items (decrypted)
            filesystem_items = self.get_filesystem_items_for_session(user_id, session_id)
            s3_objects.update(filesystem_items)
            
            logger.info(f"✅ Retrieved {len(s3_objects)} S3 objects for session {session_id} ({len(filesystem_items)} from filesystem)")
            return s3_objects
            
        except Exception as e:
            logger.error(f"❌ Error getting S3 objects for session: {str(e)}")
            return {}
    
    def prepare_session_data(self, user_id: str, session_id: str) -> Dict[str, Any]:
        """
        Prepare session data for export
        Gets all DynamoDB data and S3 objects
        
        Args:
            user_id: User ID
            session_id: Session ID
            
        Returns:
            Dict with session data and S3 objects
        """
        try:
            # Get session from DynamoDB
            response = self.dynamodb_table.get_item(
                Key={'user_id': user_id, 'session_id': session_id}
            )
            
            if 'Item' not in response:
                raise ValueError(f"Session not found: {session_id}")
            
            session_item = response['Item']
            
            # Get all S3 objects associated with the session
            s3_objects = self.get_s3_objects_for_session(user_id, session_id)
            
            # Convert S3 objects to base64 for JSON serialization
            s3_objects_base64 = {}
            for s3_key, content in s3_objects.items():
                s3_objects_base64[s3_key] = base64.b64encode(content).decode('utf-8')
            
            # Prepare export data (exclude user_id for portability)
            session_data = {
                'type': 'chat_session',
                'version': '1.0',
                'session': {
                    'session_id': session_item.get('session_id'),
                    'title': session_item.get('title'),
                    'model': session_item.get('model'),
                    'created_at': session_item.get('created_at'),
                    'last_updated': session_item.get('last_updated'),
                    'message_count': session_item.get('message_count', 0),
                    'messages': session_item.get('messages', []),
                    'session_variables': session_item.get('session_variables', {}),
                },
                's3_objects': s3_objects_base64,  # Base64 encoded file contents
                'exported_at': datetime.utcnow().isoformat(),
                'exported_by': user_id,
            }
            
            logger.info(f"✅ Prepared session data for export: {len(session_data['session']['messages'])} messages, {len(s3_objects)} files")
            return session_data
            
        except Exception as e:
            logger.error(f"❌ Error preparing session data: {str(e)}")
            raise
    
    def export_for_download(self, user_id: str, session_id: str, session_title: str) -> Dict[str, Any]:
        """
        Export session for direct download
        Returns presigned URL for the encrypted .cs file
        
        Args:
            user_id: User ID
            session_id: Session ID
            session_title: Title of the session (for filename)
            
        Returns:
            Dict with 'success', 'share_id', 'download_url', 'expires_in'
        """
        try:
            # Generate unique share ID
            share_id = str(uuid.uuid4())
            
            # Prepare and encrypt session data
            session_data = self.prepare_session_data(user_id, session_id)
            encrypted_data = self.encrypt_session_data(session_data)
            
            # Store in S3
            s3_key = f"shared/chat-sessions/{share_id}{CONTEXT_ITEM_EXTENSION}"
            filename = f"{session_title or 'chat-session'}{CONTEXT_ITEM_EXTENSION}"
            
            # Calculate expiration date (48 hours for downloads)
            expiration_date = datetime.utcnow() + timedelta(hours=48)
            
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=encrypted_data,
                ContentType='application/octet-stream',
                Metadata={
                    'user_id': user_id,
                    'session_id': session_id,
                    'session_title': session_title or 'Untitled',
                    'created_at': datetime.utcnow().isoformat(),
                    'export_type': 'download',
                    'expires_at': expiration_date.isoformat(),
                }
            )
            logger.info(f"✅ Stored session export in S3: {s3_key}")
            
            # Generate presigned URL (valid for 1 hour)
            download_url = self.s3_client.generate_presigned_url(
                'get_object',
                Params={
                    'Bucket': self.bucket_name,
                    'Key': s3_key,
                    'ResponseContentDisposition': f'attachment; filename="{filename}"'
                },
                ExpiresIn=3600  # 1 hour
            )
            
            logger.info(f"✅ Generated presigned URL for download: {share_id}")
            
            return {
                'success': True,
                'share_id': share_id,
                'download_url': download_url,
                'expires_in': 3600,
            }
            
        except Exception as e:
            logger.error(f"❌ Error exporting session for download: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': f'Failed to export session: {str(e)}'
            }
    
    def export_for_share_link(self, user_id: str, session_id: str) -> Dict[str, Any]:
        """
        Export session for share link
        Stores encrypted file in S3 and returns share_id for link generation
        
        Args:
            user_id: User ID
            session_id: Session ID
            
        Returns:
            Dict with 'success', 'share_id'
        """
        try:
            # Generate unique share ID
            share_id = str(uuid.uuid4())
            
            # Get session title for metadata
            response = self.dynamodb_table.get_item(
                Key={'user_id': user_id, 'session_id': session_id}
            )
            session_title = response.get('Item', {}).get('title', 'Untitled') if 'Item' in response else 'Untitled'
            
            # Prepare and encrypt session data
            session_data = self.prepare_session_data(user_id, session_id)
            encrypted_data = self.encrypt_session_data(session_data)
            
            # Store in S3
            s3_key = f"shared/chat-sessions/{share_id}{CONTEXT_ITEM_EXTENSION}"
            
            # Calculate expiration date (7 days for share links)
            expiration_date = datetime.utcnow() + timedelta(days=7)
            
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=encrypted_data,
                ContentType='application/octet-stream',
                Metadata={
                    'user_id': user_id,
                    'session_id': session_id,
                    'session_title': session_title,
                    'created_at': datetime.utcnow().isoformat(),
                    'export_type': 'share_link',
                    'expires_at': expiration_date.isoformat(),
                }
            )
            logger.info(f"✅ Stored session export in S3 for sharing: {s3_key}")
            
            return {
                'success': True,
                'share_id': share_id,
            }
            
        except Exception as e:
            logger.error(f"❌ Error exporting session for share link: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': f'Failed to export session: {str(e)}'
            }
    
    def get_shared_session(self, share_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Retrieve and decrypt a shared session
        Used when someone accesses a share link
        
        Args:
            share_id: The share ID from the URL
            user_id: Optional user ID (not used for decryption, kept for compatibility)
        
        Returns:
            Dict with 'success', 'session_data' or 'error'
        """
        try:
            s3_key = f"shared/chat-sessions/{share_id}{CONTEXT_ITEM_EXTENSION}"
            
            # Get object from S3
            response = self.s3_client.get_object(
                Bucket=self.bucket_name,
                Key=s3_key
            )
            
            encrypted_data = response['Body'].read()
            metadata = response.get('Metadata', {})
            original_user_id = metadata.get('user_id')
            
            if not original_user_id:
                return {
                    'success': False,
                    'error': 'Cannot decrypt: Missing user_id in metadata'
                }
            
            # Decrypt using platform-wide key
            key = self.derive_platform_key()
            fernet = Fernet(key)
            decrypted_compressed = fernet.decrypt(encrypted_data)
            # Decompress
            decrypted_data = gzip.decompress(decrypted_compressed)
            session_data = json.loads(decrypted_data.decode('utf-8'))
            
            logger.info(f"✅ Retrieved and decrypted shared session with platform-wide key: {share_id}")
            
            return {
                'success': True,
                'session_data': session_data,
                'metadata': metadata,
            }
            
        except Exception as e:
            logger.error(f"❌ Error retrieving shared session: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': f'Failed to retrieve shared session: {str(e)}'
            }

