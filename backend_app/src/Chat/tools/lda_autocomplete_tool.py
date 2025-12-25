"""
LDA Autocomplete tool for the chat agent
Provides autocomplete suggestions for LDA search fields (registrant, client, lobbyist, PAC, foreign entities)
"""

import json
import os
import logging
import boto3
import csv
from typing import Dict, List, Any, Optional
from io import StringIO
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
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-lda-disclosures-production')
S3_PREFIX = os.environ.get('S3_PREFIX', 'lists/')

# Field type to S3 key mapping
FIELD_TYPE_TO_S3_KEY = {
    'registrant': f'{S3_PREFIX}registrant_names.csv',
    'client': f'{S3_PREFIX}client_names.csv',
    'lobbyist': f'{S3_PREFIX}lobbyist_names.csv',
    'pac': f'{S3_PREFIX}pacs.csv',
    'foreign': f'{S3_PREFIX}countries.csv',
    'country': f'{S3_PREFIX}countries.csv',
}

# Cache for CSV data (in-memory, per Lambda instance)
_csv_cache: Dict[str, List[str]] = {}


def load_csv_from_s3(field_type: str) -> List[str]:
    """
    Load CSV file from S3 and return list of values
    
    Args:
        field_type: Type of field (e.g., 'registrant', 'client', 'lobbyist')
    
    Returns:
        List of values from CSV file
    """
    # Check cache first
    if field_type in _csv_cache:
        return _csv_cache[field_type]
    
    s3_key = FIELD_TYPE_TO_S3_KEY.get(field_type)
    if not s3_key:
        logger.warning(f"Unknown field type: {field_type}")
        return []
    
    try:
        logger.info(f"Loading CSV from s3://{S3_BUCKET_NAME}/{s3_key} for field_type={field_type}")
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        content = response['Body'].read().decode('utf-8')
        
        # Handle CSV files (single-column format with names)
        reader = csv.reader(StringIO(content))
        values = []
        
        # Skip header row (should be 'value')
        header = next(reader, None)
        if header:
            logger.debug(f"CSV header: {header}")
        
        # Read all values (single column)
        row_count = 0
        for row in reader:
            row_count += 1
            if row and len(row) > 0 and row[0]:
                value = row[0].strip()
                # Remove quotes if present
                if value.startswith('"') and value.endswith('"'):
                    value = value[1:-1]
                if value:
                    values.append(value)
        
        # Cache the results
        _csv_cache[field_type] = values
        
        logger.info(f"Loaded {len(values)} values from s3://{S3_BUCKET_NAME}/{s3_key} (processed {row_count} rows)")
        return values
        
    except s3_client.exceptions.NoSuchKey:
        logger.warning(f"File not found: s3://{S3_BUCKET_NAME}/{s3_key}")
        return []
    except Exception as e:
        logger.error(f"Error loading file from S3 ({s3_key}): {str(e)}", exc_info=True)
        return []


def search_csv_values(values: List[str], query: str, limit: int = 20) -> List[str]:
    """
    Search CSV values for matches using tiered approach (exact -> starts with -> contains)
    
    Args:
        values: List of values to search
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
    
    for value in values:
        value_lower = value.lower()
        
        # Exact match (highest priority)
        if value_lower == query_lower:
            exact_matches.append(value)
        # Starts with (second priority)
        elif value_lower.startswith(query_lower):
            starts_with_matches.append(value)
        # Contains (fallback)
        elif query_lower in value_lower:
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
        # Load CSV for this field type
        values = load_csv_from_s3(field_type)
        
        if not values:
            logger.warning(f"No values loaded for field_type={field_type}")
            all_results[field_type] = []
            continue
        
        logger.info(f"Searching {len(values)} values for field_type={field_type} with query='{query}'")
        
        # Search for matches
        matches = search_csv_values(values, query, limit)
        
        logger.info(f"Found {len(matches)} matches for field_type={field_type}")
        
        # Add field type indicator to results
        all_results[field_type] = [
            {
                'value': match,
                'type': field_type,
                'label': f"{match} ({field_type})"
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
    
    When a generic name is provided (e.g., "Apple"), this will search across all field types
    and return matches grouped by type. The agent should ask the user to clarify which type
    they're interested in if multiple types have matches.
    
    Args:
        query: Search query (e.g., "Apple", "Microsoft", "John Smith")
        field_types: JSON string or comma-separated string of field types to search.
                    Options: 'registrant', 'client', 'lobbyist', 'pac', 'foreign', 'country'.
                    If not provided, searches all types.
        limit: Maximum number of results per field type (default: 20, max: 50)
    
    Returns:
        JSON string with autocomplete results grouped by field type.
        Each field type contains a list of matches with 'value', 'type', and 'label'.
        
    Example:
        # Search for "Apple" across all types
        lda_autocomplete("Apple")
        
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
        if len(matches_by_type) > 1:
            response["clarification_needed"] = True
            response["message"] = (
                f"Found matches across {len(matches_by_type)} different types: {', '.join(matches_by_type.keys())}. "
                f"Please ask the user which type they're interested in, or search all if they want comprehensive results."
            )
        elif len(matches_by_type) == 1:
            response["clarification_needed"] = False
            response["message"] = f"Found {result['total_count']} match(es) in {list(matches_by_type.keys())[0]}"
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





