"""
Dashboard Exporter
Helper class for exporting dashboard configurations to .cosine files
Handles both download (presigned URL) and share link functionality
"""

import json
import os
import uuid
import logging
import boto3
import base64
import hashlib
from datetime import datetime, timedelta
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


class DashboardExporter:
    """
    Exports dashboard configurations to encrypted .cosine files
    Supports both direct download (presigned URL) and share links
    """
    
    def __init__(self):
        self.s3_client = s3_client
        self.bucket_name = CHAT_FILES_BUCKET_NAME
        self.encryption_secret = ENCRYPTION_SECRET
    
    def derive_platform_key(self) -> bytes:
        """Derive platform-wide encryption key from ENCRYPTION_SECRET (not user-specific)
        This allows dashboards to be shared across all users in the platform"""
        # Use a fixed salt for platform-wide encryption
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
        """Derive encryption key from user ID using PBKDF2 (legacy - kept for backward compatibility)"""
        salt = hashlib.sha256(f"{self.encryption_secret}{user_id}".encode()).digest()[:16]
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(f"{user_id}{self.encryption_secret}".encode()))
        return key
    
    def encrypt_dashboard_data(self, user_id: str, dashboard_data: Dict[str, Any]) -> bytes:
        """Encrypt dashboard data using Fernet with platform-wide key (shareable across all users)"""
        try:
            # Use platform-wide key for shareable dashboards
            key = self.derive_platform_key()
            fernet = Fernet(key)
            json_data = json.dumps(dashboard_data, default=str)
            encrypted_data = fernet.encrypt(json_data.encode('utf-8'))
            logger.info(f"✅ Encrypted dashboard data with platform-wide key: {len(encrypted_data)} bytes")
            return encrypted_data
        except Exception as e:
            logger.error(f"❌ Error encrypting dashboard data: {str(e)}")
            raise
    
    def prepare_dashboard_data(self, tab: Dict[str, Any], user_id: str) -> Dict[str, Any]:
        """
        Prepare dashboard data for export
        Extracts only the necessary tab data, excluding runtime state
        """
        # Clean up tab data - remove pagination state, results, etc.
        # Note: portfolioData entries and timeframe should be preserved, but results should be excluded
        clean_tiles = []
        for tile in tab.get('tiles', []):
            clean_tile = {k: v for k, v in tile.items() 
                         if k not in ['paginationState', 'articles', 'trades', 'filers']}
            
            # For portfolio tiles, preserve portfolioData but exclude results (runtime data)
            if 'portfolioData' in tile and isinstance(tile['portfolioData'], dict):
                portfolio_data = tile['portfolioData'].copy()
                # Remove results (computed data) but keep entries and timeframe
                if 'results' in portfolio_data:
                    del portfolio_data['results']
                # Log portfolio data for debugging
                logger.info(f"📊 Exporting portfolio tile {tile.get('id', 'unknown')}: entries={len(portfolio_data.get('entries', []))}, timeframe={portfolio_data.get('timeframe')}")
                clean_tile['portfolioData'] = portfolio_data
            elif tile.get('type') == 'portfolio':
                # Log if portfolio tile is missing portfolioData
                logger.warning(f"⚠️ Portfolio tile {tile.get('id', 'unknown')} is missing portfolioData!")
            
            clean_tiles.append(clean_tile)
        
        dashboard_data = {
            'type': 'dashboard',
            'version': '1.0',
            'tab': {
                'id': tab.get('id'),
                'name': tab.get('name'),
                'color': tab.get('color'),
                'layout': tab.get('layout', 'grid'),
                'tiles': clean_tiles,
            },
            'created_at': datetime.utcnow().isoformat(),
            'created_by': user_id,
        }
        
        return dashboard_data
    
    def export_for_download(self, tab: Dict[str, Any], user_id: str, tab_name: str) -> Dict[str, Any]:
        """
        Export dashboard for direct download
        Returns presigned URL for the encrypted .cosine file
        
        Args:
            tab: The dashboard tab data to export
            user_id: User ID for encryption
            tab_name: Name of the tab (for filename)
            
        Returns:
            Dict with 'success', 'share_id', 'download_url', 'expires_in'
        """
        try:
            # Generate unique share ID
            share_id = str(uuid.uuid4())
            
            # Prepare and encrypt dashboard data
            dashboard_data = self.prepare_dashboard_data(tab, user_id)
            encrypted_data = self.encrypt_dashboard_data(user_id, dashboard_data)
            
            # Store in S3
            s3_key = f"shared/dashboards/{share_id}{CONTEXT_ITEM_EXTENSION}"
            filename = f"{tab_name or 'dashboard'}{CONTEXT_ITEM_EXTENSION}"
            
            # Calculate expiration date (48 hours for downloads)
            # Note: Actual deletion handled by S3 lifecycle rule (7 days for all shared/dashboards/)
            expiration_date = datetime.utcnow() + timedelta(hours=48)
            
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=encrypted_data,
                ContentType='application/octet-stream',
                Metadata={
                    'user_id': user_id,
                    'tab_id': tab.get('id', ''),
                    'tab_name': tab_name or 'Untitled',
                    'created_at': datetime.utcnow().isoformat(),
                    'export_type': 'download',
                    'expires_at': expiration_date.isoformat(),
                }
            )
            logger.info(f"✅ Stored dashboard export in S3: {s3_key}")
            
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
            logger.error(f"❌ Error exporting dashboard for download: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': f'Failed to export dashboard: {str(e)}'
            }
    
    def export_for_share_link(self, tab: Dict[str, Any], user_id: str) -> Dict[str, Any]:
        """
        Export dashboard for share link
        Stores encrypted file in S3 and returns share_id for link generation
        
        Args:
            tab: The dashboard tab data to export
            user_id: User ID for encryption
            
        Returns:
            Dict with 'success', 'share_id'
        """
        try:
            # Generate unique share ID
            share_id = str(uuid.uuid4())
            
            # Prepare and encrypt dashboard data
            dashboard_data = self.prepare_dashboard_data(tab, user_id)
            encrypted_data = self.encrypt_dashboard_data(user_id, dashboard_data)
            
            # Store in S3
            s3_key = f"shared/dashboards/{share_id}{CONTEXT_ITEM_EXTENSION}"
            
            # Calculate expiration date (7 days for share links)
            # Note: Actual deletion handled by S3 lifecycle rule (7 days for all shared/dashboards/)
            expiration_date = datetime.utcnow() + timedelta(days=7)
            
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=encrypted_data,
                ContentType='application/octet-stream',
                Metadata={
                    'user_id': user_id,
                    'tab_id': tab.get('id', ''),
                    'tab_name': tab.get('name', 'Untitled'),
                    'created_at': datetime.utcnow().isoformat(),
                    'export_type': 'share_link',
                    'expires_at': expiration_date.isoformat(),
                }
            )
            logger.info(f"✅ Stored dashboard export in S3 for sharing: {s3_key}")
            
            return {
                'success': True,
                'share_id': share_id,
            }
            
        except Exception as e:
            logger.error(f"❌ Error exporting dashboard for share link: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': f'Failed to export dashboard: {str(e)}'
            }
    
    def get_shared_dashboard(self, share_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Retrieve and decrypt a shared dashboard
        Used when someone accesses a share link
        
        Args:
            share_id: The share ID from the URL
            user_id: Optional user ID (if the dashboard was encrypted with user-specific key)
                    For now, we'll need to store the original user_id in metadata
        
        Returns:
            Dict with 'success', 'dashboard_data' or 'error'
        """
        try:
            s3_key = f"shared/dashboards/{share_id}{CONTEXT_ITEM_EXTENSION}"
            
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
            
            # Decrypt using platform-wide key (dashboards are shareable across all users)
            key = self.derive_platform_key()
            fernet = Fernet(key)
            decrypted_data = fernet.decrypt(encrypted_data)
            dashboard_data = json.loads(decrypted_data.decode('utf-8'))
            
            logger.info(f"✅ Retrieved and decrypted shared dashboard with platform-wide key: {share_id}")
            
            return {
                'success': True,
                'dashboard_data': dashboard_data,
                'metadata': metadata,
            }
            
        except Exception as e:
            logger.error(f"❌ Error retrieving shared dashboard: {str(e)}", exc_info=True)
            return {
                'success': False,
                'error': f'Failed to retrieve shared dashboard: {str(e)}'
            }

