"""
LDA Autocomplete tool for the chat agent
Provides autocomplete suggestions for LDA search fields (registrant, client, lobbyist, PAC, foreign entities)
Reads from TXT files to preserve commas and special characters as they come from the API
"""

import json
import os
import logging
import boto3
import bisect
from typing import Dict, List, Any, Optional
import sys

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

# AWS clients
s3_client = boto3.client('s3')

# Environment variables
S3_BUCKET_NAME = os.environ.get('LDA_DISCLOSURES_S3_BUCKET_NAME') or os.environ.get('S3_BUCKET_NAME')
if not S3_BUCKET_NAME:
    raise ValueError("LDA_DISCLOSURES_S3_BUCKET_NAME or S3_BUCKET_NAME environment variable is required")
S3_PREFIX = os.environ.get('S3_PREFIX', 'lists/')

# Field type to S3 key mapping
FIELD_TYPE_TO_S3_KEY = {
    'registrant': f'{S3_PREFIX}registrant_names.txt',
    'client': f'{S3_PREFIX}client_names.txt',
    'lobbyist': f'{S3_PREFIX}lobbyist_names.txt',
    'pac': f'{S3_PREFIX}pacs.txt',
    'foreign': f'{S3_PREFIX}countries.txt',
    'country': f'{S3_PREFIX}countries.txt',
}

# Cache for TXT file data (in-memory, per Lambda instance)
_txt_cache: Dict[str, List[str]] = {}


def load_txt_from_s3(field_type: str) -> List[str]:
    """
    Load TXT file from S3 and return list of values (one value per line)
    Preserves commas and special characters as they come from the API
    
    Args:
        field_type: Type of field (e.g., 'registrant', 'client', 'lobbyist')
    
    Returns:
        List of values from TXT file
    """
    # Check cache first
    if field_type in _txt_cache:
        return _txt_cache[field_type]
    
    s3_key = FIELD_TYPE_TO_S3_KEY.get(field_type)
    if not s3_key:
        logger.warning(f"Unknown field type: {field_type}")
        return []
    
    try:
        logger.info(f"Loading TXT file from s3://{S3_BUCKET_NAME}/{s3_key} for field_type={field_type}")
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        content = response['Body'].read().decode('utf-8')
        
        # Handle TXT files - one value per line
        # Format: one name per line, preserves commas and special characters
        values = []
        lines = content.split('\n')
        
        for line in lines:
            line = line.strip()
            # Skip empty lines and header lines (if present)
            if line and line.lower() not in ['value', field_type]:
                values.append(line)
        
        # Cache the results
        _txt_cache[field_type] = values
        
        logger.info(f"Loaded {len(values)} values from s3://{S3_BUCKET_NAME}/{s3_key} (processed {len(lines)} lines)")
        return values
        
    except s3_client.exceptions.NoSuchKey:
        logger.warning(f"File not found: s3://{S3_BUCKET_NAME}/{s3_key}")
        return []
    except Exception as e:
        logger.error(f"Error loading file from S3 ({s3_key}): {str(e)}", exc_info=True)
        return []


