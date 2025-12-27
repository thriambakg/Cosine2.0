"""
Search Autocomplete tool for the chat agent
Provides autocomplete and fuzzy matching for search lists:
- policy-areas.csv: Used for Congress Bills search (policy_area filter)
- general_issues.csv: Used for LDA search (general_issue_code filter)
- government_entities.csv: Used for LDA search (government_entity filter)
- congress-legislators.csv: Used for Congress Bills search (sponsor_name, cosponsor_name filters)
"""

import json
import os
import logging
import boto3
import csv
from typing import Dict, List, Any, Optional
from io import StringIO
import sys
from difflib import SequenceMatcher

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

# Environment variables - CSV files are in the Chat/lists directory
# These files are bundled with the Lambda deployment
CSV_FILES_DIR = os.path.join(os.path.dirname(__file__), '..', 'lists')

# List type to CSV file mapping
LIST_TYPE_TO_FILE = {
    'policy_area': 'policy-areas.csv',
    'general_issue': 'general_issues.csv',
    'government_entity': 'government_entities.csv',
    'congress_legislator': 'congress-legislators.csv',
}

# List type to search type mapping (which search uses which list)
LIST_TYPE_TO_SEARCH_TYPE = {
    'policy_area': 'congress_bills',  # Used in Congress Bills search
    'general_issue': 'lda',  # Used in LDA search
    'government_entity': 'lda',  # Used in LDA search
    'congress_legislator': 'congress_bills',  # Used in Congress Bills search
}

# Cache for CSV data (in-memory, per Lambda instance)
_csv_cache: Dict[str, List[str]] = {}


def load_csv_from_local(list_type: str) -> List[str]:
    """
    Load CSV file from local filesystem and return list of values
    
    Args:
        list_type: Type of list (e.g., 'policy_area', 'general_issue')
    
    Returns:
        List of values from CSV file
    """
    # Check cache first
    if list_type in _csv_cache:
        return _csv_cache[list_type]
    
    csv_file = LIST_TYPE_TO_FILE.get(list_type)
    if not csv_file:
        logger.warning(f"Unknown list type: {list_type}")
        return []
    
    csv_path = os.path.join(CSV_FILES_DIR, csv_file)
    
    try:
        logger.info(f"Loading CSV from {csv_path} for list_type={list_type}")
        
        if not os.path.exists(csv_path):
            logger.warning(f"CSV file not found: {csv_path}")
            return []
        
        values = []
        with open(csv_path, 'r', encoding='utf-8') as f:
            if list_type == 'congress_legislator':
                # For congress-legislators.csv, use DictReader to get 'full_name' column
                reader = csv.DictReader(f)
                row_count = 0
                for row in reader:
                    row_count += 1
                    full_name = row.get('full_name', '').strip()
                    if full_name:
                        values.append(full_name)
            elif list_type == 'policy_area':
                # For policy-areas.csv, use DictReader to get 'policy_area' column
                reader = csv.DictReader(f)
                row_count = 0
                for row in reader:
                    row_count += 1
                    policy_area = row.get('policy_area', '').strip()
                    if policy_area:
                        values.append(policy_area)
            else:
                # For general_issues.csv and government_entities.csv, use DictReader to get 'value' column
                reader = csv.DictReader(f)
                row_count = 0
                for row in reader:
                    row_count += 1
                    value = row.get('value', '').strip()
                    # Remove quotes if present
                    if value.startswith('"') and value.endswith('"'):
                        value = value[1:-1]
                    if value:
                        values.append(value)
        
        # Cache the results
        _csv_cache[list_type] = values
        
        logger.info(f"Loaded {len(values)} values from {csv_path} (processed {row_count} rows)")
        return values
        
    except Exception as e:
        logger.error(f"Error loading CSV file ({csv_path}): {str(e)}", exc_info=True)
        return []


def similarity_score(a: str, b: str) -> float:
    """Calculate similarity score between two strings (0.0 to 1.0)"""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def fuzzy_match_query(query: str, values: List[str], limit: int = 10, min_similarity: float = 0.3) -> List[Dict[str, Any]]:
    """
    Fuzzy match a natural language query against a list of values
    
    Args:
        query: Natural language query (e.g., "renewable energy", "healthcare")
        values: List of values to search
        limit: Maximum number of results
        min_similarity: Minimum similarity score (0.0 to 1.0)
    
    Returns:
        List of matches with similarity scores, sorted by relevance
    """
    if not query:
        return [{'value': v, 'score': 1.0} for v in values[:limit]]
    
    query_lower = query.lower().strip()
    if not query_lower:
        return [{'value': v, 'score': 1.0} for v in values[:limit]]
    
    # Split query into words for better matching
    query_words = query_lower.split()
    
    matches = []
    
    for value in values:
        value_lower = value.lower()
        
        # Calculate multiple similarity metrics
        # 1. Exact match (highest priority)
        if value_lower == query_lower:
            matches.append({'value': value, 'score': 1.0, 'match_type': 'exact'})
            continue
        
        # 2. Starts with (high priority)
        if value_lower.startswith(query_lower):
            matches.append({'value': value, 'score': 0.9, 'match_type': 'starts_with'})
            continue
        
        # 3. Contains (medium priority)
        if query_lower in value_lower:
            matches.append({'value': value, 'score': 0.8, 'match_type': 'contains'})
            continue
        
        # 4. Word-based matching (check if query words appear in value)
        word_matches = sum(1 for word in query_words if word in value_lower)
        if word_matches > 0:
            word_score = word_matches / len(query_words)
            matches.append({'value': value, 'score': 0.5 + (word_score * 0.3), 'match_type': 'word_match'})
            continue
        
        # 5. Fuzzy similarity (fallback)
        similarity = similarity_score(query_lower, value_lower)
        if similarity >= min_similarity:
            matches.append({'value': value, 'score': similarity, 'match_type': 'fuzzy'})
    
    # Sort by score (descending) and return top matches
    matches.sort(key=lambda x: x['score'], reverse=True)
    return matches[:limit]


