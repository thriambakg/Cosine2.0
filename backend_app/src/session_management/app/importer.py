"""
Chat Session Importer
Helper class for importing chat sessions from .cosine files or share links
Handles decryption, S3 object upload, and DynamoDB insertion
"""

import json
import os
import logging
import boto3
import base64
import hashlib
import gzip
import uuid
import time
from datetime import datetime
from typing import Dict, Any, Optional
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
CONTEXT_ITEM_EXTENSION = '.cosine'

# Initialize AWS clients
s3_client = boto3.client('s3', config=boto3.session.Config(signature_version='s3v4'))
dynamodb = boto3.resource('dynamodb')


class ChatSessionImporter:
    """
    Imports chat sessions from encrypted .cosine files or share links
    Decrypts the data, uploads S3 objects, and writes to DynamoDB
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
    
    def encrypt_context_data(self, user_id: str, data: Dict[str, Any]) -> bytes:
        """Encrypt context data using Fernet with platform-wide key (shareable across all users)
        Falls back to user-specific keys for backward compatibility"""
        try:
            # Use platform-wide key for shareable items
            key = self.derive_platform_key()
            fernet = Fernet(key)
            json_data = json.dumps(data, default=str)
            encrypted_data = fernet.encrypt(json_data.encode('utf-8'))
            logger.info(f"✅ Encrypted context data with platform-wide key: {len(encrypted_data)} bytes")
            return encrypted_data
        except Exception as e:
            logger.error(f"❌ Error encrypting context data: {str(e)}")
            raise
    
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
    
    def decrypt_session_data(self, encrypted_data: bytes) -> Dict[str, Any]:
        """Decrypt session data using Fernet with platform-wide key (shareable across all users)"""
        try:
            key = self.derive_platform_key()
            fernet = Fernet(key)
            decrypted_compressed = fernet.decrypt(encrypted_data)
            # Decompress
            decrypted_data = gzip.decompress(decrypted_compressed)
            session_data = json.loads(decrypted_data.decode('utf-8'))
            logger.info(f"✅ Decrypted session data with platform-wide key: {len(encrypted_data)} bytes")
            return session_data
        except Exception as e:
            logger.error(f"❌ Error decrypting session data: {str(e)}")
            raise
    
    def upload_s3_objects(self, s3_objects_base64: Dict[str, str], importing_user_id: str, new_session_id: str) -> Dict[str, str]:
        """
        Upload S3 objects to new session location
        Maps old S3 keys to new S3 keys
        Handles filesystem items specially - re-encrypts and stores in filesystem location
        
        Args:
            s3_objects_base64: Dict mapping old S3 keys to base64-encoded file content
            importing_user_id: User ID of the user importing the session
            new_session_id: New session ID for the imported session
            
        Returns:
            Dict mapping old S3 keys to new S3 keys
        """
        try:
            s3_key_mapping = {}
            filesys_prefix_old = "users/"  # Will check if contains /filesys/
            filesys_prefix_new = f"users/{importing_user_id}/filesys/"
            
            for old_s3_key, content_base64 in s3_objects_base64.items():
                # Decode base64 content
                file_content = base64.b64decode(content_base64)
                
                # Check if this is a filesystem item
                is_filesystem_item = '/filesys/' in old_s3_key
                
                if is_filesystem_item:
                    # Handle filesystem items - re-encrypt and store in filesystem location
                    try:
                        # Extract folder path and filename from old S3 key
                        # Format: users/{old_user_id}/filesys/{folder_path}/{item_id}.cosine
                        parts = old_s3_key.split('/filesys/')
                        if len(parts) == 2:
                            folder_path_and_file = parts[1]
                            folder_parts = folder_path_and_file.split('/')
                            
                            if len(folder_parts) > 1:
                                # Has folder path
                                folder_path = '/'.join(folder_parts[:-1])
                                filename = folder_parts[-1]
                            else:
                                # Root folder
                                folder_path = ''
                                filename = folder_parts[0]
                            
                            # Check if this was decrypted during export (JSON string)
                            # or if it's still encrypted
                            try:
                                # Try to parse as JSON (means it was decrypted during export)
                                decrypted_data = json.loads(file_content.decode('utf-8'))
                                
                                # Re-encrypt with importing user's key (platform-wide for shareability)
                                encrypted_data = self.encrypt_context_data(importing_user_id, decrypted_data)
                                
                                # Generate new item ID and S3 key
                                item_id = str(uuid.uuid4())
                                if folder_path:
                                    new_s3_key = f"{filesys_prefix_new}{folder_path}/{item_id}{CONTEXT_ITEM_EXTENSION}"
                                else:
                                    new_s3_key = f"{filesys_prefix_new}{item_id}{CONTEXT_ITEM_EXTENSION}"
                                
                                # Upload encrypted file to filesystem
                                self.s3_client.put_object(
                                    Bucket=self.bucket_name,
                                    Key=new_s3_key,
                                    Body=encrypted_data,
                                    ContentType='application/octet-stream',
                                    Metadata={
                                        'user_id': importing_user_id,
                                        'imported_at': datetime.utcnow().isoformat(),
                                        'original_s3_key': old_s3_key,
                                    }
                                )
                                
                                s3_key_mapping[old_s3_key] = new_s3_key
                                logger.info(f"✅ Uploaded and re-encrypted filesystem item: {old_s3_key} -> {new_s3_key}")
                                
                            except (json.JSONDecodeError, UnicodeDecodeError):
                                # Still encrypted - re-encrypt with new user's key
                                # First decrypt with old key (try platform-wide, then user-specific)
                                try:
                                    # Try to decrypt (might fail if encrypted with different key)
                                    # For now, just upload as-is and let filesystem handle it
                                    item_id = str(uuid.uuid4())
                                    if folder_path:
                                        new_s3_key = f"{filesys_prefix_new}{folder_path}/{item_id}{CONTEXT_ITEM_EXTENSION}"
                                    else:
                                        new_s3_key = f"{filesys_prefix_new}{item_id}{CONTEXT_ITEM_EXTENSION}"
                                    
                                    # Upload encrypted file as-is (will be re-encrypted by filesystem if needed)
                                    self.s3_client.put_object(
                                        Bucket=self.bucket_name,
                                        Key=new_s3_key,
                                        Body=file_content,
                                        ContentType='application/octet-stream',
                                        Metadata={
                                            'user_id': importing_user_id,
                                            'imported_at': datetime.utcnow().isoformat(),
                                            'original_s3_key': old_s3_key,
                                        }
                                    )
                                    
                                    s3_key_mapping[old_s3_key] = new_s3_key
                                    logger.info(f"✅ Uploaded filesystem item (encrypted): {old_s3_key} -> {new_s3_key}")
                                except Exception as e:
                                    logger.warning(f"⚠️ Failed to process filesystem item {old_s3_key}: {str(e)}")
                    except Exception as e:
                        logger.warning(f"⚠️ Failed to upload filesystem item {old_s3_key}: {str(e)}")
                else:
                    # Regular session file - upload to session location
                    # Extract filename from old S3 key
                    # Old format: users/{old_user_id}/sessions/{old_session_id}/files/{filename}
                    # or: users/{old_user_id}/sessions/{old_session_id}/agent-files/{filename}
                    parts = old_s3_key.split('/')
                    if len(parts) >= 2:
                        filename = parts[-1]
                        folder = parts[-2] if len(parts) >= 2 else 'files'
                    else:
                        filename = old_s3_key.split('/')[-1]
                        folder = 'files'
                    
                    # Generate new S3 key
                    new_s3_key = f"users/{importing_user_id}/sessions/{new_session_id}/{folder}/{filename}"
                    
                    # Upload to S3
                    self.s3_client.put_object(
                        Bucket=self.bucket_name,
                        Key=new_s3_key,
                        Body=file_content,
                        ContentType='application/octet-stream',
                        Metadata={
                            'user_id': importing_user_id,
                            'session_id': new_session_id,
                            'filename': filename,
                            'imported_at': datetime.utcnow().isoformat(),
                        }
                    )
                    
                    s3_key_mapping[old_s3_key] = new_s3_key
                    logger.info(f"✅ Uploaded S3 object: {old_s3_key} -> {new_s3_key}")
            
            logger.info(f"✅ Uploaded {len(s3_key_mapping)} S3 objects for new session {new_session_id}")
            return s3_key_mapping
            
        except Exception as e:
            logger.error(f"❌ Error uploading S3 objects: {str(e)}")
            raise
    
    def update_session_variables_s3_keys(self, session_variables: Dict[str, Any], s3_key_mapping: Dict[str, str]) -> Dict[str, Any]:
        """
        Update S3 keys in session_variables to point to new locations
        Handles uploaded_files, agent_files, and context_items with filesystem references
        
        Args:
            session_variables: Original session_variables dict
            s3_key_mapping: Dict mapping old S3 keys to new S3 keys
            
        Returns:
            Updated session_variables dict
        """
        try:
            updated_vars = json.loads(json.dumps(session_variables))  # Deep copy
            
            # Update uploaded_files
            if 'uploaded_files' in updated_vars:
                for file_meta in updated_vars['uploaded_files']:
                    old_s3_key = file_meta.get('s3_key')
                    if old_s3_key and old_s3_key in s3_key_mapping:
                        new_s3_key = s3_key_mapping[old_s3_key]
                        file_meta['s3_key'] = new_s3_key
                        file_meta['s3_url'] = f"https://{self.bucket_name}.s3.amazonaws.com/{new_s3_key}"
                        logger.info(f"✅ Updated uploaded_file S3 key: {old_s3_key} -> {new_s3_key}")
            
            # Update agent_files
            if 'agent_files' in updated_vars:
                for file_meta in updated_vars['agent_files']:
                    old_s3_key = file_meta.get('s3_key')
                    if old_s3_key and old_s3_key in s3_key_mapping:
                        new_s3_key = s3_key_mapping[old_s3_key]
                        file_meta['s3_key'] = new_s3_key
                        file_meta['s3_url'] = f"https://{self.bucket_name}.s3.amazonaws.com/{new_s3_key}"
                        logger.info(f"✅ Updated agent_file S3 key: {old_s3_key} -> {new_s3_key}")
            
            # Update context_items with filesystem references
            if 'context_items' in updated_vars:
                for context_item in updated_vars['context_items']:
                    if isinstance(context_item, dict):
                        # Update direct s3_key reference
                        old_s3_key = context_item.get('s3_key') or context_item.get('data', {}).get('s3_key')
                        if old_s3_key and old_s3_key in s3_key_mapping:
                            new_s3_key = s3_key_mapping[old_s3_key]
                            if 's3_key' in context_item:
                                context_item['s3_key'] = new_s3_key
                            if 'data' in context_item and isinstance(context_item['data'], dict):
                                context_item['data']['s3_key'] = new_s3_key
                            logger.info(f"✅ Updated context_item S3 key: {old_s3_key} -> {new_s3_key}")
                        
                        # Update filesystem folder references (s3_keys array)
                        if context_item.get('data', {}).get('filesystem_type') == 'folder':
                            nested_keys = context_item.get('data', {}).get('s3_keys', [])
                            updated_keys = []
                            for nested_key in nested_keys:
                                if nested_key in s3_key_mapping:
                                    updated_keys.append(s3_key_mapping[nested_key])
                                    logger.info(f"✅ Updated folder context_item nested S3 key: {nested_key} -> {s3_key_mapping[nested_key]}")
                                else:
                                    updated_keys.append(nested_key)
                            if 'data' in context_item and isinstance(context_item['data'], dict):
                                context_item['data']['s3_keys'] = updated_keys
            
            return updated_vars
            
        except Exception as e:
            logger.error(f"❌ Error updating session_variables S3 keys: {str(e)}")
            raise
    
    def import_from_file(self, file_content: bytes, importing_user_id: str) -> Dict[str, Any]:
        """
        Import session from file content
        
        Args:
            file_content: The encrypted .cosine file content
            importing_user_id: User ID of the user importing the session
        
        Returns:
            Dict with 'success', 'session_id', 'session_data' or 'error'
        """
        try:
            # Decrypt using platform-wide key
            session_data = self.decrypt_session_data(file_content)
            
            # Validate session data structure
            if not self.validate_session_data(session_data):
                return {
                    'success': False,
                    'error': 'Invalid session data structure'
                }
            
            # Generate new session ID
            new_session_id = str(uuid.uuid4())
            
            # Upload S3 objects and get key mapping
            s3_objects_base64 = session_data.get('s3_objects', {})
            s3_key_mapping = self.upload_s3_objects(s3_objects_base64, importing_user_id, new_session_id)
            
            # Update session_variables with new S3 keys
            session_info = session_data.get('session', {})
            session_variables = session_info.get('session_variables', {})
            updated_session_variables = self.update_session_variables_s3_keys(session_variables, s3_key_mapping)
            
            # Prepare session item for DynamoDB
            timestamp = int(time.time())
            session_item = {
                'user_id': importing_user_id,
                'session_id': new_session_id,
                'title': session_info.get('title', 'Imported Chat'),
                'model': session_info.get('model', 'claude-sonnet-4'),
                'created_at': timestamp,
                'last_updated': timestamp,
                'message_count': len(session_info.get('messages', [])),
                'messages': session_info.get('messages', []),
                'session_variables': updated_session_variables,
                'expires_at': timestamp + (30 * 24 * 60 * 60)  # 30 days TTL
            }
            
            # Insert into DynamoDB
            self.dynamodb_table.put_item(Item=session_item)
            logger.info(f"✅ Imported session into DynamoDB: {new_session_id}")
            
            return {
                'success': True,
                'session_id': new_session_id,
                'session_data': {
                    'session_id': new_session_id,
                    'title': session_item['title'],
                    'model': session_item['model'],
                    'created_at': session_item['created_at'],
                    'message_count': session_item['message_count'],
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Error importing session from file: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': f'Failed to import session: {str(e)}'
            }
    
    def import_from_share_link(self, share_id: str, importing_user_id: str) -> Dict[str, Any]:
        """
        Import session from share link (share_id)
        
        Args:
            share_id: The share ID from the share link
            importing_user_id: User ID of the user importing the session
        
        Returns:
            Dict with 'success', 'session_id', 'session_data' or 'error'
        """
        try:
            s3_key = f"shared/chat-sessions/{share_id}{CONTEXT_ITEM_EXTENSION}"
            
            # Get object from S3
            try:
                response = self.s3_client.get_object(
                    Bucket=self.bucket_name,
                    Key=s3_key
                )
            except self.s3_client.exceptions.NoSuchKey:
                return {
                    'success': False,
                    'error': 'Share link not found or expired'
                }
            
            encrypted_data = response['Body'].read()
            metadata = response.get('Metadata', {})
            original_user_id = metadata.get('user_id')
            
            if not original_user_id:
                return {
                    'success': False,
                    'error': 'Cannot decrypt: Missing user_id in metadata'
                }
            
            # Decrypt using platform-wide key
            session_data = self.decrypt_session_data(encrypted_data)
            
            # Validate session data structure
            if not self.validate_session_data(session_data):
                return {
                    'success': False,
                    'error': 'Invalid session data structure'
                }
            
            # Generate new session ID
            new_session_id = str(uuid.uuid4())
            
            # Upload S3 objects and get key mapping
            s3_objects_base64 = session_data.get('s3_objects', {})
            s3_key_mapping = self.upload_s3_objects(s3_objects_base64, importing_user_id, new_session_id)
            
            # Update session_variables with new S3 keys
            session_info = session_data.get('session', {})
            session_variables = session_info.get('session_variables', {})
            updated_session_variables = self.update_session_variables_s3_keys(session_variables, s3_key_mapping)
            
            # Prepare session item for DynamoDB
            timestamp = int(time.time())
            session_item = {
                'user_id': importing_user_id,
                'session_id': new_session_id,
                'title': session_info.get('title', 'Imported Chat'),
                'model': session_info.get('model', 'claude-sonnet-4'),
                'created_at': timestamp,
                'last_updated': timestamp,
                'message_count': len(session_info.get('messages', [])),
                'messages': session_info.get('messages', []),
                'session_variables': updated_session_variables,
                'expires_at': timestamp + (30 * 24 * 60 * 60)  # 30 days TTL
            }
            
            # Insert into DynamoDB
            self.dynamodb_table.put_item(Item=session_item)
            logger.info(f"✅ Imported session into DynamoDB from share link: {new_session_id}")
            
            return {
                'success': True,
                'session_id': new_session_id,
                'session_data': {
                    'session_id': new_session_id,
                    'title': session_item['title'],
                    'model': session_item['model'],
                    'created_at': session_item['created_at'],
                    'message_count': session_item['message_count'],
                },
                'metadata': metadata
            }
            
        except Exception as e:
            logger.error(f"❌ Error importing session from share link: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': f'Failed to import session from share link: {str(e)}'
            }
    
    def validate_session_data(self, session_data: Dict[str, Any]) -> bool:
        """
        Validate that the session data has the correct structure
        
        Args:
            session_data: The decrypted session data
        
        Returns:
            True if valid, False otherwise
        """
        try:
            # Check for required top-level fields
            if not isinstance(session_data, dict):
                return False
            
            if session_data.get('type') != 'chat_session':
                logger.warning(f"Session type is not 'chat_session': {session_data.get('type')}")
                # Allow it to continue - might be from older version
            
            # Check for session data
            session_info = session_data.get('session')
            if not session_info:
                logger.error("Missing 'session' field in session data")
                return False
            
            # Validate session structure
            if not isinstance(session_info, dict):
                return False
            
            # Session should have at least a title
            if 'title' not in session_info:
                logger.warning("Missing 'title' field in session data, will use default")
            
            # Messages should be a list (can be empty)
            if 'messages' not in session_info:
                session_info['messages'] = []
            
            if not isinstance(session_info.get('messages'), list):
                return False
            
            # s3_objects should be a dict (can be empty)
            if 's3_objects' not in session_data:
                session_data['s3_objects'] = {}
            
            if not isinstance(session_data.get('s3_objects'), dict):
                return False
            
            return True
            
        except Exception as e:
            logger.error(f"Error validating session data: {str(e)}")
            return False

