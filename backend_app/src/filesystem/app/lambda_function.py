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
from typing import Dict, Any, Optional, List
from botocore.exceptions import ClientError
from datetime import datetime
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

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

def derive_key_from_user_id(user_id: str) -> bytes:
    """Derive encryption key from user ID using PBKDF2"""
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
    """Encrypt context data using Fernet (AES-128 in CBC mode with HMAC)"""
    try:
        key = derive_key_from_user_id(user_id)
        fernet = Fernet(key)
        json_data = json.dumps(data, default=str)
        encrypted_data = fernet.encrypt(json_data.encode('utf-8'))
        return encrypted_data
    except Exception as e:
        logger.error(f"Error encrypting context data: {str(e)}")
        raise

def decrypt_context_data(user_id: str, encrypted_data: bytes) -> Dict[str, Any]:
    """Decrypt context data using Fernet"""
    try:
        key = derive_key_from_user_id(user_id)
        fernet = Fernet(key)
        decrypted_data = fernet.decrypt(encrypted_data)
        json_data = json.loads(decrypted_data.decode('utf-8'))
        return json_data
    except Exception as e:
        logger.error(f"Error decrypting context data: {str(e)}")
        raise

def get_cors_headers():
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
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
        
        # Check if this is a .cosine encrypted context item file
        # Only .cosine files are encrypted context items - all other files (PDFs, JSON, images, etc.) are regular files
        is_cosine_file = file_extension.lower() == CONTEXT_ITEM_EXTENSION
        
        # If it's a .cosine file, decrypt it and re-encrypt for storage (maintain encryption)
        # This handles re-uploading of downloaded context items
        if is_cosine_file:
            try:
                # Decrypt the file content
                decrypted_data = decrypt_context_data(user_id, file_content)
                
                # Re-encrypt for storage (maintain encryption format)
                encrypted_data = encrypt_context_data(user_id, decrypted_data)
                file_content = encrypted_data
                content_type = CONTEXT_ITEM_MIME_TYPE
                item_type = 'context_item'
            except Exception as e:
                logger.error(f"Failed to decrypt .cosine file: {str(e)}")
                raise ValueError("Failed to decrypt Cosine context item file. File may be corrupted or from a different user.")
        else:
            # Regular files (PDFs, images, JSON, etc.) - NO encryption, store as-is
            content_type = 'application/octet-stream'
            if file_extension.lower() == '.json':
                content_type = 'application/json'
            elif file_extension.lower() in ['.png', '.jpg', '.jpeg', '.gif']:
                content_type = f'image/{file_extension[1:].lower()}'
            elif file_extension.lower() == '.pdf':
                content_type = 'application/pdf'
            elif file_extension.lower() in ['.txt', '.md']:
                content_type = 'text/plain'
            
            # Regular uploaded files are always 'uploaded_file' type (not context_item)
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
        # Get folder manifest
        manifest = get_folder_manifest(user_id, folder_path)
        
        # Generate item ID and S3 key (using .cosine extension for encrypted context items)
        item_id = str(uuid.uuid4())
        s3_key = f"users/{user_id}/filesys/{folder_path}/{item_id}{CONTEXT_ITEM_EXTENSION}" if folder_path else f"users/{user_id}/filesys/{item_id}{CONTEXT_ITEM_EXTENSION}"
        
        # Encrypt and store context data
        encrypted_data = encrypt_context_data(user_id, context_data)
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
        
        # Delete all items
        for item_id, item in manifest['items'].items():
            s3_key = item.get('s3_key')
            if s3_key and validate_s3_key(user_id, s3_key):
                try:
                    s3_client.delete_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=s3_key)
                except ClientError as e:
                    logger.warning(f"Error deleting S3 object {s3_key}: {str(e)}")
        
        # Recursively delete subfolders
        for folder_id, folder_info in manifest['folders'].items():
            subfolder_path = folder_info.get('path', f"{folder_path}/{folder_info.get('name', folder_id)}")
            delete_folder(user_id, subfolder_path)
        
        # Delete manifest file
        manifest_key = get_manifest_key(user_id, folder_path)
        try:
            s3_client.delete_object(Bucket=CHAT_FILES_BUCKET_NAME, Key=manifest_key)
        except ClientError as e:
            logger.warning(f"Error deleting manifest {manifest_key}: {str(e)}")
        
        # Remove from parent manifest
        parent_path = manifest.get('parent_path') or ''
        if parent_path or folder_path:
            parent_manifest = get_folder_manifest(user_id, parent_path)
            folder_id = manifest.get('folder_id')
            if folder_id and folder_id in parent_manifest.get('folders', {}):
                del parent_manifest['folders'][folder_id]
                save_folder_manifest(user_id, parent_path, parent_manifest)
        
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
    """Update an item's content in S3"""
    try:
        manifest = get_folder_manifest(user_id, folder_path)
        
        if item_id not in manifest['items']:
            raise ValueError(f"Item {item_id} not found")
        
        item = manifest['items'][item_id]
        s3_key = item.get('s3_key')
        
        if not s3_key or not validate_s3_key(user_id, s3_key):
            raise ValueError(f"Invalid S3 key for item {item_id}")
        
        # Update content in S3
        content_json = json.dumps(content_data, default=str, indent=2)
        s3_client.put_object(
            Bucket=CHAT_FILES_BUCKET_NAME,
            Key=s3_key,
            Body=content_json.encode('utf-8'),
            ContentType='application/json'
        )
        
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
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': get_cors_headers(),
                'body': ''
            }
        
        # Validate user identity
        user_id = validate_user_identity(event)
        if not user_id:
            return {
                'statusCode': 401,
                'headers': get_cors_headers(),
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
                'headers': get_cors_headers(),
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
            
        elif operation == 'create_folder':
            folder_name = body.get('folder_name')
            parent_path = body.get('parent_path')
            result = create_folder(user_id, folder_name, parent_path)
            
        elif operation == 'delete_item':
            folder_path = body.get('folder_path', '')
            item_id = body.get('item_id')
            result = delete_item(user_id, folder_path, item_id)
            
        elif operation == 'delete_folder':
            folder_path = body.get('folder_path', '')
            result = delete_folder(user_id, folder_path)
            
        elif operation == 'move_item':
            item_id = body.get('item_id')
            source_folder_path = body.get('source_folder_path', '')
            dest_folder_path = body.get('dest_folder_path', '')
            result = move_item(user_id, item_id, source_folder_path, dest_folder_path)
            
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
            
        else:
            return {
                'statusCode': 400,
                'headers': get_cors_headers(),
                'body': json.dumps({'error': f'Unknown operation: {operation}'})
            }
        
        return {
            'statusCode': 200,
            'headers': get_cors_headers(),
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
            'headers': get_cors_headers(),
            'body': json.dumps({'error': str(e)})
        }
