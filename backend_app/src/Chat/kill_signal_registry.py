"""
Shared kill signal registry for real-time kill signal handling
Uses DynamoDB to store kill flags so all Lambda instances can share state
Allows WebSocket handler to set kill flags that agent processes can check immediately
"""
import os
import threading
import time
import boto3
from typing import Dict, Optional
from decimal import Decimal
import logging

logger = logging.getLogger(__name__)

# Initialize DynamoDB resource
dynamodb = boto3.resource('dynamodb')
# Use the same sessions table to store kill flags (in session_variables)
# This ensures kill flags are accessible across all Lambda instances

# Local in-memory cache for faster checks (with TTL to prevent stale data)
_local_cache: Dict[str, tuple] = {}  # session_id -> (is_killed: bool, timestamp: float)
_cache_ttl = 0.2  # Cache for 200ms before checking DynamoDB again (more frequent checks for faster kill signal detection)
_cache_lock = threading.Lock()

def _get_sessions_table():
    """Get the sessions DynamoDB table"""
    table_name = os.environ.get('CHAT_SESSIONS_TABLE_NAME')
    if not table_name:
        logger.error("CHAT_SESSIONS_TABLE_NAME environment variable not set")
        return None
    return dynamodb.Table(table_name)

def get_kill_flag(session_id: str) -> threading.Event:
    """
    Get or create a kill flag Event for a session (local thread-safe event)
    Note: This is now just a local wrapper - the actual kill state is stored in DynamoDB
    
    Args:
        session_id: Session ID
        
    Returns:
        threading.Event that can be checked against DynamoDB state
    """
    # Return a threading.Event that will be set based on DynamoDB state
    return threading.Event()

def set_kill_flag(session_id: str, user_id: str, reason: str = 'user_cancellation'):
    """
    Set kill flag for a session in DynamoDB (persistent across Lambda instances)
    Uses dedicated 'kill' column instead of session_variables
    
    Args:
        session_id: Session ID
        user_id: User ID (required for composite key)
        reason: Reason for kill signal
    """
    try:
        table = _get_sessions_table()
        if not table:
            logger.error("Cannot set kill flag: sessions table not available")
            return
        
        if not user_id:
            logger.error("Cannot set kill flag: user_id is required for composite key")
            return
        
        # Store kill flag in dedicated 'kill' column
        current_time = int(time.time() * 1000)  # Milliseconds
        from botocore.exceptions import ClientError
        
        try:
            # First, check if the session exists
            response = table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            if 'Item' in response:
                # Session exists, update it with kill flag in dedicated column
                # Use update_item with SET - DynamoDB will add the attribute if it doesn't exist
                table.update_item(
                    Key={
                        'user_id': user_id,
                        'session_id': session_id
                    },
                    UpdateExpression='SET #kill = :kill_flag, last_updated = :timestamp',
                    ExpressionAttributeNames={
                        '#kill': 'kill'  # 'kill' is a reserved word, so use ExpressionAttributeNames
                    },
                    ExpressionAttributeValues={
                        ':kill_flag': True,
                        ':timestamp': current_time
                    },
                    ReturnValues='NONE'
                )
                logger.info(f"🔴 KILL SIGNAL: Set kill flag in DynamoDB for session {session_id} (user: {user_id}), reason: {reason}")
                
                # Verify the kill flag was actually set by reading it back
                try:
                    verify_response = table.get_item(
                        Key={
                            'user_id': user_id,
                            'session_id': session_id
                        }
                    )
                    if 'Item' in verify_response and verify_response['Item'].get('kill') == True:
                        logger.info(f"✅ KILL SIGNAL: Verified kill flag is set in DynamoDB for session {session_id} (user: {user_id})")
                    else:
                        logger.warning(f"⚠️ KILL SIGNAL: Kill flag may not have been set correctly for session {session_id} (user: {user_id}). Item exists but kill attribute missing or False.")
                except Exception as verify_error:
                    logger.warning(f"⚠️ KILL SIGNAL: Could not verify kill flag was set: {str(verify_error)}")
            else:
                # Session doesn't exist yet - try to create a minimal entry with kill flag
                # This allows kill signals to work even before session is fully created
                logger.info(f"⚠️ KILL SIGNAL: Session {session_id} doesn't exist, creating minimal entry with kill flag")
                try:
                    table.put_item(
                        Item={
                            'user_id': user_id,
                            'session_id': session_id,
                            'kill': True,
                            'created_at': current_time,
                            'last_updated': current_time,
                            'message_count': 0,
                            'messages': []
                        }
                    )
                    logger.info(f"🔴 KILL SIGNAL: Created session entry with kill flag for session {session_id} (user: {user_id}), reason: {reason}")
                except Exception as put_error:
                    logger.warning(f"⚠️ KILL SIGNAL: Session {session_id} doesn't exist and couldn't create minimal entry. Kill signal will be checked when processing starts. Error: {str(put_error)}")
                    
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', '')
            logger.error(f"❌ Failed to set kill flag in DynamoDB: {str(e)}, Error Code: {error_code}")
        except Exception as e:
            logger.error(f"❌ Failed to set kill flag in DynamoDB: {str(e)}")
        
        # Update local cache immediately (use session_id as key)
        with _cache_lock:
            _local_cache[session_id] = (True, time.time())
    
    except Exception as e:
        logger.error(f"❌ Error setting kill flag in DynamoDB: {str(e)}")

