"""
LDA Autocomplete tool for the chat agent
Provides autocomplete suggestions by invoking the LDA Autocomplete Lambda function
The Lambda function reads from S3 TXT files to provide autocomplete suggestions
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, Optional, List
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
lambda_client = boto3.client('lambda')

# Environment variables
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'staging')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'cosine')

# Lambda function name for LDA autocomplete
LDA_AUTOCOMPLETE_LAMBDA_NAME = f"{PROJECT_NAME}-lda-autocomplete-{ENVIRONMENT}"


def invoke_lda_autocomplete_lambda(
    query: str,
    field_types: Optional[List[str]] = None,
    limit: int = 20,
    offset: int = 0
) -> Dict[str, Any]:
    """
    Invoke the LDA Autocomplete Lambda function directly
    
    Args:
        query: Search query
        field_types: List of field types to search (e.g., ['registrant', 'client'])
        limit: Maximum number of results per field type
        offset: Number of results to skip (for pagination)
    
    Returns:
        Autocomplete results dictionary
    """
    try:
        # Default field types if not provided
        if not field_types:
            field_types = ['registrant', 'client', 'lobbyist', 'pac', 'foreign']
        
        # Prepare Lambda event (mimics API Gateway event structure)
        lambda_event = {
            'httpMethod': 'POST',
            'body': json.dumps({
                'query': query,
                'field_types': field_types,
                'limit': limit,
                'offset': offset
            }),
            'headers': {},
            'requestContext': {
                'http': {
                    'method': 'POST'
                }
            }
        }
        
        # Invoke Lambda function
        logger.info(f"Invoking LDA Autocomplete Lambda: {LDA_AUTOCOMPLETE_LAMBDA_NAME}")
        response = lambda_client.invoke(
            FunctionName=LDA_AUTOCOMPLETE_LAMBDA_NAME,
            InvocationType='RequestResponse',  # Synchronous invocation
            Payload=json.dumps(lambda_event)
        )
        
        # Check for Lambda errors
        if 'FunctionError' in response:
            error_payload = json.loads(response['Payload'].read())
            logger.error(f"Lambda function error: {error_payload}")
            return {
                'success': False,
                'error': error_payload.get('errorMessage', 'Lambda function error')
            }
        
        # Parse response
        response_payload = json.loads(response['Payload'].read())
        
        # Lambda returns API Gateway-style response with statusCode and body
        if response_payload.get('statusCode') == 200:
            body = json.loads(response_payload.get('body', '{}'))
            logger.info(f"Lambda autocomplete completed: {body.get('count', 0)} results, has_more={body.get('has_more', False)}")
            return body
        else:
            # Error response
            error_body = json.loads(response_payload.get('body', '{}'))
            logger.error(f"Lambda returned error status {response_payload.get('statusCode')}: {error_body}")
            return {
                'success': False,
                'error': error_body.get('error', f"Lambda returned status {response_payload.get('statusCode')}")
            }
            
    except Exception as e:
        logger.error(f"Error invoking LDA Autocomplete Lambda: {str(e)}", exc_info=True)
        return {
            'success': False,
            'error': f"Failed to invoke autocomplete Lambda: {str(e)}"
        }


@tool
def lda_autocomplete(
    query: str,
    field_types: str = None,
    limit: int = 20
) -> str:
    """
    Search for LDA autocomplete suggestions by invoking the LDA Autocomplete Lambda function.
    The Lambda reads from S3 TXT files to provide autocomplete suggestions for registrants, clients,
    lobbyists, PACs, or foreign entities.
    
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
        JSON string with autocomplete results.
        - Results are in a flat list with 'value' (exact name to use in lda_search), 'type', and 'label'
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
        field_types_list = None
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
        
        # Validate limit
        if limit > 50:
            limit = 50
        if limit < 1:
            limit = 20
        
        # Invoke Lambda function
        result = invoke_lda_autocomplete_lambda(
            query=query,
            field_types=field_types_list,
            limit=limit,
            offset=0
        )
        
        # Check if Lambda returned an error
        if not result.get('success', True):
            agent_logger.error(f"❌ Lambda autocomplete failed: {result.get('error')}")
            return json.dumps(result, default=str)
        
        # Format response for agent (group results by type for clarity)
        results_list = result.get('results', [])
        results_by_type = {}
        
        # Group results by type
        for item in results_list:
            item_type = item.get('type', 'unknown')
            if item_type not in results_by_type:
                results_by_type[item_type] = []
            results_by_type[item_type].append(item)
        
        # Build response
        response = {
            "success": True,
            "query": result.get('query', query),
            "results_by_type": results_by_type,
            "total_matches": result.get('total_count', result.get('count', 0)),
            "field_types_searched": result.get('field_types', field_types_list or ['registrant', 'client', 'lobbyist', 'pac', 'foreign'])
        }
        
        # Add helpful message if multiple types have matches
        matches_by_type = {k: len(v) for k, v in results_by_type.items() if v}
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
                for field_type, results in results_by_type.items()
                if results
            }
        elif len(matches_by_type) == 1:
            response["clarification_needed"] = False
            field_type = list(matches_by_type.keys())[0]
            type_name = type_descriptions.get(field_type, field_type)
            response["message"] = f"Found {result.get('total_count', result.get('count', 0))} match(es) for '{query}' as {type_name}"
        else:
            response["clarification_needed"] = False
            response["message"] = f"No matches found for '{query}'"
        
        agent_logger.info(f"LDA Autocomplete: Found {result.get('total_count', result.get('count', 0))} total matches across {len(matches_by_type)} type(s)")
        
        return json.dumps(response, default=str)
        
    except Exception as e:
        error_msg = f"Error in LDA autocomplete: {str(e)}"
        logger.error(error_msg, exc_info=True)
        agent_logger.error(error_msg)
        return json.dumps({
            "success": False,
            "error": error_msg
        })
