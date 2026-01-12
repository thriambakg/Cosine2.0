"""
AWS Lambda function for managing user file system (Dropbox-like storage)
S3-only implementation - all metadata stored in S3 manifest files
Handles adding/deleting files, creating/deleting folders, moving items, etc.
"""

import json
import os
import logging
import boto3
import uuid
import base64
import hashlib
import zipfile
import io
from typing import Dict, Any, Optional, List
from botocore.exceptions import ClientError
from datetime import datetime
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
import sys
from cors_helper import get_cors_headers, validate_origin


# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO'))

# Initialize AWS clients
s3_client = boto3.client('s3')

# Environment variables
CHAT_FILES_BUCKET_NAME = os.environ.get('CHAT_FILES_BUCKET_NAME')
S3_BASE_URL = os.environ.get('S3_BASE_URL', 'https://cosine-chat-files-production.s3.amazonaws.com')

# Manifest file name
MANIFEST_FILE = '.manifest.json'

# Context item encryption constants
CONTEXT_ITEM_EXTENSION = '.cosine'
CONTEXT_ITEM_MIME_TYPE = 'application/octet-stream'
ENCRYPTION_SECRET = os.environ.get('ENCRYPTION_SECRET', 'default-secret-change-in-production')  # Should be set via environment variable

def derive_platform_key() -> bytes:
    """Derive platform-wide encryption key from ENCRYPTION_SECRET (not user-specific)
    This allows .cosine files to be shared across all users in the platform"""
    salt = hashlib.sha256(f"{ENCRYPTION_SECRET}platform-wide".encode()).digest()[:16]
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(f"platform-wide{ENCRYPTION_SECRET}".encode()))
    return key

def derive_key_from_user_id(user_id: str) -> bytes:
    """Derive encryption key from user ID using PBKDF2 (legacy - kept for backward compatibility)"""
    salt = hashlib.sha256(f"{ENCRYPTION_SECRET}{user_id}".encode()).digest()[:16]
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(f"{user_id}{ENCRYPTION_SECRET}".encode()))
    return key

def encrypt_context_data(user_id: str, data: Dict[str, Any]) -> bytes:
    """Encrypt context data using Fernet with platform-wide key (shareable across all users)"""
    try:
        logger.debug(f"🔐 Starting encryption with platform-wide key")
        # Use platform-wide key for shareable .cosine files
        key = derive_platform_key()
        logger.debug(f"🔐 Derived platform encryption key (length: {len(key)})")
        fernet = Fernet(key)
        json_data = json.dumps(data, default=str)
        logger.debug(f"🔐 JSON data size: {len(json_data)} bytes")
        encrypted_data = fernet.encrypt(json_data.encode('utf-8'))
        logger.debug(f"🔐 Encrypted data size: {len(encrypted_data)} bytes")
        return encrypted_data
    except Exception as e:
        logger.error(f"❌ Error encrypting context data: {str(e)}")
        import traceback
        logger.error(f"❌ Encryption traceback: {traceback.format_exc()}")
        raise

def decrypt_context_data(user_id: str, encrypted_data: bytes) -> Dict[str, Any]:
    """Decrypt context data using Fernet with platform-wide key (shareable across all users)
    Falls back to user-specific keys for backward compatibility with old files"""
    from cryptography.fernet import InvalidToken
    
    # Try platform-wide key first (new format - shareable)
    try:
        logger.debug(f"🔐 Starting decryption with platform-wide key, data length: {len(encrypted_data)} bytes")
        key = derive_platform_key()
        fernet = Fernet(key)
        decrypted_data = fernet.decrypt(encrypted_data)
        json_data = json.loads(decrypted_data.decode('utf-8'))
        logger.debug(f"🔐 Successfully decrypted with platform-wide key")
        return json_data
    except InvalidToken:
        logger.debug(f"⚠️ Platform-wide key failed, trying user-specific key for backward compatibility...")
        # Fallback: Try with user-specific key (for backward compatibility with old files)
        try:
            key = derive_key_from_user_id(user_id)
            fernet = Fernet(key)
            decrypted_data = fernet.decrypt(encrypted_data)
            json_data = json.loads(decrypted_data.decode('utf-8'))
            logger.debug(f"🔐 Successfully decrypted with user-specific key (backward compatibility)")
            return json_data
        except Exception as e:
            logger.error(f"❌ Error decrypting context data with all methods: {str(e)}")
            raise

def build_cors_headers(origin: str = None):
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        **get_cors_headers(origin),
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'POST,OPTIONS,GET,PUT,DELETE'
    }

def validate_user_identity(event: Dict[str, Any]) -> Optional[str]:
    """Extract and validate the authenticated user ID from the request"""
    try:
        # Option 1: From API Gateway authorizer context
        if 'requestContext' in event and 'authorizer' in event['requestContext']:
            user_id = event['requestContext']['authorizer'].get('user_id')
            if user_id:
                return user_id
        
        # Option 2: From API Gateway request context
        if 'requestContext' in event and 'authorizer' in event['requestContext']:
            claims = event['requestContext']['authorizer'].get('claims', {})
            user_id = claims.get('sub') or claims.get('user_id')
            if user_id:
                return user_id
        
        # Option 3: From body (for direct Lambda invocation)
        if 'body' in event:
            body = json.loads(event.get('body', '{}')) if isinstance(event.get('body'), str) else event.get('body', {})
            user_id = body.get('user_id')
            if user_id:
                return user_id
        
        logger.warning("No user ID found in request")
        return None
    except Exception as e:
        logger.error(f"Error validating user identity: {str(e)}")
        return None

def validate_s3_key(user_id: str, s3_key: str) -> bool:
    """Validate that S3 key is within user's filesys directory"""
    expected_prefix = f"users/{user_id}/filesys/"
    return s3_key.startswith(expected_prefix)

def get_manifest_key(user_id: str, folder_path: str = '') -> str:
    """Get S3 key for manifest file in a folder"""
    if folder_path:
        return f"users/{user_id}/filesys/{folder_path}/{MANIFEST_FILE}"
    return f"users/{user_id}/filesys/{MANIFEST_FILE}"

def get_folder_manifest(user_id: str, folder_path: str = '') -> Dict[str, Any]:
    """Get manifest for a folder from S3"""
    try:
        manifest_key = get_manifest_key(user_id, folder_path)
        response = s3_client.get_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=manifest_key)
        manifest_data = json.loads(response['Body'].read().decode('utf-8'))
        return manifest_data
    except ClientError as e:
        if e.response['Error']['Code'] == 'NoSuchKey':
            # Return empty manifest for new folder
            return {
                'folder_id': str(uuid.uuid4()),
                'name': 'Root' if not folder_path else os.path.basename(folder_path.rstrip('/')),
                'parent_path': os.path.dirname(folder_path).rstrip('/') if folder_path else None,
                'path': folder_path,
                'created_at': int(datetime.now().timestamp()),
                'updated_at': int(datetime.now().timestamp()),
                'folders': {},
                'items': {}
            }
        raise

def save_folder_manifest(user_id: str, folder_path: str, manifest: Dict[str, Any]) -> bool:
    """Save manifest for a folder to S3"""
    try:
        manifest_key = get_manifest_key(user_id, folder_path)
        manifest['updated_at'] = int(datetime.now().timestamp())
        manifest_json = json.dumps(manifest, default=str)
        s3_client.put_object(
            Bucket=CHAT_FILES_BUCKET_NAME,
            Key=manifest_key,
            Body=manifest_json.encode('utf-8'),
            ContentType='application/json'
        )
        return True
    except Exception as e:
        logger.error(f"Error saving manifest: {str(e)}")
        raise

def get_parent_manifest(user_id: str, folder_path: str) -> Optional[Dict[str, Any]]:
    """Get parent folder's manifest"""
    if not folder_path:
        return None
    parent_path = os.path.dirname(folder_path).rstrip('/')
    if not parent_path:
        return get_folder_manifest(user_id, '')
    return get_folder_manifest(user_id, parent_path)