def clear_kill_flag(session_id: str, user_id: str = None):
    """
    Clear kill flag for a session in DynamoDB
    Uses dedicated 'kill' column
    
    Args:
        session_id: Session ID
        user_id: User ID (required for composite key, optional for backward compatibility)
    """
    try:
        table = _get_sessions_table()
        if not table:
            logger.error("Cannot clear kill flag: sessions table not available")
            return
        
        if not user_id:
            logger.warning(f"Cannot clear kill flag: user_id is required for composite key. Session: {session_id}")
            return
        
        # Remove kill flag from dedicated 'kill' column
        try:
            table.update_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                },
                UpdateExpression='REMOVE #kill',
                ExpressionAttributeNames={
                    '#kill': 'kill'  # 'kill' is a reserved word
                },
                ReturnValues='NONE'
            )
            logger.debug(f"Cleared kill flag in DynamoDB for session {session_id} (user: {user_id})")
        except table.meta.client.exceptions.ResourceNotFoundException:
            # Session doesn't exist, nothing to clear
            logger.debug(f"Session {session_id} (user: {user_id}) doesn't exist, nothing to clear")
        except Exception as e:
            logger.error(f"❌ Failed to clear kill flag in DynamoDB: {str(e)}")
        
        # Update local cache immediately
        with _cache_lock:
            _local_cache[session_id] = (False, time.time())
    
    except Exception as e:
        logger.error(f"❌ Error clearing kill flag in DynamoDB: {str(e)}")

def is_killed(session_id: str, user_id: str = None) -> bool:
    """
    Check if a session has been killed by checking DynamoDB (with local cache for performance)
    Uses dedicated 'kill' column and composite key (user_id, session_id)
    
    Args:
        session_id: Session ID
        user_id: User ID (required for composite key, optional for backward compatibility)
        
    Returns:
        True if kill flag is set, False otherwise
    """
    # Check local cache first (fast path)
    with _cache_lock:
        if session_id in _local_cache:
            cached_value, cache_time = _local_cache[session_id]
            # Use cached value if it's fresh (within TTL)
            if time.time() - cache_time < _cache_ttl:
                return cached_value
            # Cache is stale, remove it and check DynamoDB
            del _local_cache[session_id]
    
    # Check DynamoDB (slower but accurate)
    # If user_id is not provided, we can't check DynamoDB (composite key required)
    if not user_id:
        logger.warning(f"Cannot check kill flag: user_id is required for composite key. Session: {session_id}")
        return False
    
    try:
        table = _get_sessions_table()
        if not table:
            logger.warning("Cannot check kill flag: sessions table not available")
            return False
        
        try:
            # Use composite key: user_id (partition key) and session_id (sort key)
            # Don't use ProjectionExpression - get full item to check if kill attribute exists
            # ProjectionExpression can cause issues if the attribute doesn't exist yet
            response = table.get_item(
                Key={
                    'user_id': user_id,
                    'session_id': session_id
                }
            )
            
            if 'Item' in response:
                # Check dedicated 'kill' column
                # DynamoDB returns boolean as Decimal, so handle that case
                kill_value = response['Item'].get('kill', False)
                
                # Convert Decimal to bool if needed (DynamoDB stores numbers as Decimal)
                if isinstance(kill_value, bool):
                    is_killed_value = kill_value
                elif hasattr(kill_value, '__bool__'):
                    is_killed_value = bool(kill_value)
                else:
                    is_killed_value = False
                
                # Update local cache
                with _cache_lock:
                    _local_cache[session_id] = (is_killed_value, time.time())
                
                return is_killed_value
            
            # Session doesn't exist, no kill flag
            return False
        
        except Exception as e:
            logger.error(f"❌ Error checking kill flag in DynamoDB: {str(e)}")
            return False
    
    except Exception as e:
        logger.error(f"❌ Error checking kill flag: {str(e)}")
        return False

def remove_kill_flag(session_id: str, user_id: str = None):
    """
    Remove kill flag from registry (cleanup - same as clear_kill_flag)
    
    Args:
        session_id: Session ID
        user_id: User ID (required for composite key, optional for backward compatibility)
    """
    clear_kill_flag(session_id, user_id)


