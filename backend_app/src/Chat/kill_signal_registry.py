"""
Shared kill signal registry for real-time kill signal handling
Allows WebSocket handler to set kill flags that agent processes can check immediately
"""
import threading
from typing import Dict, Optional
import logging

logger = logging.getLogger(__name__)

# Global registry: session_id -> threading.Event
_kill_signal_registry: Dict[str, threading.Event] = {}
_registry_lock = threading.Lock()

def get_kill_flag(session_id: str) -> threading.Event:
    """
    Get or create a kill flag Event for a session
    
    Args:
        session_id: Session ID
        
    Returns:
        threading.Event that can be set to signal kill
    """
    with _registry_lock:
        if session_id not in _kill_signal_registry:
            _kill_signal_registry[session_id] = threading.Event()
            logger.debug(f"Created kill flag for session {session_id}")
        return _kill_signal_registry[session_id]

def set_kill_flag(session_id: str, reason: str = 'user_cancellation'):
    """
    Set kill flag for a session (called by WebSocket handler when kill signal received)
    
    Args:
        session_id: Session ID
        reason: Reason for kill signal
    """
    with _registry_lock:
        kill_flag = get_kill_flag(session_id)
        if not kill_flag.is_set():
            kill_flag.set()
            logger.info(f"🔴 KILL SIGNAL: Set kill flag for session {session_id}, reason: {reason}")
        else:
            logger.debug(f"Kill flag already set for session {session_id}")

def clear_kill_flag(session_id: str):
    """
    Clear kill flag for a session (called when processing completes or session resets)
    
    Args:
        session_id: Session ID
    """
    with _registry_lock:
        if session_id in _kill_signal_registry:
            _kill_signal_registry[session_id].clear()
            logger.debug(f"Cleared kill flag for session {session_id}")

def is_killed(session_id: str) -> bool:
    """
    Check if a session has been killed
    
    Args:
        session_id: Session ID
        
    Returns:
        True if kill flag is set, False otherwise
    """
    with _registry_lock:
        if session_id in _kill_signal_registry:
            return _kill_signal_registry[session_id].is_set()
        return False

def remove_kill_flag(session_id: str):
    """
    Remove kill flag from registry (cleanup)
    
    Args:
        session_id: Session ID
    """
    with _registry_lock:
        if session_id in _kill_signal_registry:
            del _kill_signal_registry[session_id]
            logger.debug(f"Removed kill flag for session {session_id}")


