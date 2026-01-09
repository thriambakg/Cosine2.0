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

def set_kill_flag(session_id: str, reason: str = 'user_cancellation'):
    """
    Set kill flag for a session in DynamoDB (persistent across Lambda instances)
    
    Args:
        session_id: Session ID
        reason: Reason for kill signal
    """
    try:
        table = _get_sessions_table()
        if not table:
            logger.error("Cannot set kill flag: sessions table not available")
            return
        
        # Store kill flag in session_variables with a timestamp
        current_time = int(time.time() * 1000)  # Milliseconds
        try:
            # Try to update the session if it exists
            # If session doesn't exist, that's okay - the kill flag will be checked when processing starts
            response = table.get_item(Key={'session_id': session_id})
            if 'Item' in response:
                # Session exists, update it with kill flag
                table.update_item(
                    Key={'session_id': session_id},
                    UpdateExpression='SET session_variables.kill_signal = :kill_flag, session_variables.kill_signal_reason = :reason, session_variables.kill_signal_timestamp = :timestamp',
                    ExpressionAttributeValues={
                        ':kill_flag': True,
                        ':reason': reason,
                        ':timestamp': current_time
                    },
                    ReturnValues='NONE'
                )
                logger.info(f"🔴 KILL SIGNAL: Set kill flag in DynamoDB for session {session_id}, reason: {reason}")
            else:
                # Session doesn't exist yet - log a warning
                # The processing Lambda will check DynamoDB when it starts, so if kill signal arrives
                # after processing starts, the check_kill_signal thread will detect it
                logger.warning(f"⚠️ KILL SIGNAL: Session {session_id} doesn't exist yet. Kill signal will be checked when processing starts or during periodic checks")
        except Exception as e:
            logger.error(f"❌ Failed to set kill flag in DynamoDB: {str(e)}")
        
        # Update local cache immediately
        with _cache_lock:
            _local_cache[session_id] = (True, time.time())
    
    except Exception as e:
        logger.error(f"❌ Error setting kill flag in DynamoDB: {str(e)}")

def clear_kill_flag(session_id: str):
    """
    Clear kill flag for a session in DynamoDB
    
    Args:
        session_id: Session ID
    """
    try:
        table = _get_sessions_table()
        if not table:
            logger.error("Cannot clear kill flag: sessions table not available")
            return
        
        # Remove kill flag from session_variables
        try:
            table.update_item(
                Key={'session_id': session_id},
                UpdateExpression='REMOVE session_variables.kill_signal, session_variables.kill_signal_reason, session_variables.kill_signal_timestamp',
                ReturnValues='NONE'
            )
            logger.debug(f"Cleared kill flag in DynamoDB for session {session_id}")
        except table.meta.client.exceptions.ResourceNotFoundException:
            # Session doesn't exist, nothing to clear
            logger.debug(f"Session {session_id} doesn't exist, nothing to clear")
        except Exception as e:
            logger.error(f"❌ Failed to clear kill flag in DynamoDB: {str(e)}")
        
        # Update local cache immediately
        with _cache_lock:
            _local_cache[session_id] = (False, time.time())
    
    except Exception as e:
        logger.error(f"❌ Error clearing kill flag in DynamoDB: {str(e)}")

def is_killed(session_id: str) -> bool:
    """
    Check if a session has been killed by checking DynamoDB (with local cache for performance)
    
    Args:
        session_id: Session ID
        
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
    try:
        table = _get_sessions_table()
        if not table:
            logger.warning("Cannot check kill flag: sessions table not available")
            return False
        
        try:
            response = table.get_item(
                Key={'session_id': session_id},
                ProjectionExpression='session_variables.kill_signal'
            )
            
            if 'Item' in response:
                session_vars = response['Item'].get('session_variables', {})
                is_killed_value = session_vars.get('kill_signal', False)
                
                # Update local cache
                with _cache_lock:
                    _local_cache[session_id] = (is_killed_value, time.time())
                
                return bool(is_killed_value)
            
            # Session doesn't exist, no kill flag
            return False
        
        except Exception as e:
            logger.error(f"❌ Error checking kill flag in DynamoDB: {str(e)}")
            return False
    
    except Exception as e:
        logger.error(f"❌ Error checking kill flag: {str(e)}")
        return False

def remove_kill_flag(session_id: str):
    """
    Remove kill flag from registry (cleanup - same as clear_kill_flag)
    
    Args:
        session_id: Session ID
    """
    clear_kill_flag(session_id)