def add_file_upload(user_id: str, folder_path: str, file_content: bytes, filename: str, title: Optional[str] = None, description: Optional[str] = None) -> Dict[str, Any]:
    """Add an uploaded file to the filesystem"""
    try:
        # Get folder manifest
        manifest = get_folder_manifest(user_id, folder_path)
        
        # Generate file ID and S3 key
        file_id = str(uuid.uuid4())
        file_extension = os.path.splitext(filename)[1] or ''
        display_name = title or filename
        s3_key = f"users/{user_id}/filesys/{folder_path}/{file_id}{file_extension}" if folder_path else f"users/{user_id}/filesys/{file_id}{file_extension}"
        
        # All user-uploaded files are stored as-is (no encryption/decryption)
        # This includes .cosine files - they are stored exactly as uploaded
        # Only context items created from the website (via add_context_item) are encrypted
        
        # Determine content type based on file extension
        content_type = 'application/octet-stream'
        if file_extension.lower() == '.json':
            content_type = 'application/json'
        elif file_extension.lower() == CONTEXT_ITEM_EXTENSION:
            # .cosine files uploaded by users are stored as-is
            content_type = CONTEXT_ITEM_MIME_TYPE
        elif file_extension.lower() in ['.png', '.jpg', '.jpeg', '.gif']:
            content_type = f'image/{file_extension[1:].lower()}'
        elif file_extension.lower() == '.pdf':
            content_type = 'application/pdf'
        elif file_extension.lower() in ['.txt', '.md']:
            content_type = 'text/plain'
        
        # All uploaded files are 'uploaded_file' type (not context_item)
        # Context items are only created via add_context_item operation
        item_type = 'uploaded_file'
        
        # Upload file to S3
        s3_client.put_object(
            Bucket=CHAT_FILES_BUCKET_NAME,
            Key=s3_key,
            Body=file_content,
            ContentType=content_type
        )
        
        # Get file size
        response = s3_client.head_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=s3_key)
        file_size = response.get('ContentLength', 0)
        
        # Add to manifest
        item_data = {
            'id': file_id,
            'name': display_name,
            'type': item_type,
            's3_key': s3_key,
            'filename': filename,
            'metadata': {
                'file_size': file_size,
                'content_type': content_type,
                'description': description,
                'original_filename': filename,
            },
            'created_at': int(datetime.now().timestamp()),
            'updated_at': int(datetime.now().timestamp())
        }
        
        manifest['items'][file_id] = item_data
        save_folder_manifest(user_id, folder_path, manifest)
        
        return item_data
    except Exception as e:
        logger.error(f"Error adding file: {str(e)}")
        raise

def add_context_item(user_id: str, folder_path: str, context_data: Dict[str, Any], title: str, item_type: str = 'context_item') -> Dict[str, Any]:
    """Add a context item (full JSON object) to the filesystem - encrypted and saved as .cosine file"""
    try:
        logger.info(f"🔐 Adding context item: user_id={user_id}, item_type={item_type}, title={title}")
        
        # Get folder manifest
        manifest = get_folder_manifest(user_id, folder_path)
        
        # Generate item ID and S3 key (using .cosine extension for encrypted context items)
        item_id = str(uuid.uuid4())
        s3_key = f"users/{user_id}/filesys/{folder_path}/{item_id}{CONTEXT_ITEM_EXTENSION}" if folder_path else f"users/{user_id}/filesys/{item_id}{CONTEXT_ITEM_EXTENSION}"
        
        logger.info(f"🔐 Generated S3 key with .cosine extension: {s3_key}")
        
        # Encrypt and store context data
        logger.info(f"🔐 Encrypting context data for user {user_id}...")
        encrypted_data = encrypt_context_data(user_id, context_data)
        logger.info(f"🔐 Encryption successful, encrypted data size: {len(encrypted_data)} bytes")
        
        s3_client.put_object(
            Bucket=CHAT_FILES_BUCKET_NAME,
            Key=s3_key,
            Body=encrypted_data,
            ContentType=CONTEXT_ITEM_MIME_TYPE
        )
        logger.info(f"✅ Successfully saved encrypted context item to S3: {s3_key}")
        
        # Add to manifest
        item_data = {
            'id': item_id,
            'name': title,
            'type': item_type,  # 'context_item', 'tile', etc.
            's3_key': s3_key,
            'metadata': {
                'context_type': item_type,
                'data_keys': list(context_data.keys()) if isinstance(context_data, dict) else [],
            },
            'created_at': int(datetime.now().timestamp()),
            'updated_at': int(datetime.now().timestamp())
        }
        
        manifest['items'][item_id] = item_data
        save_folder_manifest(user_id, folder_path, manifest)
        
        return item_data
    except Exception as e:
        logger.error(f"Error adding context item: {str(e)}")
        raise

