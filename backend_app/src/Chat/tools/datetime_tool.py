"""
DateTime tool for getting current date/time and calculating date ranges
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import sys
import os

# Add parent directory to path for imports
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

# Configure logging
logger = logging.getLogger(__name__)

# Import agent_logger for WebSocket streaming
try:
    from agent_logger import get_agent_logger
    agent_logger = get_agent_logger()
except:
    agent_logger = logger

# Import Strands tool decorator
try:
    from strands import tool
except ImportError as e:
    logger.warning(f"Could not import Strands tool decorator: {e}")
    # Fallback decorator for local development
    def tool(func):
        return func


@tool
def get_current_datetime(format: str = "iso") -> str:
    """
    Get the current date and time at the time of execution.
    
    Args:
        format: Output format:
            - "iso": ISO 8601 format (YYYY-MM-DDTHH:MM:SS) - default
            - "date": Date only (YYYY-MM-DD)
            - "datetime": Full datetime string (YYYY-MM-DD HH:MM:SS)
            - "timestamp": Unix timestamp (seconds since epoch)
            - "json": JSON object with date, time, and timestamp
    
    Returns:
        Current date/time in the specified format
        
    Example:
        get_current_datetime("date")  # Returns "2024-12-15"
        get_current_datetime("iso")   # Returns "2024-12-15T21:42:38"
    """
    try:
        now = datetime.now()
        
        if format == "iso":
            return now.strftime('%Y-%m-%dT%H:%M:%S')
        elif format == "date":
            return now.strftime('%Y-%m-%d')
        elif format == "datetime":
            return now.strftime('%Y-%m-%d %H:%M:%S')
        elif format == "timestamp":
            return str(int(now.timestamp()))
        elif format == "json":
            return json.dumps({
                "date": now.strftime('%Y-%m-%d'),
                "time": now.strftime('%H:%M:%S'),
                "datetime": now.strftime('%Y-%m-%d %H:%M:%S'),
                "iso": now.strftime('%Y-%m-%dT%H:%M:%S'),
                "timestamp": int(now.timestamp()),
                "year": now.year,
                "month": now.month,
                "day": now.day,
                "hour": now.hour,
                "minute": now.minute,
                "second": now.second
            })
        else:
            return now.strftime('%Y-%m-%dT%H:%M:%S')  # Default to ISO
            
    except Exception as e:
        logger.error(f"Error getting current datetime: {str(e)}")
        return json.dumps({"error": str(e)})


@tool
def calculate_date_range(
    start_offset_days: Optional[int] = None,
    end_offset_days: Optional[int] = None,
    months_ago: Optional[int] = None,
    days_ago: Optional[int] = None,
    format: str = "date"
) -> str:
    """
    Calculate date ranges relative to the current date/time.
    Useful for queries like "past 2 months" or "last 30 days".
    
    Args:
        start_offset_days: Number of days before today for start date (negative for past)
        end_offset_days: Number of days before today for end date (negative for past, None for today)
        months_ago: Number of months ago for start date (e.g., 2 for "past 2 months")
        days_ago: Number of days ago for start date (e.g., 30 for "past 30 days")
        format: Output format ("date" for YYYY-MM-DD, "iso" for ISO 8601, "json" for JSON object)
    
    Returns:
        Date range in the specified format
        
    Examples:
        calculate_date_range(months_ago=2)  # Returns start date 2 months ago, end date today
        calculate_date_range(days_ago=30)   # Returns start date 30 days ago, end date today
        calculate_date_range(start_offset_days=-60, end_offset_days=0)  # 60 days ago to today
    """
    try:
        now = datetime.now()
        
        # Calculate start date
        if months_ago is not None:
            # Calculate months ago (approximate - uses 30 days per month)
            start_date = now - timedelta(days=months_ago * 30)
        elif days_ago is not None:
            start_date = now - timedelta(days=days_ago)
        elif start_offset_days is not None:
            start_date = now + timedelta(days=start_offset_days)
        else:
            start_date = now  # Default to today
        
        # Calculate end date
        if end_offset_days is not None:
            end_date = now + timedelta(days=end_offset_days)
        else:
            end_date = now  # Default to today
        
        # Format output
        if format == "json":
            return json.dumps({
                "start_date": start_date.strftime('%Y-%m-%d'),
                "end_date": end_date.strftime('%Y-%m-%d'),
                "start_datetime": start_date.strftime('%Y-%m-%dT%H:%M:%S'),
                "end_datetime": end_date.strftime('%Y-%m-%dT%H:%M:%S'),
                "start_timestamp": int(start_date.timestamp()),
                "end_timestamp": int(end_date.timestamp()),
                "days_span": (end_date - start_date).days
            })
        elif format == "iso":
            return json.dumps({
                "start_date": start_date.strftime('%Y-%m-%dT%H:%M:%S'),
                "end_date": end_date.strftime('%Y-%m-%dT%H:%M:%S')
            })
        else:  # Default to date format
            return json.dumps({
                "start_date": start_date.strftime('%Y-%m-%d'),
                "end_date": end_date.strftime('%Y-%m-%d')
            })
            
    except Exception as e:
        logger.error(f"Error calculating date range: {str(e)}")
        return json.dumps({"error": str(e)})










