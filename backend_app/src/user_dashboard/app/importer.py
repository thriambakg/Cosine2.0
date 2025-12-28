"""
Dashboard Importer
Helper class for importing dashboard configurations from .cosine files or share links
Handles decryption and writing to the dashboard configuration table
"""

import json
import os
import logging
import boto3
import base64
import hashlib
from typing import Dict, Any, Optional
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# Configure logging
logger = logging.getLogger(__name__)

# Environment variables
ENCRYPTION_SECRET = os.environ.get('ENCRYPTION_SECRET', 'default-secret-change-in-production')
CHAT_FILES_BUCKET_NAME = os.environ.get('CHAT_FILES_BUCKET_NAME', 'cosine-chat-files-production')
CONTEXT_ITEM_EXTENSION = '.cosine'

# Initialize S3 client
s3_client = boto3.client('s3', config=boto3.session.Config(signature_version='s3v4'))


class DashboardImporter:
    """
    Imports dashboard configurations from encrypted .cosine files or share links
    Decrypts the data and writes it to the user's dashboard configuration table
    """
    
    def __init__(self):
        self.s3_client = s3_client
        self.bucket_name = CHAT_FILES_BUCKET_NAME
        self.encryption_secret = ENCRYPTION_SECRET
    
    def derive_key_from_user_id(self, user_id: str) -> bytes:
        """Derive encryption key from user ID using PBKDF2"""
        salt = hashlib.sha256(f"{self.encryption_secret}{user_id}".encode()).digest()[:16]
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(f"{user_id}{self.encryption_secret}".encode()))
        return key
    
    def decrypt_dashboard_data(self, user_id: str, encrypted_data: bytes) -> Dict[str, Any]:
        """Decrypt dashboard data using Fernet"""
        try:
            key = self.derive_key_from_user_id(user_id)
            fernet = Fernet(key)
            decrypted_data = fernet.decrypt(encrypted_data)
            dashboard_data = json.loads(decrypted_data.decode('utf-8'))
            logger.info(f"✅ Decrypted dashboard data: {len(encrypted_data)} bytes")
            return dashboard_data
        except Exception as e:
            logger.error(f"❌ Error decrypting dashboard data: {str(e)}")
            raise
    
    def import_from_file(self, file_content: bytes, importing_user_id: str, original_user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Import dashboard from file content
        
        Args:
            file_content: The encrypted .cosine file content
            importing_user_id: User ID of the user importing the dashboard
            original_user_id: Optional original user ID (if known, for decryption)
        
        Returns:
            Dict with 'success', 'dashboard_data' or 'error'
        """
        try:
            # Try to decrypt with importing user's key first (in case it was exported by them)
            try:
                dashboard_data = self.decrypt_dashboard_data(importing_user_id, file_content)
                logger.info(f"✅ Decrypted with importing user's key")
            except Exception as e1:
                logger.info(f"Failed to decrypt with importing user's key: {str(e1)}")
                
                # If original_user_id is provided, try with that
                if original_user_id and original_user_id != importing_user_id:
                    try:
                        key = self.derive_key_from_user_id(original_user_id)
                        fernet = Fernet(key)
                        decrypted_data = fernet.decrypt(file_content)
                        dashboard_data = json.loads(decrypted_data.decode('utf-8'))
                        logger.info(f"✅ Decrypted with original user's key")
                    except Exception as e2:
                        logger.error(f"❌ Failed to decrypt with original user's key: {str(e2)}")
                        return {
                            'success': False,
                            'error': 'Failed to decrypt dashboard file. The file may be corrupted or encrypted with a different key.'
                        }
                else:
                    return {
                        'success': False,
                        'error': 'Failed to decrypt dashboard file. The file may be corrupted or encrypted with a different key.'
                    }
            
            # Validate dashboard data structure
            if not self.validate_dashboard_data(dashboard_data):
                return {
                    'success': False,
                    'error': 'Invalid dashboard data structure'
                }
            
            return {
                'success': True,
                'dashboard_data': dashboard_data
            }
            
        except Exception as e:
            logger.error(f"❌ Error importing dashboard from file: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': f'Failed to import dashboard: {str(e)}'
            }
    
    def import_from_share_link(self, share_id: str, importing_user_id: str) -> Dict[str, Any]:
        """
        Import dashboard from share link (share_id)
        
        Args:
            share_id: The share ID from the share link
            importing_user_id: User ID of the user importing the dashboard
        
        Returns:
            Dict with 'success', 'dashboard_data' or 'error'
        """
        try:
            s3_key = f"shared/dashboards/{share_id}{CONTEXT_ITEM_EXTENSION}"
            
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
            
            # Decrypt using original user's key
            try:
                key = self.derive_key_from_user_id(original_user_id)
                fernet = Fernet(key)
                decrypted_data = fernet.decrypt(encrypted_data)
                dashboard_data = json.loads(decrypted_data.decode('utf-8'))
                logger.info(f"✅ Retrieved and decrypted shared dashboard: {share_id}")
            except Exception as e:
                logger.error(f"❌ Error decrypting shared dashboard: {str(e)}")
                return {
                    'success': False,
                    'error': 'Failed to decrypt shared dashboard'
                }
            
            # Validate dashboard data structure
            if not self.validate_dashboard_data(dashboard_data):
                return {
                    'success': False,
                    'error': 'Invalid dashboard data structure'
                }
            
            return {
                'success': True,
                'dashboard_data': dashboard_data,
                'metadata': metadata
            }
            
        except Exception as e:
            logger.error(f"❌ Error importing dashboard from share link: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': f'Failed to import dashboard from share link: {str(e)}'
            }
    
    def validate_dashboard_data(self, dashboard_data: Dict[str, Any]) -> bool:
        """
        Validate that the dashboard data has the correct structure
        
        Args:
            dashboard_data: The decrypted dashboard data
        
        Returns:
            True if valid, False otherwise
        """
        try:
            # Check for required top-level fields
            if not isinstance(dashboard_data, dict):
                return False
            
            if dashboard_data.get('type') != 'dashboard':
                logger.warning(f"Dashboard type is not 'dashboard': {dashboard_data.get('type')}")
                # Allow it to continue - might be from older version
            
            # Check for tab data
            tab_data = dashboard_data.get('tab')
            if not tab_data:
                logger.error("Missing 'tab' field in dashboard data")
                return False
            
            # Validate tab structure
            if not isinstance(tab_data, dict):
                return False
            
            # Tab should have at least a name
            if 'name' not in tab_data:
                logger.error("Missing 'name' field in tab data")
                return False
            
            # Tiles should be a list (can be empty)
            if 'tiles' not in tab_data:
                tab_data['tiles'] = []
            
            if not isinstance(tab_data.get('tiles'), list):
                return False
            
            return True
            
        except Exception as e:
            logger.error(f"Error validating dashboard data: {str(e)}")
            return False
    
    def prepare_imported_tab(self, dashboard_data: Dict[str, Any], importing_user_id: str) -> Dict[str, Any]:
        """
        Prepare imported tab data for insertion into user's dashboard
        
        Args:
            dashboard_data: The decrypted dashboard data
            importing_user_id: User ID of the user importing the dashboard
        
        Returns:
            Prepared tab data ready for insertion
        """
        from datetime import datetime
        import uuid
        
        tab_data = dashboard_data.get('tab', {})
        
        # Create new tab with imported data
        imported_tab = {
            'id': str(uuid.uuid4()),  # Generate new ID for imported tab
            'name': tab_data.get('name', 'Imported Dashboard'),
            'color': tab_data.get('color', '#3b82f6'),
            'isPinned': tab_data.get('isPinned', False),
            'layout': tab_data.get('layout', 'grid'),
            'tiles': tab_data.get('tiles', []),
            'created_at': datetime.utcnow().isoformat(),
            'updated_at': datetime.utcnow().isoformat()
        }
        
        # Clean up tiles - ensure they have proper structure
        # Remove any runtime-specific data that shouldn't be imported
        cleaned_tiles = []
        for tile in imported_tab.get('tiles', []):
            # Generate new IDs for tiles to avoid conflicts
            if 'id' in tile:
                tile['id'] = str(uuid.uuid4())
            
            # Remove any runtime state that shouldn't be persisted
            clean_tile = {k: v for k, v in tile.items() 
                         if k not in ['articles', 'trades', 'portfolioData']}  # Keep paginationState, searchParams, etc.
            cleaned_tiles.append(clean_tile)
        
        imported_tab['tiles'] = cleaned_tiles
        
        return imported_tab