def add_bulk_context_items(user_id: str, folder_path: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Add multiple context items to the filesystem in a single operation - more efficient than sequential calls"""
    try:
        logger.info(f"🔐 Adding {len(items)} context items in bulk: user_id={user_id}, folder_path={folder_path}")
        
        # Get folder manifest once (shared for all items)
        manifest = get_folder_manifest(user_id, folder_path)
        
        results = []
        errors = []
        
        # Process all items
        for idx, item in enumerate(items):
            try:
                context_data = item.get('context_data', {})
                title = item.get('title', 'Untitled')
                item_type = item.get('item_type', 'context_item')
                
                # Generate item ID and S3 key
                item_id = str(uuid.uuid4())
                s3_key = f"users/{user_id}/filesys/{folder_path}/{item_id}{CONTEXT_ITEM_EXTENSION}" if folder_path else f"users/{user_id}/filesys/{item_id}{CONTEXT_ITEM_EXTENSION}"
                
                # Encrypt and store context data
                encrypted_data = encrypt_context_data(user_id, context_data)
                
                # Upload to S3
                s3_client.put_object(
                    Bucket=CHAT_FILES_BUCKET_NAME,
                    Key=s3_key,
                    Body=encrypted_data,
                    ContentType=CONTEXT_ITEM_MIME_TYPE
                )
                
                # Add to manifest
                item_data = {
                    'id': item_id,
                    'name': title,
                    'type': item_type,
                    's3_key': s3_key,
                    'metadata': {
                        'context_type': item_type,
                        'data_keys': list(context_data.keys()) if isinstance(context_data, dict) else [],
                    },
                    'created_at': int(datetime.now().timestamp()),
                    'updated_at': int(datetime.now().timestamp())
                }
                
                manifest['items'][item_id] = item_data
                results.append(item_data)
                
            except Exception as e:
                logger.error(f"Error adding item {idx + 1} of {len(items)}: {str(e)}")
                errors.append({
                    'index': idx,
                    'title': item.get('title', 'Unknown'),
                    'error': str(e)
                })
        
        # Save manifest once after all items are added
        if results:
            save_folder_manifest(user_id, folder_path, manifest)
            logger.info(f"✅ Successfully saved {len(results)} of {len(items)} items to filesystem")
        
        return {
            'success': len(errors) == 0,
            'results': results,
            'errors': errors,
            'total': len(items),
            'succeeded': len(results),
            'failed': len(errors)
        }
    except Exception as e:
        logger.error(f"Error in bulk add context items: {str(e)}")
        raise

def create_folder(user_id: str, folder_name: str, parent_path: Optional[str] = None) -> Dict[str, Any]:
    """Create a new folder"""
    try:
        # Generate folder path
        if parent_path:
            folder_path = f"{parent_path.rstrip('/')}/{folder_name}"
        else:
            folder_path = folder_name
        
        # Get parent manifest and update it
        if parent_path:
            parent_manifest = get_folder_manifest(user_id, parent_path)
        else:
            parent_manifest = get_folder_manifest(user_id, '')
        
        # Create folder manifest
        folder_id = str(uuid.uuid4())
        folder_manifest = {
            'folder_id': folder_id,
            'name': folder_name,
            'parent_path': parent_path or '',
            'path': folder_path,
            'created_at': int(datetime.now().timestamp()),
            'updated_at': int(datetime.now().timestamp()),
            'folders': {},
            'items': {}
        }
        
        # Save folder manifest
        save_folder_manifest(user_id, folder_path, folder_manifest)
        
        # Add to parent manifest
        parent_manifest['folders'][folder_id] = {
            'id': folder_id,
            'name': folder_name,
            'path': folder_path,
            'created_at': int(datetime.now().timestamp()),
            'updated_at': int(datetime.now().timestamp())
        }
        save_folder_manifest(user_id, parent_path or '', parent_manifest)
        
        return {
            'id': folder_id,
            'name': folder_name,
            'path': folder_path,
            'parent_path': parent_path,
            'created_at': folder_manifest['created_at'],
            'updated_at': folder_manifest['updated_at']
        }
    except Exception as e:
        logger.error(f"Error creating folder: {str(e)}")
        raise

def delete_item(user_id: str, folder_path: str, item_id: str) -> bool:
    """Delete an item from the filesystem"""
    try:
        manifest = get_folder_manifest(user_id, folder_path)
        
        if item_id not in manifest['items']:
            raise ValueError(f"Item {item_id} not found")
        
        item = manifest['items'][item_id]
        s3_key = item.get('s3_key')
        
        # Delete from S3
        if s3_key and validate_s3_key(user_id, s3_key):
            try:
                s3_client.delete_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=s3_key)
            except ClientError as e:
                logger.warning(f"Error deleting S3 object {s3_key}: {str(e)}")
        
        # Remove from manifest
        del manifest['items'][item_id]
        save_folder_manifest(user_id, folder_path, manifest)
        
        return True
    except Exception as e:
        logger.error(f"Error deleting item: {str(e)}")
        raise

def delete_folder(user_id: str, folder_path: str) -> bool:
    """Delete a folder and all its contents"""
    try:
        manifest = get_folder_manifest(user_id, folder_path)
        folder_id = manifest.get('folder_id')
        
        if not folder_id:
            logger.error(f"No folder_id found in manifest for path: {folder_path}")
            raise ValueError(f"Cannot delete folder: no folder_id in manifest")
        
        # Delete all items
        for item_id, item in manifest['items'].items():
            s3_key = item.get('s3_key')
            if s3_key and validate_s3_key(user_id, s3_key):
                try:
                    s3_client.delete_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=s3_key)
                except ClientError as e:
                    logger.warning(f"Error deleting S3 object {s3_key}: {str(e)}")
        
        # Recursively delete subfolders
        for subfolder_id, folder_info in manifest['folders'].items():
            subfolder_path = folder_info.get('path', f"{folder_path}/{folder_info.get('name', subfolder_id)}")
            delete_folder(user_id, subfolder_path)
        
        # Get parent path before deleting manifest
        parent_path = manifest.get('parent_path')
        if parent_path is None:
            parent_path = ''
        
        # Delete manifest file
        manifest_key = get_manifest_key(user_id, folder_path)
        try:
            s3_client.delete_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=manifest_key)
        except ClientError as e:
            logger.warning(f"Error deleting manifest {manifest_key}: {str(e)}")
        
        # Remove from parent manifest (must happen after getting parent_path but can happen after deleting manifest)
        # Only try to remove from parent if this is not the root folder
        if folder_path:  # Root folder has empty path, so skip parent removal for root
            try:
                parent_manifest = get_folder_manifest(user_id, parent_path)
                if folder_id in parent_manifest.get('folders', {}):
                    logger.info(f"Removing folder_id {folder_id} from parent manifest at path: {parent_path}")
                    del parent_manifest['folders'][folder_id]
                    save_folder_manifest(user_id, parent_path, parent_manifest)
                    logger.info(f"Successfully removed folder from parent manifest")
                else:
                    # Folder might have already been removed, or parent_path might be incorrect
                    # Try to find the folder in any parent by searching all folders
                    logger.warning(f"⚠️ Folder_id {folder_id} not found in parent manifest at {parent_path}. Available folders: {list(parent_manifest.get('folders', {}).keys())}")
                    logger.info(f"Folder was successfully deleted, but parent manifest cleanup was skipped (folder may have been orphaned or already removed)")
            except Exception as e:
                logger.error(f"❌ Error removing folder from parent manifest: {str(e)}")
                # Don't raise - folder is already deleted, just log the error
                logger.info(f"Folder deletion completed successfully despite parent manifest cleanup error")
        else:
            logger.info(f"Skipping parent manifest removal for root folder")
        
        return True
    except Exception as e:
        logger.error(f"Error deleting folder: {str(e)}")
        raise

def move_item(user_id: str, item_id: str, source_folder_path: str, dest_folder_path: str) -> Dict[str, Any]:
    """Move an item to a different folder"""
    try:
        source_manifest = get_folder_manifest(user_id, source_folder_path)
        
        if item_id not in source_manifest['items']:
            raise ValueError(f"Item {item_id} not found")
        
        item = source_manifest['items'][item_id]
        old_s3_key = item.get('s3_key')
        
        # Generate new S3 key
        file_extension = os.path.splitext(old_s3_key)[1] if old_s3_key else '.json'
        new_file_id = item_id
        new_s3_key = f"users/{user_id}/filesys/{dest_folder_path}/{new_file_id}{file_extension}" if dest_folder_path else f"users/{user_id}/filesys/{new_file_id}{file_extension}"
        
        # Move in S3 (copy + delete)
        if old_s3_key and validate_s3_key(user_id, old_s3_key):
            copy_source = {'Bucket': CHAT_FILES_BUCKET_NAME, 'Key': old_s3_key}
            s3_client.copy_object(
                CopySource=copy_source,
                Bucket=CHAT_FILES_BUCKET_NAME,
                Key=new_s3_key
            )
            s3_client.delete_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=old_s3_key)
        
        # Update item
        item['s3_key'] = new_s3_key
        item['updated_at'] = int(datetime.now().timestamp())
        
        # Remove from source manifest
        del source_manifest['items'][item_id]
        save_folder_manifest(user_id, source_folder_path, source_manifest)
        
        # Add to destination manifest
        dest_manifest = get_folder_manifest(user_id, dest_folder_path)
        dest_manifest['items'][item_id] = item
        save_folder_manifest(user_id, dest_folder_path, dest_manifest)
        
        return item
    except Exception as e:
        logger.error(f"Error moving item: {str(e)}")
        raise

def delete_bulk_items(user_id: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Delete multiple items and/or folders in a single operation - more efficient than sequential calls"""
    try:
        logger.info(f"🗑️ Deleting {len(items)} items in bulk: user_id={user_id}")
        
        results = []
        errors = []
        
        # Group items by folder_path to minimize manifest reads/writes
        items_by_folder: Dict[str, List[Dict[str, Any]]] = {}
        folders_to_delete: List[Dict[str, Any]] = []
        
        for item in items:
            if item.get('is_folder', False):
                folders_to_delete.append(item)
            else:
                folder_path = item.get('folder_path', '')
                if folder_path not in items_by_folder:
                    items_by_folder[folder_path] = []
                items_by_folder[folder_path].append(item)
        
        # Delete folders first (they may contain items)
        for folder_item in folders_to_delete:
            try:
                folder_path = folder_item.get('folder_path', '')
                folder_id = folder_item.get('item_id')
                
                # If folder_path is empty or looks like a UUID (folder_id), try to find the actual path
                # Frontend sends folder_id as folder_path when deleting folders
                if not folder_path or (folder_path and len(folder_path) == 36 and folder_path.count('-') == 4):
                    # Use item_id if folder_path is empty or is a UUID
                    lookup_id = folder_id or folder_path
                    if lookup_id and len(lookup_id) == 36 and lookup_id.count('-') == 4:
                        logger.info(f"Looking up folder path for folder_id: {lookup_id}")
                        actual_path = find_folder_by_id(user_id, lookup_id, '')
                        if actual_path:
                            folder_path = actual_path
                            logger.info(f"✅ Found folder path for folder_id {lookup_id}: {folder_path}")
                        else:
                            logger.error(f"❌ Could not find folder path for folder_id: {lookup_id}")
                            # Try one more time with more detailed logging
                            logger.info(f"Attempting recursive search from root for folder_id: {lookup_id}")
                            actual_path = find_folder_by_id(user_id, lookup_id, '')
                            if not actual_path:
                                raise ValueError(f"Folder not found: {lookup_id}. The folder may have already been deleted or the folder_id is invalid.")
                    elif not folder_path:
                        raise ValueError(f"Folder path or folder_id required for folder deletion")
                
                if not folder_path:
                    raise ValueError(f"Could not determine folder path for folder_id: {folder_id}")
                
                logger.info(f"🗑️ Deleting folder at path: {folder_path} (folder_id: {folder_id})")
                delete_folder(user_id, folder_path)
                results.append({
                    'item_id': folder_item.get('item_id'),
                    'type': 'folder',
                    'success': True
                })
            except Exception as e:
                logger.error(f"Error deleting folder {folder_item.get('item_id')}: {str(e)}")
                errors.append({
                    'item_id': folder_item.get('item_id'),
                    'type': 'folder',
                    'error': str(e)
                })
        
        # Delete items grouped by folder
        for folder_path, folder_items in items_by_folder.items():
            try:
                manifest = get_folder_manifest(user_id, folder_path)
                manifest_updated = False
                
                for item_data in folder_items:
                    try:
                        item_id = item_data.get('item_id')
                        if item_id not in manifest['items']:
                            errors.append({
                                'item_id': item_id,
                                'type': 'item',
                                'error': f"Item {item_id} not found"
                            })
                            continue
                        
                        item = manifest['items'][item_id]
                        s3_key = item.get('s3_key')
                        
                        # Delete from S3
                        if s3_key and validate_s3_key(user_id, s3_key):
                            try:
                                s3_client.delete_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=s3_key)
                            except ClientError as e:
                                logger.warning(f"Error deleting S3 object {s3_key}: {str(e)}")
                        
                        # Remove from manifest
                        del manifest['items'][item_id]
                        manifest_updated = True
                        results.append({
                            'item_id': item_id,
                            'type': 'item',
                            'success': True
                        })
                    except Exception as e:
                        logger.error(f"Error deleting item {item_data.get('item_id')}: {str(e)}")
                        errors.append({
                            'item_id': item_data.get('item_id'),
                            'type': 'item',
                            'error': str(e)
                        })
                
                # Save manifest once after all items in this folder are processed
                if manifest_updated:
                    save_folder_manifest(user_id, folder_path, manifest)
            except Exception as e:
                logger.error(f"Error processing folder {folder_path}: {str(e)}")
                # Mark all items in this folder as failed
                for item_data in folder_items:
                    errors.append({
                        'item_id': item_data.get('item_id'),
                        'type': 'item',
                        'error': f"Folder error: {str(e)}"
                    })
        
        logger.info(f"✅ Successfully deleted {len(results)} of {len(items)} items")
        
        return {
            'success': len(errors) == 0,
            'results': results,
            'errors': errors,
            'total': len(items),
            'succeeded': len(results),
            'failed': len(errors)
        }
    except Exception as e:
        logger.error(f"Error in bulk delete items: {str(e)}")
        raise

