"""
Decryption Helper
Utility for decrypting .cosine encrypted context items from the filesystem.
Follows the same pattern as the file_return lambda function.
"""

import json
import os
import logging
import base64
import hashlib
from typing import Dict, Any
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# Configure logging
logger = logging.getLogger(__name__)

# Environment variable for encryption secret
ENCRYPTION_SECRET = os.environ.get('ENCRYPTION_SECRET', 'default-secret-change-in-production')


def derive_key_from_user_id(user_id: str) -> bytes:
    """
    Derive encryption key from user ID using PBKDF2.
    Matches the implementation in file_return lambda.
    
    Args:
        user_id: The user ID to derive the key for
        
    Returns:
        bytes: The derived encryption key (base64-encoded)
    """
    salt = hashlib.sha256(f"{ENCRYPTION_SECRET}{user_id}".encode()).digest()[:16]
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(f"{user_id}{ENCRYPTION_SECRET}".encode()))
    return key


def derive_key_from_user_id_with_secret(user_id: str, encryption_secret: str) -> bytes:
    """
    Derive encryption key from user ID using PBKDF2 with a specific secret.
    Used for fallback decryption with default secret.
    
    Args:
        user_id: The user ID to derive the key for
        encryption_secret: The encryption secret to use
        
    Returns:
        bytes: The derived encryption key (base64-encoded)
    """
    salt = hashlib.sha256(f"{encryption_secret}{user_id}".encode()).digest()[:16]
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(f"{user_id}{encryption_secret}".encode()))
    return key


def decrypt_context_data(user_id: str, encrypted_data: bytes) -> Dict[str, Any]:
    """
    Decrypt context data using Fernet with fallback to default secret.
    Matches the implementation in file_return lambda.
    
    Args:
        user_id: The user ID that owns the encrypted data
        encrypted_data: The encrypted bytes to decrypt
        
    Returns:
        Dict[str, Any]: The decrypted context data as a dictionary
        
    Raises:
        ValueError: If decryption fails with both current and default secrets
    """
    # Try with current ENCRYPTION_SECRET first
    try:
        logger.debug(f"🔐 Starting decryption for user {user_id}, data length: {len(encrypted_data)} bytes")
        key = derive_key_from_user_id(user_id)
        logger.debug(f"🔐 Derived key length: {len(key)} bytes")
        fernet = Fernet(key)
        logger.debug(f"🔐 Attempting Fernet decryption with current secret...")
        decrypted_data = fernet.decrypt(encrypted_data)
        logger.debug(f"🔐 Decrypted data length: {len(decrypted_data)} bytes")
        json_data = json.loads(decrypted_data.decode('utf-8'))
        logger.debug(f"🔐 Successfully parsed JSON, keys: {list(json_data.keys()) if isinstance(json_data, dict) else 'N/A'}")
        return json_data
    except InvalidToken:
        # If decryption fails, try with default secret (for files encrypted before secret was set)
        logger.warning(f"⚠️ Decryption failed with current secret, trying default secret...")
        try:
            default_secret = 'default-secret-change-in-production'
            key = derive_key_from_user_id_with_secret(user_id, default_secret)
            fernet = Fernet(key)
            logger.debug(f"🔐 Attempting Fernet decryption with default secret...")
            decrypted_data = fernet.decrypt(encrypted_data)
            logger.warning(f"⚠️ Successfully decrypted with default secret - file should be re-encrypted with current secret")
            json_data = json.loads(decrypted_data.decode('utf-8'))
            return json_data
        except InvalidToken:
            logger.error(f"❌ Decryption failed with both current and default secrets")
            raise ValueError("Failed to decrypt: File was encrypted with a different secret. Please re-save the file.")
    except Exception as e:
        logger.error(f"❌ Error decrypting context data: {str(e)}")
        logger.error(f"❌ Exception type: {type(e).__name__}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        raise


def decrypt_cosine_file(user_id: str, encrypted_data: bytes) -> Dict[str, Any]:
    """
    Convenience wrapper for decrypting .cosine files.
    This is the main function to use when decrypting files from S3.
    
    Args:
        user_id: The user ID that owns the encrypted file
        encrypted_data: The encrypted bytes from the .cosine file
        
    Returns:
        Dict[str, Any]: The decrypted context data
        
    Raises:
        ValueError: If decryption fails
    """
    return decrypt_context_data(user_id, encrypted_data)