def search_txt_values(values: List[str], query: str, limit: int = 20) -> List[str]:
    """
    Search TXT file values for matches using tiered approach (exact -> starts with -> contains)
    Uses binary search for "starts with" matches since data is sorted alphabetically
    
    Args:
        values: List of sorted values to search
        query: Search query
        limit: Maximum number of results
    
    Returns:
        List of matching values in priority order
    """
    if not query:
        return values[:limit]
    
    query_lower = query.lower().strip()
    if not query_lower:
        return values[:limit]
    
    # Tiered search results
    exact_matches = []
    starts_with_matches = []
    contains_matches = []
    
    # Use binary search for "starts with" matches (data is sorted alphabetically)
    # Only use binary search for larger lists to avoid overhead
    if len(values) > 100:
        # Create lowercase version for binary search
        lower_values = [v.lower() for v in values]
        
        # Find the insertion point where query would be inserted
        # This gives us the start of values that start with query
        left = bisect.bisect_left(lower_values, query_lower)
        
        # Find the end of the range: increment last character to get upper bound
        if query_lower:
            # Create upper bound by incrementing last character
            query_chars = list(query_lower)
            if query_chars:
                query_chars[-1] = chr(ord(query_chars[-1]) + 1)
                query_upper = ''.join(query_chars)
            else:
                query_upper = query_lower + 'z'
        else:
            query_upper = query_lower + 'z'
        
        right = bisect.bisect_left(lower_values, query_upper)
        
        # Check all values in the range for exact matches and starts_with
        for i in range(left, min(right, len(values))):
            value = values[i]
            value_lower = lower_values[i]
            
            # Exact match (highest priority)
            if value_lower == query_lower:
                exact_matches.append(value)
            # Starts with (second priority) - verify with startswith to be safe
            elif value_lower.startswith(query_lower):
                starts_with_matches.append(value)
        
        # For "contains" matches, do linear search but exclude items that start with
        # Skip the range we already checked for starts_with, but also verify
        for i, value in enumerate(values):
            value_lower = lower_values[i]
            
            # Skip if already matched in starts_with range (left <= i < right)
            # This ensures contains matches don't include items that start with
            if left <= i < right:
                continue
            
            # Contains (fallback) - but NOT if it starts with (already handled above)
            # Double-check to ensure contains matches are truly "contains but not starts with"
            if query_lower in value_lower and not value_lower.startswith(query_lower):
                contains_matches.append(value)
    else:
        # For small lists, use linear search (faster due to binary search overhead)
        for value in values:
            value_lower = value.lower()
            
            # Exact match (highest priority)
            if value_lower == query_lower:
                exact_matches.append(value)
            # Starts with (second priority) - but NOT exact (already handled above)
            elif value_lower.startswith(query_lower):
                starts_with_matches.append(value)
            # Contains (fallback) - but NOT if it starts with (already handled above)
            # Double-check to ensure contains matches are truly "contains but not starts with"
            elif query_lower in value_lower and not value_lower.startswith(query_lower):
                contains_matches.append(value)
    
    # Combine results in priority order
    all_matches = exact_matches + starts_with_matches + contains_matches
    
    return all_matches[:limit]


def handle_autocomplete_request(
    field_types: List[str],
    query: str,
    limit: int = 20
) -> Dict[str, Any]:
    """
    Handle autocomplete request for multiple field types
    
    Args:
        field_types: List of field types to search (e.g., ['registrant', 'client'])
        query: Search query
        limit: Maximum number of results to return per field type
    
    Returns:
        Dictionary with autocomplete results grouped by field type
    """
    all_results = {}
    
    for field_type in field_types:
        # Load TXT file for this field type
        values = load_txt_from_s3(field_type)
        
        if not values:
            logger.warning(f"No values loaded for field_type={field_type}")
            all_results[field_type] = []
            continue
        
        logger.info(f"Searching {len(values)} values for field_type={field_type} with query='{query}'")
        
        # Search for matches
        matches = search_txt_values(values, query, limit)
        
        logger.info(f"Found {len(matches)} matches for field_type={field_type}")
        
        # Add field type indicator to results with clear labels
        # Map field types to human-readable descriptions
        type_descriptions = {
            'registrant': 'as a registrant',
            'client': 'as a client',
            'lobbyist': 'as a lobbyist',
            'pac': 'as a PAC',
            'foreign': 'as a foreign entity',
            'country': 'as a country'
        }
        type_description = type_descriptions.get(field_type, f'({field_type})')
        
        all_results[field_type] = [
            {
                'value': match,
                'type': field_type,
                'label': f"{match} {type_description}"
            }
            for match in matches
        ]
    
    # Calculate totals
    total_count = sum(len(results) for results in all_results.values())
    
    return {
        'success': True,
        'results': all_results,
        'total_count': total_count,
        'query': query,
        'field_types': field_types
    }