def move_bulk_items(user_id: str, items: List[Dict[str, Any]], dest_folder_path: str) -> Dict[str, Any]:
    """Move multiple items to a different folder in a single operation - more efficient than sequential calls"""
    try:
        logger.info(f"📦 Moving {len(items)} items to {dest_folder_path}: user_id={user_id}")
        
        # Get destination manifest once
        dest_manifest = get_folder_manifest(user_id, dest_folder_path)
        
        # Group items by source folder to minimize manifest reads/writes
        items_by_source: Dict[str, List[Dict[str, Any]]] = {}
        
        for item in items:
            source_folder_path = item.get('source_folder_path', '')
            if source_folder_path not in items_by_source:
                items_by_source[source_folder_path] = []
            items_by_source[source_folder_path].append(item)
        
        results = []
        errors = []
        
        # Process items grouped by source folder
        for source_folder_path, source_items in items_by_source.items():
            try:
                # Skip if source and dest are the same
                if source_folder_path == dest_folder_path:
                    for item_data in source_items:
                        errors.append({
                            'item_id': item_data.get('item_id'),
                            'error': 'Source and destination folders are the same'
                        })
                    continue
                
                source_manifest = get_folder_manifest(user_id, source_folder_path)
                source_manifest_updated = False
                dest_manifest_updated = False
                
                for item_data in source_items:
                    try:
                        item_id = item_data.get('item_id')
                        
                        if item_id not in source_manifest['items']:
                            errors.append({
                                'item_id': item_id,
                                'error': f"Item {item_id} not found in source folder"
                            })
                            continue
                        
                        item = source_manifest['items'][item_id]
                        old_s3_key = item.get('s3_key')
                        
                        # Generate new S3 key
                        file_extension = os.path.splitext(old_s3_key)[1] if old_s3_key else '.json'
                        new_s3_key = f"users/{user_id}/filesys/{dest_folder_path}/{item_id}{file_extension}" if dest_folder_path else f"users/{user_id}/filesys/{item_id}{file_extension}"
                        
                        # Move in S3 (copy + delete)
                        if old_s3_key and validate_s3_key(user_id, old_s3_key):
                            copy_source = {'Bucket': CHAT_FILES_BUCKET_NAME, 'Key': old_s3_key}
                            s3_client.copy_object(
                                CopySource=copy_source,
                                Bucket=CHAT_FILES_BUCKET_NAME,
                                Key=new_s3_key
                            )
                            s3_client.delete_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=old_s3_key)
                        
                        # Update item
                        item['s3_key'] = new_s3_key
                        item['updated_at'] = int(datetime.now().timestamp())
                        
                        # Remove from source manifest
                        del source_manifest['items'][item_id]
                        source_manifest_updated = True
                        
                        # Add to destination manifest
                        dest_manifest['items'][item_id] = item
                        dest_manifest_updated = True
                        
                        results.append({
                            'item_id': item_id,
                            'success': True,
                            'result': item
                        })
                    except Exception as e:
                        logger.error(f"Error moving item {item_data.get('item_id')}: {str(e)}")
                        errors.append({
                            'item_id': item_data.get('item_id'),
                            'error': str(e)
                        })
                
                # Save manifests once after all items from this source are processed
                if source_manifest_updated:
                    save_folder_manifest(user_id, source_folder_path, source_manifest)
                if dest_manifest_updated:
                    save_folder_manifest(user_id, dest_folder_path, dest_manifest)
            except Exception as e:
                logger.error(f"Error processing source folder {source_folder_path}: {str(e)}")
                # Mark all items from this source as failed
                for item_data in source_items:
                    errors.append({
                        'item_id': item_data.get('item_id'),
                        'error': f"Source folder error: {str(e)}"
                    })
        
        logger.info(f"✅ Successfully moved {len(results)} of {len(items)} items")
        
        return {
            'success': len(errors) == 0,
            'results': results,
            'errors': errors,
            'total': len(items),
            'succeeded': len(results),
            'failed': len(errors)
        }
    except Exception as e:
        logger.error(f"Error in bulk move items: {str(e)}")
        raise

def rename_item(user_id: str, folder_path: str, item_id: str, new_name: str) -> Dict[str, Any]:
    """Rename an item or folder"""
    try:
        manifest = get_folder_manifest(user_id, folder_path)
        
        if item_id in manifest['items']:
            # Rename item
            item = manifest['items'][item_id]
            item['name'] = new_name
            item['updated_at'] = int(datetime.now().timestamp())
            manifest['items'][item_id] = item
            save_folder_manifest(user_id, folder_path, manifest)
            return item
        elif item_id in manifest.get('folders', {}):
            # Rename folder
            folder_info = manifest['folders'][item_id]
            old_path = folder_info.get('path', folder_path)
            folder_name = os.path.basename(old_path.rstrip('/'))
            new_path = old_path.replace(folder_name, new_name)
            
            # Update folder manifest
            folder_manifest = get_folder_manifest(user_id, old_path)
            folder_manifest['name'] = new_name
            folder_manifest['path'] = new_path
            folder_manifest['updated_at'] = int(datetime.now().timestamp())
            
            # Move manifest file
            old_manifest_key = get_manifest_key(user_id, old_path)
            new_manifest_key = get_manifest_key(user_id, new_path)
            s3_client.copy_object(
                CopySource={'Bucket': CHAT_FILES_BUCKET_NAME, 'Key': old_manifest_key},
                Bucket=CHAT_FILES_BUCKET_NAME,
                Key=new_manifest_key
            )
            s3_client.delete_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=old_manifest_key)
            
            # Update parent manifest
            folder_info['name'] = new_name
            folder_info['path'] = new_path
            folder_info['updated_at'] = int(datetime.now().timestamp())
            manifest['folders'][item_id] = folder_info
            save_folder_manifest(user_id, folder_path, manifest)
            
            return folder_info
        else:
            raise ValueError(f"Item or folder {item_id} not found")
    except Exception as e:
        logger.error(f"Error renaming item: {str(e)}")
        raise

def copy_item(user_id: str, folder_path: str, item_id: str) -> Dict[str, Any]:
    """Copy an item (file) to clipboard - returns item metadata for copying"""
    try:
        manifest = get_folder_manifest(user_id, folder_path)
        
        if item_id not in manifest['items']:
            raise ValueError(f"Item {item_id} not found")
        
        item = manifest['items'][item_id].copy()
        
        # Fetch the actual content from S3
        s3_key = item.get('s3_key')
        if s3_key and validate_s3_key(user_id, s3_key):
            try:
                response = s3_client.get_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=s3_key)
                content_bytes = response['Body'].read()
                
                # For .cosine files, decrypt the content
                if s3_key.endswith(CONTEXT_ITEM_EXTENSION):
                    item['content'] = decrypt_context_data(user_id, content_bytes)
                else:
                    # For regular files, store as base64
                    import base64
                    item['content'] = base64.b64encode(content_bytes).decode('utf-8')
                    item['content_type'] = 'base64'
            except Exception as e:
                logger.warning(f"Error fetching content for copy: {str(e)}")
                item['content'] = None
        
        return {
            'type': 'item',
            'item_data': item,
            'source_folder_path': folder_path,
            'source_item_id': item_id
        }
    except Exception as e:
        logger.error(f"Error copying item: {str(e)}")
        raise