@tool
def search_autocomplete(
    query: str,
    list_type: str,
    limit: int = 10
) -> str:
    """
    Search and autocomplete values from search lists with fuzzy matching.
    This tool helps match natural language queries to exact values in CSV lists.
    
    **CRITICAL: Use the correct list_type for each search:**
    - For Congress Bills searches: Use 'policy_area' or 'congress_legislator'
    - For LDA searches: Use 'general_issue' or 'government_entity'
    - NEVER use policy_area for LDA searches or general_issue for Congress Bills searches
    
    **List Types:**
    - 'policy_area': Policy areas for Congress Bills (e.g., "Energy", "Health", "Education")
    - 'general_issue': General issue codes for LDA (e.g., "ENG", "HCR", "EDU")
    - 'government_entity': Government entities for LDA (e.g., "Energy, Dept of", "Health & Human Services, Dept of")
    - 'congress_legislator': Active Congress legislators for Congress Bills (sponsor/cosponsor names)
    
    **Fuzzy Matching Examples:**
    - "renewable energy" → matches "Energy" (policy_area)
    - "healthcare" → matches "Health" (policy_area)
    - "environmental protection" → matches "Environmental Protection" (policy_area)
    - "renewable" → matches "Energy" (policy_area)
    - "health" → matches "Health" (policy_area)
    
    Args:
        query: Natural language query to match (e.g., "renewable energy", "healthcare", "John Smith")
        list_type: Type of list to search. Must be one of:
                  - 'policy_area' (for Congress Bills)
                  - 'general_issue' (for LDA)
                  - 'government_entity' (for LDA)
                  - 'congress_legislator' (for Congress Bills)
        limit: Maximum number of results to return (default: 10, max: 20)
    
    Returns:
        JSON string with search results including matched values and similarity scores.
        Format:
        {
            "success": true,
            "list_type": "policy_area",
            "search_type": "congress_bills",
            "query": "renewable energy",
            "matches": [
                {
                    "value": "Energy",
                    "score": 0.85,
                    "match_type": "word_match"
                }
            ],
            "best_match": {
                "value": "Energy",
                "score": 0.85
            }
        }
    
    Example:
        # Match "renewable energy" to policy area for Congress Bills search
        search_autocomplete("renewable energy", "policy_area")
        
        # Match "healthcare" to policy area
        search_autocomplete("healthcare", "policy_area")
        
        # Match legislator name
        search_autocomplete("John Smith", "congress_legislator")
    """
    try:
        agent_logger.info(f"Search Autocomplete: Searching '{query}' in list_type='{list_type}'")
        
        # Validate list_type
        if list_type not in LIST_TYPE_TO_FILE:
            error_msg = f"Invalid list_type: {list_type}. Must be one of: {', '.join(LIST_TYPE_TO_FILE.keys())}"
            logger.error(error_msg)
            agent_logger.error(error_msg)
            return json.dumps({
                "success": False,
                "error": error_msg,
                "valid_list_types": list(LIST_TYPE_TO_FILE.keys())
            })
        
        # Validate limit
        if limit > 20:
            limit = 20
        if limit < 1:
            limit = 10
        
        # Load CSV values
        values = load_csv_from_local(list_type)
        
        if not values:
            logger.warning(f"No values loaded for list_type={list_type}")
            return json.dumps({
                "success": False,
                "error": f"No values found for list_type={list_type}",
                "list_type": list_type
            })
        
        logger.info(f"Searching {len(values)} values for list_type={list_type} with query='{query}'")
        
        # Perform fuzzy matching
        matches = fuzzy_match_query(query, values, limit)
        
        logger.info(f"Found {len(matches)} matches for list_type={list_type}")
        
        # Format response
        response = {
            "success": True,
            "list_type": list_type,
            "search_type": LIST_TYPE_TO_SEARCH_TYPE.get(list_type, "unknown"),
            "query": query,
            "matches": matches,
            "total_matches": len(matches)
        }
        
        # Add best match if available
        if matches:
            response["best_match"] = {
                "value": matches[0]["value"],
                "score": matches[0]["score"],
                "match_type": matches[0].get("match_type", "unknown")
            }
            response["recommendation"] = f"Use '{matches[0]['value']}' for {list_type} filter in {LIST_TYPE_TO_SEARCH_TYPE.get(list_type)} search"
        else:
            response["best_match"] = None
            response["recommendation"] = f"No matches found for '{query}' in {list_type}. Try a different query or check the available values."
        
        agent_logger.info(f"Search Autocomplete: Found {len(matches)} match(es), best match: {response.get('best_match', {}).get('value', 'None')}")
        
        return json.dumps(response, default=str)
        
    except Exception as e:
        error_msg = f"Error in search autocomplete: {str(e)}"
        logger.error(error_msg, exc_info=True)
        agent_logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg
        })