@tool
def lda_autocomplete(
    query: str,
    field_types: str = None,
    limit: int = 20
) -> str:
    """
    Search for LDA autocomplete suggestions across multiple field types.
    Useful for finding registrants, clients, lobbyists, PACs, or foreign entities.
    
    **CRITICAL: When multiple types have matches, you MUST ask the user to select which one to use.**
    
    Workflow:
    1. User asks for lobbying documents from "Tesla" (or similar generic name)
    2. Call lda_autocomplete("Tesla") to find all matches across all types
    3. If results show matches in multiple types (e.g., client, registrant), you MUST:
       - Present the options clearly: "I found Tesla as both a client and a registrant. Which one would you like to search for?"
       - Wait for user response
       - Use the exact value from the autocomplete results when calling lda_search
    4. If only one type has matches, proceed directly with lda_search using that value
    
    The response includes a "clarification_needed" flag - if True, you MUST ask the user before proceeding.
    
    Args:
        query: Search query (e.g., "Apple", "Microsoft", "John Smith", "Tesla")
        field_types: JSON string or comma-separated string of field types to search.
                    Options: 'registrant', 'client', 'lobbyist', 'pac', 'foreign', 'country'.
                    If not provided, searches all types.
        limit: Maximum number of results per field type (default: 20, max: 50)
    
    Returns:
        JSON string with autocomplete results grouped by field type.
        - Each result has 'value' (exact name to use in lda_search), 'type', and 'label' (e.g., "Tesla as a client")
        - If "clarification_needed": true, you MUST ask the user which type to use
        - Use the exact 'value' from results when calling lda_search
        
    Example:
        # Search for "Tesla" across all types
        result = lda_autocomplete("Tesla")
        # If result shows matches in both 'client' and 'registrant':
        # -> Ask user: "I found Tesla as both a client and a registrant. Which one would you like to search for?"
        # -> Wait for user response
        # -> Use exact value from results: lda_search('{"client_name": "TESLA INC."}') or lda_search('{"registrant_name": "TESLA INC."}')
        
        # Search only registrants and clients
        lda_autocomplete("Apple", '["registrant", "client"]')
        
        # Search with higher limit
        lda_autocomplete("Microsoft", None, 30)
    """
    try:
        agent_logger.info(f"LDA Autocomplete: Searching for '{query}'")
        
        # Parse field_types
        if field_types:
            if isinstance(field_types, str):
                try:
                    # Try JSON first
                    field_types_list = json.loads(field_types)
                except json.JSONDecodeError:
                    # Fall back to comma-separated
                    field_types_list = [ft.strip() for ft in field_types.split(',')]
            else:
                field_types_list = field_types
        else:
            # Default: search all types
            field_types_list = ['registrant', 'client', 'lobbyist', 'pac', 'foreign']
        
        # Validate field types
        valid_field_types = [ft for ft in field_types_list if ft in FIELD_TYPE_TO_S3_KEY]
        if not valid_field_types:
            valid_field_types = ['registrant', 'client', 'lobbyist', 'pac', 'foreign']
        
        # Validate limit
        if limit > 50:
            limit = 50
        if limit < 1:
            limit = 20
        
        # Perform autocomplete search
        result = handle_autocomplete_request(valid_field_types, query, limit)
        
        # Format response for agent
        response = {
            "success": True,
            "query": query,
            "results_by_type": result['results'],
            "total_matches": result['total_count'],
            "field_types_searched": valid_field_types
        }
        
        # Add helpful message if multiple types have matches
        matches_by_type = {k: len(v) for k, v in result['results'].items() if v}
        type_descriptions = {
            'registrant': 'registrant',
            'client': 'client',
            'lobbyist': 'lobbyist',
            'pac': 'PAC',
            'foreign': 'foreign entity',
            'country': 'country'
        }
        
        if len(matches_by_type) > 1:
            response["clarification_needed"] = True
            # Create a detailed list of matches by type
            type_summary = []
            for field_type, count in matches_by_type.items():
                type_name = type_descriptions.get(field_type, field_type)
                type_summary.append(f"{count} as {type_name}")
            
            response["message"] = (
                f"Found multiple matches for '{query}' across different roles:\n"
                f"- {', '.join(type_summary)}\n\n"
                f"**IMPORTANT: You must ask the user to specify which role they want to search for.** "
                f"For example: 'I found Tesla as both a client and a registrant. Which one would you like to search for?' "
                f"Then use the exact value from the results when calling lda_search."
            )
            # Include sample results for each type to help the agent present options
            response["sample_results"] = {
                field_type: results[:3]  # First 3 results per type
                for field_type, results in result['results'].items()
                if results
            }
        elif len(matches_by_type) == 1:
            response["clarification_needed"] = False
            field_type = list(matches_by_type.keys())[0]
            type_name = type_descriptions.get(field_type, field_type)
            response["message"] = f"Found {result['total_count']} match(es) for '{query}' as {type_name}"
        else:
            response["clarification_needed"] = False
            response["message"] = f"No matches found for '{query}'"
        
        agent_logger.info(f"LDA Autocomplete: Found {result['total_count']} total matches across {len(matches_by_type)} type(s)")
        
        return json.dumps(response, default=str)
        
    except Exception as e:
        error_msg = f"Error in LDA autocomplete: {str(e)}"
        logger.error(error_msg, exc_info=True)
        agent_logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg
        })









        if field_types:
            if isinstance(field_types, str):
                try:
                    # Try JSON first
                    field_types_list = json.loads(field_types)
                except json.JSONDecodeError:
                    # Fall back to comma-separated
                    field_types_list = [ft.strip() for ft in field_types.split(',')]
            else:
                field_types_list = field_types
        else:
            # Default: search all types
            field_types_list = ['registrant', 'client', 'lobbyist', 'pac', 'foreign']
        
        # Validate field types
        valid_field_types = [ft for ft in field_types_list if ft in FIELD_TYPE_TO_S3_KEY]
        if not valid_field_types:
            valid_field_types = ['registrant', 'client', 'lobbyist', 'pac', 'foreign']
        
        # Validate limit
        if limit > 50:
            limit = 50
        if limit < 1:
            limit = 20
        
        # Perform autocomplete search
        result = handle_autocomplete_request(valid_field_types, query, limit)
        
        # Format response for agent
        response = {
            "success": True,
            "query": query,
            "results_by_type": result['results'],
            "total_matches": result['total_count'],
            "field_types_searched": valid_field_types
        }
        
        # Add helpful message if multiple types have matches
        matches_by_type = {k: len(v) for k, v in result['results'].items() if v}
        type_descriptions = {
            'registrant': 'registrant',
            'client': 'client',
            'lobbyist': 'lobbyist',
            'pac': 'PAC',
            'foreign': 'foreign entity',
            'country': 'country'
        }
        
        if len(matches_by_type) > 1:
            response["clarification_needed"] = True
            # Create a detailed list of matches by type
            type_summary = []
            for field_type, count in matches_by_type.items():
                type_name = type_descriptions.get(field_type, field_type)
                type_summary.append(f"{count} as {type_name}")
            
            response["message"] = (
                f"Found multiple matches for '{query}' across different roles:\n"
                f"- {', '.join(type_summary)}\n\n"
                f"**IMPORTANT: You must ask the user to specify which role they want to search for.** "
                f"For example: 'I found Tesla as both a client and a registrant. Which one would you like to search for?' "
                f"Then use the exact value from the results when calling lda_search."
            )
            # Include sample results for each type to help the agent present options
            response["sample_results"] = {
                field_type: results[:3]  # First 3 results per type
                for field_type, results in result['results'].items()
                if results
            }
        elif len(matches_by_type) == 1:
            response["clarification_needed"] = False
            field_type = list(matches_by_type.keys())[0]
            type_name = type_descriptions.get(field_type, field_type)
            response["message"] = f"Found {result['total_count']} match(es) for '{query}' as {type_name}"
        else:
            response["clarification_needed"] = False
            response["message"] = f"No matches found for '{query}'"
        
        agent_logger.info(f"LDA Autocomplete: Found {result['total_count']} total matches across {len(matches_by_type)} type(s)")
        
        return json.dumps(response, default=str)
        
    except Exception as e:
        error_msg = f"Error in LDA autocomplete: {str(e)}"
        logger.error(error_msg, exc_info=True)
        agent_logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg
        })