def copy_folder(user_id: str, folder_path: str) -> Dict[str, Any]:
    """Copy a folder and all its contents recursively"""
    try:
        manifest = get_folder_manifest(user_id, folder_path)
        
        # Get all items in the folder
        items_data = {}
        for item_id, item in manifest['items'].items():
            try:
                s3_key = item.get('s3_key')
                if s3_key and validate_s3_key(user_id, s3_key):
                    response = s3_client.get_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=s3_key)
                    content_bytes = response['Body'].read()
                    
                    # For .cosine files, decrypt the content
                    if s3_key.endswith(CONTEXT_ITEM_EXTENSION):
                        items_data[item_id] = {
                            **item,
                            'content': decrypt_context_data(user_id, content_bytes)
                        }
                    else:
                        # For regular files, store as base64
                        import base64
                        items_data[item_id] = {
                            **item,
                            'content': base64.b64encode(content_bytes).decode('utf-8'),
                            'content_type': 'base64'
                        }
                else:
                    items_data[item_id] = item.copy()
            except Exception as e:
                logger.warning(f"Error fetching content for item {item_id}: {str(e)}")
                items_data[item_id] = item.copy()
        
        # Recursively get all subfolders
        subfolders_data = {}
        for subfolder_id, folder_info in manifest.get('folders', {}).items():
            subfolder_path = folder_info.get('path', f"{folder_path}/{folder_info.get('name', subfolder_id)}")
            subfolders_data[subfolder_id] = copy_folder(user_id, subfolder_path)
        
        return {
            'type': 'folder',
            'folder_data': {
                'name': manifest.get('name'),
                'folder_id': manifest.get('folder_id'),
                'items': items_data,
                'subfolders': subfolders_data
            },
            'source_folder_path': folder_path
        }
    except Exception as e:
        logger.error(f"Error copying folder: {str(e)}")
        raise

def download_folder(user_id: str, folder_path: str) -> Dict[str, Any]:
    """
    Download a folder as a .cosine encrypted zip file
    Recursively includes all items and subfolders
    """
    try:
        logger.info(f"📦 Starting folder download: user_id={user_id}, folder_path={folder_path}")
        
        # Get folder manifest
        manifest = get_folder_manifest(user_id, folder_path)
        folder_name = manifest.get('name', 'folder')
        
        # Create in-memory zip file
        zip_buffer = io.BytesIO()
        
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # Helper function to recursively add folder contents
            def add_folder_to_zip(current_path: str, zip_path: str):
                current_manifest = get_folder_manifest(user_id, current_path)
                
                # Add all items in this folder
                for item_id, item in current_manifest.get('items', {}).items():
                    try:
                        s3_key = item.get('s3_key')
                        if s3_key and validate_s3_key(user_id, s3_key):
                            # Get file content from S3
                            response = s3_client.get_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=s3_key)
                            content_bytes = response['Body'].read()
                            
                            # Determine file path in zip
                            item_name = item.get('name', f'item_{item_id}')
                            item_zip_path = f"{zip_path}/{item_name}"
                            
                            # For .cosine files, decrypt before adding to zip
                            if s3_key.endswith(CONTEXT_ITEM_EXTENSION):
                                try:
                                    decrypted_data = decrypt_context_data(user_id, content_bytes)
                                    # Store as JSON in zip
                                    zip_file.writestr(
                                        f"{item_zip_path}.json",
                                        json.dumps(decrypted_data, default=str, indent=2)
                                    )
                                except Exception as e:
                                    logger.warning(f"Error decrypting item {item_id}: {str(e)}")
                                    # Add encrypted version as fallback
                                    zip_file.writestr(f"{item_zip_path}.cosine", content_bytes)
                            else:
                                # For regular files, add with original extension
                                file_extension = os.path.splitext(s3_key)[1] or ''
                                zip_file.writestr(f"{item_zip_path}{file_extension}", content_bytes)
                    except Exception as e:
                        logger.warning(f"Error adding item {item_id} to zip: {str(e)}")
                
                # Recursively add subfolders
                for subfolder_id, folder_info in current_manifest.get('folders', {}).items():
                    subfolder_name = folder_info.get('name', f'folder_{subfolder_id}')
                    subfolder_path = folder_info.get('path', f"{current_path}/{subfolder_name}")
                    subfolder_zip_path = f"{zip_path}/{subfolder_name}"
                    
                    # Recursively add subfolder
                    add_folder_to_zip(subfolder_path, subfolder_zip_path)
            
            # Add the root folder and all its contents
            add_folder_to_zip(folder_path, folder_name)
        
        # Get zip content
        zip_buffer.seek(0)
        zip_content = zip_buffer.read()
        
        # Encrypt the zip file as .cosine
        # Create a metadata structure for the folder
        folder_metadata = {
            'type': 'folder',
            'name': folder_name,
            'folder_path': folder_path,
            'created_at': manifest.get('created_at', int(datetime.now().timestamp())),
            'zip_content': base64.b64encode(zip_content).decode('utf-8')
        }
        
        # Encrypt the folder metadata (which contains the zip)
        encrypted_data = encrypt_context_data(user_id, folder_metadata)
        
        logger.info(f"✅ Folder download complete: {len(encrypted_data)} bytes encrypted")
        
        # Return encrypted data as base64 for easy transfer
        return {
            'encrypted_data': base64.b64encode(encrypted_data).decode('utf-8'),
            'filename': f"{folder_name}.cosine",
            'size': len(encrypted_data)
        }
        
    except Exception as e:
        logger.error(f"Error downloading folder: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise

def upload_folder(user_id: str, dest_folder_path: str, encrypted_data: bytes, filename: str) -> Dict[str, Any]:
    """
    Upload a folder from a .cosine encrypted zip file
    Decrypts, unzips, and creates folders/items recursively
    """
    try:
        logger.info(f"📤 Starting folder upload: user_id={user_id}, dest_folder_path={dest_folder_path}, filename={filename}")
        
        # Decrypt the .cosine file
        try:
            folder_metadata = decrypt_context_data(user_id, encrypted_data)
        except Exception as e:
            logger.error(f"Error decrypting folder file: {str(e)}")
            raise ValueError(f"Failed to decrypt folder file: {str(e)}")
        
        # Extract zip content
        zip_content_b64 = folder_metadata.get('zip_content')
        if not zip_content_b64:
            raise ValueError("Folder metadata missing zip_content")
        
        zip_content = base64.b64decode(zip_content_b64)
        
        # Get folder name from metadata or filename
        folder_name = folder_metadata.get('name') or os.path.splitext(filename)[0]
        
        # Create the folder in destination
        new_folder = create_folder(user_id, folder_name, dest_folder_path)
        new_folder_path = new_folder['path']
        
        # Unzip and process contents
        zip_buffer = io.BytesIO(zip_content)
        
        with zipfile.ZipFile(zip_buffer, 'r') as zip_file:
            # Get all file paths in zip
            file_paths = zip_file.namelist()
            
            # Process files, maintaining folder structure
            processed_paths = {}  # Track processed paths to avoid duplicates
            
            for file_path in file_paths:
                # Skip empty directories
                if file_path.endswith('/'):
                    continue
                
                # Remove root folder name from path to get relative path
                # e.g., "MyFolder/subfolder/file.json" -> "subfolder/file.json"
                parts = file_path.split('/')
                if len(parts) > 1 and parts[0] == folder_name:
                    relative_path = '/'.join(parts[1:])
                else:
                    relative_path = file_path
                
                # Skip if already processed
                if relative_path in processed_paths:
                    continue
                processed_paths[relative_path] = True
                
                # Determine if this is a file in a subfolder
                path_parts = relative_path.split('/')
                if len(path_parts) > 1:
                    # File is in a subfolder
                    subfolder_path_parts = path_parts[:-1]
                    current_folder_path = new_folder_path
                    
                    # Create subfolder structure
                    for subfolder_name in subfolder_path_parts:
                        # Check if subfolder already exists
                        current_manifest = get_folder_manifest(user_id, current_folder_path)
                        subfolder_exists = False
                        subfolder_id = None
                        
                        for fid, folder_info in current_manifest.get('folders', {}).items():
                            if folder_info.get('name') == subfolder_name:
                                subfolder_exists = True
                                subfolder_id = fid
                                break
                        
                        if not subfolder_exists:
                            # Create subfolder
                            subfolder = create_folder(user_id, subfolder_name, current_folder_path)
                            current_folder_path = subfolder['path']
                        else:
                            # Use existing subfolder
                            if subfolder_id:
                                folder_info = current_manifest['folders'][subfolder_id]
                                current_folder_path = folder_info.get('path', f"{current_folder_path}/{subfolder_name}")
                    
                    file_name = path_parts[-1]
                else:
                    # File is in root of the folder
                    current_folder_path = new_folder_path
                    file_name = relative_path
                
                # Read file content from zip
                file_content = zip_file.read(file_path)
                
                # Determine file type and handle accordingly
                if file_name.endswith('.json'):
                    # Try to parse as context item
                    try:
                        context_data = json.loads(file_content.decode('utf-8'))
                        item_name = os.path.splitext(file_name)[0]
                        add_context_item(user_id, current_folder_path, context_data, item_name, 'context_item')
                    except json.JSONDecodeError:
                        # Not valid JSON, treat as regular file
                        add_file_upload(user_id, current_folder_path, file_content, file_name)
                elif file_name.endswith('.cosine'):
                    # Encrypted file - decrypt and add as context item
                    try:
                        decrypted_data = decrypt_context_data(user_id, file_content)
                        item_name = os.path.splitext(file_name)[0]
                        add_context_item(user_id, current_folder_path, decrypted_data, item_name, 'context_item')
                    except Exception as e:
                        logger.warning(f"Error decrypting .cosine file {file_name}: {str(e)}")
                        # Add as regular file if decryption fails
                        add_file_upload(user_id, current_folder_path, file_content, file_name)
                else:
                    # Regular file
                    add_file_upload(user_id, current_folder_path, file_content, file_name)
        
        logger.info(f"✅ Folder upload complete: {folder_name} with {len(processed_paths)} items")
        
        return {
            'folder': new_folder,
            'items_created': len(processed_paths)
        }
        
    except Exception as e:
        logger.error(f"Error uploading folder: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise

def copy_bulk_items(user_id: str, items: List[Dict[str, Any]], dest_folder_path: str) -> Dict[str, Any]:
    """
    Copy multiple items and folders in bulk - more efficient than sequential calls
    Recursively collects all items from folders, creates folder structure, then bulk copies items
    items: List of {item_id, source_folder_path, is_folder}
    """
    try:
        logger.info(f"📋 Copying {len(items)} items in bulk: user_id={user_id}, dest={dest_folder_path}")
        
        # Collect all folders and items that need to be processed
        all_folders = []  # List of {source_path, folder_name, parent_source_path}
        all_items = []  # List of {item_id, source_folder_path, source_folder_path_for_mapping}
        folder_path_map = {}  # Maps source folder path -> destination folder path
        
        def collect_folder_contents(source_folder_path: str, parent_source: Optional[str] = None):
            """Recursively collect all folders and items from a folder"""
            try:
                manifest = get_folder_manifest(user_id, source_folder_path)
                folder_name = manifest.get('name', 'folder')
                
                logger.debug(f"📂 Collecting from folder: {folder_name} at {source_folder_path}")
                
                # Add this folder to the list
                all_folders.append({
                    'source_path': source_folder_path,
                    'folder_name': folder_name,
                    'parent_source_path': parent_source
                })
                
                # Collect all items in this folder
                items_count = len(manifest.get('items', {}))
                for item_id, item in manifest.get('items', {}).items():
                    all_items.append({
                        'item_id': item_id,
                        'source_folder_path': source_folder_path,
                        'source_folder_path_for_mapping': source_folder_path  # For mapping to dest
                    })
                logger.debug(f"  📄 Found {items_count} items in {folder_name}")
                
                # Recursively collect subfolders
                subfolders_count = len(manifest.get('folders', {}))
                for subfolder_id, folder_info in manifest.get('folders', {}).items():
                    subfolder_path = folder_info.get('path', f"{source_folder_path}/{folder_info.get('name', subfolder_id)}")
                    collect_folder_contents(subfolder_path, source_folder_path)
                logger.debug(f"  📁 Found {subfolders_count} subfolders in {folder_name}")
            
            except Exception as e:
                logger.error(f"Error collecting contents from {source_folder_path}: {str(e)}")
                import traceback
                logger.error(f"Traceback: {traceback.format_exc()}")
        
        # Process each item/folder
        for item_info in items:
            item_id = item_info.get('item_id')
            source_folder_path = item_info.get('source_folder_path', '')
            is_folder = item_info.get('is_folder', False)
            
            if is_folder:
                # Collect all contents recursively
                collect_folder_contents(source_folder_path)
                logger.info(f"📁 Collected folder structure: {len(all_folders)} folders, {len(all_items)} items")
            else:
                # Regular item
                all_items.append({
                    'item_id': item_id,
                    'source_folder_path': source_folder_path,
                    'dest_folder_path': dest_folder_path  # Direct destination
                })
        
        # Step 2: Create all folders first (parents before children)
        # Sort folders by depth (shallow first)
        def get_depth(folder_info: Dict) -> int:
            source_path = folder_info['source_path']
            return source_path.count('/') if source_path else 0
        
        all_folders.sort(key=get_depth)
        
        for folder_info in all_folders:
            try:
                source_path = folder_info['source_path']
                folder_name = folder_info['folder_name']
                parent_source = folder_info['parent_source_path']
                
                # Determine destination parent path
                if parent_source and parent_source in folder_path_map:
                    dest_parent_path = folder_path_map[parent_source]
                elif not parent_source:
                    # Root folder being copied - use provided destination
                    dest_parent_path = dest_folder_path
                else:
                    # Parent not yet mapped - this shouldn't happen if sorted correctly
                    logger.warning(f"Parent folder {parent_source} not found in map, using root dest")
                    dest_parent_path = dest_folder_path
                
                # Create the folder
                new_folder = create_folder(user_id, folder_name, dest_parent_path)
                new_folder_path = new_folder['path']
                folder_path_map[source_path] = new_folder_path
                
                logger.info(f"✅ Created folder: {folder_name} at {new_folder_path} (from {source_path})")
                
            except Exception as e:
                logger.error(f"Error creating folder {folder_info['folder_name']}: {str(e)}")
                import traceback
                logger.error(f"Traceback: {traceback.format_exc()}")
        
        # Step 3: Map items to their destination folders
        for item_info in all_items:
            if 'dest_folder_path' not in item_info:
                # Item from a folder - map to destination
                source_key = item_info.get('source_folder_path_for_mapping')
                if source_key and source_key in folder_path_map:
                    item_info['dest_folder_path'] = folder_path_map[source_key]
                else:
                    # Fallback
                    item_info['dest_folder_path'] = dest_folder_path
        
        logger.info(f"📋 Total items to copy: {len(all_items)}")
        
        # Step 4: Bulk copy all items
        results = []
        errors = []
        
        for item_info in all_items:
            try:
                item_id = item_info['item_id']
                source_path = item_info['source_folder_path']
                dest_path = item_info.get('dest_folder_path', dest_folder_path)
                
                # Copy the item
                clipboard_data = copy_item(user_id, source_path, item_id)
                result = paste_item(user_id, dest_path, clipboard_data)
                results.append(result)
            except Exception as e:
                logger.error(f"Error copying item {item_info['item_id']}: {str(e)}")
                errors.append({
                    'item_id': item_info['item_id'],
                    'error': str(e)
                })
        
        # Step 5: Return folder results (root folders only)
        folder_results = []
        root_folder_sources = set()
        for item_info in items:
            if item_info.get('is_folder'):
                root_folder_sources.add(item_info['source_folder_path'])
        
        for folder_info in all_folders:
            source_path = folder_info['source_path']
            if source_path in root_folder_sources and source_path in folder_path_map:
                folder_results.append({
                    'id': folder_path_map[source_path].split('/')[-1] if folder_path_map[source_path] else folder_info['folder_name'],
                    'name': folder_info['folder_name'],
                    'type': 'folder',
                    'path': folder_path_map[source_path]
                })
        
        # Combine results
        all_results = folder_results + results
        
        logger.info(f"✅ Bulk copy complete: {len(all_results)} items/folders copied ({len(folder_results)} root folders, {len(results)} items), {len(errors)} errors")
        
        return {
            'pasted_items': all_results,
            'count': len(all_results),
            'items_copied': len(results),
            'folders_created': len(all_folders),
            'errors': errors
        }
    except Exception as e:
        logger.error(f"Error in bulk copy: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise

def paste_items_by_ids(user_id: str, dest_folder_path: str, item_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Paste multiple items by copying them first, then pasting
    Uses bulk copy for efficiency when folders are involved
    item_data: List of {item_id, source_folder_path, is_folder}
    """
    try:
        # Check if any items are folders - if so, use bulk copy
        has_folders = any(item.get('is_folder', False) for item in item_data)
        
        if has_folders:
            # Use bulk copy which handles folders recursively
            return copy_bulk_items(user_id, item_data, dest_folder_path)
        else:
            # For single items, use the original method
            results = []
            for item_info in item_data:
                item_id = item_info.get('item_id')
                source_folder_path = item_info.get('source_folder_path', '')
                
                # Copy the item
                clipboard_data = copy_item(user_id, source_folder_path, item_id)
                
                # Then paste it
                result = paste_item(user_id, dest_folder_path, clipboard_data)
                results.append(result)
            
            return {
                'pasted_items': results,
                'count': len(results)
            }
    except Exception as e:
        logger.error(f"Error pasting items by IDs: {str(e)}")
        raise

def paste_item(user_id: str, dest_folder_path: str, clipboard_data: Dict[str, Any]) -> Dict[str, Any]:
    """Paste a copied item into a destination folder"""
    try:
        if clipboard_data.get('type') == 'item':
            # Paste a single item
            item_data = clipboard_data['item_data'].copy()
            original_item_id = clipboard_data.get('source_item_id')
            
            # Generate new ID for the copied item
            new_item_id = str(uuid.uuid4())
            
            # Get destination manifest
            dest_manifest = get_folder_manifest(user_id, dest_folder_path)
            
            # Create new S3 key with new ID
            old_s3_key = item_data.get('s3_key', '')
            file_extension = os.path.splitext(old_s3_key)[1] if old_s3_key else ''
            if not file_extension and item_data.get('type') == 'context_item':
                file_extension = CONTEXT_ITEM_EXTENSION
            
            new_s3_key = f"users/{user_id}/filesys/{dest_folder_path}/{new_item_id}{file_extension}" if dest_folder_path else f"users/{user_id}/filesys/{new_item_id}{file_extension}"
            
            # Upload content to S3
            if item_data.get('content') is not None:
                if item_data.get('s3_key', '').endswith(CONTEXT_ITEM_EXTENSION) or file_extension == CONTEXT_ITEM_EXTENSION:
                    # Encrypt and save .cosine file
                    encrypted_data = encrypt_context_data(user_id, item_data['content'])
                    s3_client.put_object(
                        Bucket=CHAT_FILES_BUCKET_NAME,
                        Key=new_s3_key,
                        Body=encrypted_data,
                        ContentType=CONTEXT_ITEM_MIME_TYPE
                    )
                elif item_data.get('content_type') == 'base64':
                    # Decode base64 and save regular file
                    import base64
                    file_content = base64.b64decode(item_data['content'])
                    content_type = item_data.get('metadata', {}).get('content_type', 'application/octet-stream')
                    s3_client.put_object(
                        Bucket=CHAT_FILES_BUCKET_NAME,
                        Key=new_s3_key,
                        Body=file_content,
                        ContentType=content_type
                    )
                else:
                    # Save as JSON
                    content_json = json.dumps(item_data['content'], default=str)
                    s3_client.put_object(
                        Bucket=CHAT_FILES_BUCKET_NAME,
                        Key=new_s3_key,
                        Body=content_json.encode('utf-8'),
                        ContentType='application/json'
                    )
            
            # Create new item entry
            new_item = {
                'id': new_item_id,
                'name': item_data.get('name', 'Copied Item'),
                'type': item_data.get('type', 'context_item'),
                's3_key': new_s3_key,
                'metadata': item_data.get('metadata', {}),
                'created_at': int(datetime.now().timestamp()),
                'updated_at': int(datetime.now().timestamp())
            }
            
            # Add to destination manifest
            dest_manifest['items'][new_item_id] = new_item
            save_folder_manifest(user_id, dest_folder_path, dest_manifest)
            
            return new_item
        elif clipboard_data.get('type') == 'folder':
            # Paste a folder recursively
            folder_data = clipboard_data['folder_data']
            folder_name = folder_data.get('name', 'Copied Folder')
            
            # Create new folder
            new_folder = create_folder(user_id, folder_name, dest_folder_path)
            new_folder_path = new_folder['path']
            
            # Paste all items
            for old_item_id, item_data in folder_data.get('items', {}).items():
                paste_item(user_id, new_folder_path, {
                    'type': 'item',
                    'item_data': item_data,
                    'source_item_id': old_item_id
                })
            
            # Recursively paste all subfolders
            for old_subfolder_id, subfolder_clipboard in folder_data.get('subfolders', {}).items():
                paste_item(user_id, new_folder_path, subfolder_clipboard)
            
            return new_folder
        else:
            raise ValueError(f"Unknown clipboard type: {clipboard_data.get('type')}")
    except Exception as e:
        logger.error(f"Error pasting item: {str(e)}")
        raise

def find_folder_by_id(user_id: str, folder_id: str, search_path: str = '') -> Optional[str]:
    """Find folder path by folder_id by searching through manifests"""
    try:
        manifest = get_folder_manifest(user_id, search_path)
        
        # Check if this folder matches
        if manifest.get('folder_id') == folder_id:
            path = manifest.get('path', search_path)
            logger.debug(f"Found folder_id {folder_id} at path: {path}")
            return path
        
        # Check subfolders
        for subfolder_id, folder_info in manifest.get('folders', {}).items():
            if subfolder_id == folder_id:
                path = folder_info.get('path')
                if path:
                    logger.debug(f"Found folder_id {folder_id} in subfolders at path: {path}")
                    return path
            # Recursively search in subfolder
            subfolder_path = folder_info.get('path', f"{search_path}/{folder_info.get('name', subfolder_id)}")
            if subfolder_path:
                result = find_folder_by_id(user_id, folder_id, subfolder_path)
                if result:
                    return result
        
        return None
    except Exception as e:
        logger.warning(f"Error searching for folder_id {folder_id} in path {search_path}: {str(e)}")
        return None

def list_folder(user_id: str, folder_path: str = '') -> Dict[str, Any]:
    """List contents of a folder"""
    try:
        manifest = get_folder_manifest(user_id, folder_path)
        
        return {
            'folder': {
                'id': manifest.get('folder_id'),
                'name': manifest.get('name'),
                'path': manifest.get('path', folder_path),
                'parent_path': manifest.get('parent_path'),
                'created_at': manifest.get('created_at'),
                'updated_at': manifest.get('updated_at')
            },
            'subfolders': list(manifest.get('folders', {}).values()),
            'items': list(manifest.get('items', {}).values())
        }
    except Exception as e:
        logger.error(f"Error listing folder: {str(e)}")
        raise

def update_item(user_id: str, folder_path: str, item_id: str, content_data: Dict[str, Any]) -> Dict[str, Any]:
    """Update an item's content in S3
    
    For encrypted .cosine files: decrypts old file, updates with new data, re-encrypts and saves.
    For regular files: updates content directly.
    """
    try:
        manifest = get_folder_manifest(user_id, folder_path)
        
        if item_id not in manifest['items']:
            raise ValueError(f"Item {item_id} not found")
        
        item = manifest['items'][item_id]
        s3_key = item.get('s3_key')
        
        if not s3_key or not validate_s3_key(user_id, s3_key):
            raise ValueError(f"Invalid S3 key for item {item_id}")
        
        logger.info(f"🔄 Updating item {item_id}, s3_key: {s3_key}")
        
        # Check if this is a .cosine encrypted context item file
        is_cosine_file = s3_key.endswith(CONTEXT_ITEM_EXTENSION)
        
        if is_cosine_file:
            # For encrypted .cosine files: encrypt the new content and save
            logger.info(f"🔐 Updating encrypted .cosine file: {s3_key}")
            logger.info(f"🔐 Encrypting updated content for user {user_id}...")
            encrypted_data = encrypt_context_data(user_id, content_data)
            logger.info(f"🔐 Encryption successful, encrypted data size: {len(encrypted_data)} bytes")
            
            # Save encrypted content (overwrites existing file at same S3 key)
            s3_client.put_object(
                Bucket=CHAT_FILES_BUCKET_NAME,
                Key=s3_key,  # Keep same S3 key so subsequent edits work
                Body=encrypted_data,
                ContentType=CONTEXT_ITEM_MIME_TYPE
            )
            logger.info(f"✅ Successfully updated encrypted context item in S3: {s3_key}")
        else:
            # For regular files: save as JSON or raw content
            logger.info(f"📄 Updating regular file: {s3_key}")
            content_json = json.dumps(content_data, default=str, indent=2)
            s3_client.put_object(
                Bucket=CHAT_FILES_BUCKET_NAME,
                Key=s3_key,  # Keep same S3 key
                Body=content_json.encode('utf-8'),
                ContentType='application/json'
            )
            logger.info(f"✅ Successfully updated regular file in S3: {s3_key}")
        
        # Update manifest
        item['updated_at'] = int(datetime.now().timestamp())
        manifest['items'][item_id] = item
        save_folder_manifest(user_id, folder_path, manifest)
        
        return item
    except Exception as e:
        logger.error(f"Error updating item: {str(e)}")
        raise

def get_item(user_id: str, folder_path: str, item_id: str) -> Dict[str, Any]:
    """Get item metadata and optionally content"""
    try:
        manifest = get_folder_manifest(user_id, folder_path)
        
        if item_id in manifest['items']:
            item = manifest['items'][item_id].copy()
            # Optionally fetch content from S3
            include_content = True  # Can be made configurable
            if include_content and item.get('s3_key'):
                try:
                    response = s3_client.get_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=item['s3_key'])
                    content_bytes = response['Body'].read()
                    
                    # Check if this is a .cosine encrypted context item file
                    # Only .cosine files are encrypted - all other files are stored as-is
                    if item['s3_key'].endswith(CONTEXT_ITEM_EXTENSION):
                        # Decrypt the encrypted context item for preview
                        item['content'] = decrypt_context_data(user_id, content_bytes)
                    elif item.get('type') == 'context_item' and item['s3_key'].endswith('.json'):
                        # Legacy unencrypted context items (old format - should be migrated)
                        item['content'] = json.loads(content_bytes.decode('utf-8'))
                    else:
                        # Regular files (PDFs, images, etc.) - no decryption needed
                        item['content'] = content_bytes.decode('utf-8')
                except Exception as e:
                    logger.warning(f"Error fetching content: {str(e)}")
            return item
        elif item_id in manifest.get('folders', {}):
            folder_path = manifest['folders'][item_id].get('path', '')
            return get_folder_manifest(user_id, folder_path)
        else:
            raise ValueError(f"Item {item_id} not found")
    except Exception as e:
        logger.error(f"Error getting item: {str(e)}")
        raise

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler for file system operations"""
    try:
        # Extract origin from request headers for CORS validation
        headers = event.get('headers', {})
        origin = headers.get('Origin') or headers.get('origin')
        
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
                'body': ''
            }
        
        # Validate user identity
        user_id = validate_user_identity(event)
        if not user_id:
            return {
                'statusCode': 401,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Authentication failed'})
            }
        
        # Parse request body
        if 'body' in event:
            body = json.loads(event.get('body', '{}')) if isinstance(event.get('body'), str) else event.get('body', {})
        else:
            body = event
        
        operation = body.get('operation')
        if not operation:
            return {
                'statusCode': 400,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': 'Operation is required'})
            }
        
        # Route to appropriate operation
        result = None
        if operation == 'add_file':
            # Handle file upload (multipart/form-data or base64)
            folder_path = body.get('folder_path', '')
            file_content = body.get('file_content')  # Base64 encoded or bytes
            filename = body.get('filename', 'untitled')
            title = body.get('title')
            description = body.get('description')
            
            # Decode base64 if provided
            if isinstance(file_content, str):
                import base64
                file_content = base64.b64decode(file_content)
            
            result = add_file_upload(user_id, folder_path, file_content, filename, title, description)
            
        elif operation == 'add_context_item':
            context_data = body.get('context_data', {})
            title = body.get('title', 'Untitled')
            item_type = body.get('item_type', 'context_item')
            folder_path = body.get('folder_path', '')
            result = add_context_item(user_id, folder_path, context_data, title, item_type)
            
        elif operation == 'add_bulk_context_items':
            items = body.get('items', [])
            folder_path = body.get('folder_path', '')
            if not items or not isinstance(items, list):
                return {
                    'statusCode': 400,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'items must be a non-empty array'})
                }
            result = add_bulk_context_items(user_id, folder_path, items)
            
        elif operation == 'create_folder':
            folder_name = body.get('folder_name')
            parent_path = body.get('parent_path')
            result = create_folder(user_id, folder_name, parent_path)
            
        elif operation == 'delete_item':
            folder_path = body.get('folder_path', '')
            item_id = body.get('item_id')
            result = delete_item(user_id, folder_path, item_id)
            
        elif operation == 'delete_bulk_items':
            items = body.get('items', [])
            if not items or not isinstance(items, list):
                return {
                    'statusCode': 400,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'items must be a non-empty array'})
                }
            result = delete_bulk_items(user_id, items)
            
        elif operation == 'delete_folder':
            folder_path = body.get('folder_path', '')
            folder_id = body.get('folder_id')
            
            # If folder_path looks like a UUID (folder_id), try to find the actual path
            if folder_path and len(folder_path) == 36 and folder_path.count('-') == 4:
                # Likely a UUID, try to find the actual folder path
                logger.info(f"folder_path looks like a UUID, searching for actual path...")
                actual_path = find_folder_by_id(user_id, folder_path, '')
                if actual_path:
                    folder_path = actual_path
                    logger.info(f"Found folder path: {folder_path}")
                else:
                    logger.warning(f"Could not find folder path for folder_id: {folder_path}")
            elif folder_id:
                # If folder_id is provided separately, use it to find the path
                logger.info(f"folder_id provided, searching for actual path...")
                actual_path = find_folder_by_id(user_id, folder_id, '')
                if actual_path:
                    folder_path = actual_path
                    logger.info(f"Found folder path: {folder_path}")
                else:
                    logger.warning(f"Could not find folder path for folder_id: {folder_id}")
            
            result = delete_folder(user_id, folder_path)
            
        elif operation == 'move_item':
            item_id = body.get('item_id')
            source_folder_path = body.get('source_folder_path', '')
            dest_folder_path = body.get('dest_folder_path', '')
            result = move_item(user_id, item_id, source_folder_path, dest_folder_path)
            
        elif operation == 'move_bulk_items':
            items = body.get('items', [])
            dest_folder_path = body.get('dest_folder_path', '')
            if not items or not isinstance(items, list):
                return {
                    'statusCode': 400,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'items must be a non-empty array'})
                }
            result = move_bulk_items(user_id, items, dest_folder_path)
            
        elif operation == 'update_item':
            folder_path = body.get('folder_path', '')
            item_id = body.get('item_id')
            content_data = body.get('content_data', {})
            result = update_item(user_id, folder_path, item_id, content_data)
            
        elif operation == 'rename_item':
            folder_path = body.get('folder_path', '')
            item_id = body.get('item_id')
            new_name = body.get('new_name')
            result = rename_item(user_id, folder_path, item_id, new_name)
            
        elif operation == 'list_folder':
            folder_path = body.get('folder_path', '')
            result = list_folder(user_id, folder_path)
            
        elif operation == 'get_item':
            folder_path = body.get('folder_path', '')
            item_id = body.get('item_id')
            result = get_item(user_id, folder_path, item_id)
            
        elif operation == 'copy_item':
            folder_path = body.get('folder_path', '')
            item_id = body.get('item_id')
            result = copy_item(user_id, folder_path, item_id)
            
        elif operation == 'copy_folder':
            folder_path = body.get('folder_path', '')
            result = copy_folder(user_id, folder_path)
            
        elif operation == 'paste_item':
            dest_folder_path = body.get('dest_folder_path', '')
            clipboard_data = body.get('clipboard_data', {})
            result = paste_item(user_id, dest_folder_path, clipboard_data)
            
        elif operation == 'paste_items_by_ids':
            dest_folder_path = body.get('dest_folder_path', '')
            item_data = body.get('item_data', [])  # List of {item_id, source_folder_path, is_folder}
            result = paste_items_by_ids(user_id, dest_folder_path, item_data)
            
        elif operation == 'download_folder':
            folder_path = body.get('folder_path', '')
            result = download_folder(user_id, folder_path)
            # For download, return the encrypted data directly in response
            # Frontend will handle creating download link
            return {
                'statusCode': 200,
                'headers': {
                    **build_cors_headers(origin),
                    'Content-Type': 'application/json'
                },
                'body': json.dumps({
                    'success': True,
                    'result': result
                }, default=str)
            }
            
        elif operation == 'upload_folder':
            dest_folder_path = body.get('dest_folder_path', '')
            encrypted_data_b64 = body.get('encrypted_data')  # Base64 encoded encrypted data
            filename = body.get('filename', 'folder.cosine')
            
            if not encrypted_data_b64:
                return {
                    'statusCode': 400,
                    'headers': build_cors_headers(origin),
                    'body': json.dumps({'error': 'Missing encrypted_data'})
                }
            
            # Decode base64 encrypted data
            encrypted_data = base64.b64decode(encrypted_data_b64)
            result = upload_folder(user_id, dest_folder_path, encrypted_data, filename)
            
        else:
            return {
                'statusCode': 400,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'error': f'Unknown operation: {operation}'})
            }
        
        return {
            'statusCode': 200,
            'headers': build_cors_headers(origin),
            'body': json.dumps({
                'success': True,
                'result': result
            }, default=str)
        }
        
    except Exception as e:
        logger.error(f"Lambda handler error: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        return {
            'statusCode': 500,
            'headers': build_cors_headers(origin),
            'body': json.dumps({'error': str(e)})
        }


