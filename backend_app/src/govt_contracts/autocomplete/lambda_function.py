"""
USAspending Autocomplete Lambda Function
Handles all autocomplete endpoints for USAspending API
"""

import json
import os
import logging
import requests
from typing import Dict, List, Any, Optional
from datetime import datetime

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# USAspending API configuration
USASPENDING_BASE_URL = os.environ.get('USASPENDING_BASE_URL', 'https://api.usaspending.gov')
USASPENDING_USER_AGENT = os.environ.get('USASPENDING_USER_AGENT', 'Cosine Financial Platform (contact@cosine.financial)')

# Request timeout
REQUEST_TIMEOUT = int(os.environ.get('REQUEST_TIMEOUT', '30'))

# Supported autocomplete endpoints mapping
AUTOCOMPLETE_ENDPOINTS = {
    # Account autocomplete endpoints
    'accounts_a': '/api/v2/autocomplete/accounts/a/',
    'accounts_aid': '/api/v2/autocomplete/accounts/aid/',
    'accounts_ata': '/api/v2/autocomplete/accounts/ata/',
    'accounts_bpoa': '/api/v2/autocomplete/accounts/bpoa/',
    'accounts_epoa': '/api/v2/autocomplete/accounts/epoa/',
    'accounts_main': '/api/v2/autocomplete/accounts/main/',
    'accounts_sub': '/api/v2/autocomplete/accounts/sub/',
    
    # Agency autocomplete endpoints
    'awarding_agency': '/api/v2/autocomplete/awarding_agency/',
    'awarding_agency_office': '/api/v2/autocomplete/awarding_agency_office/',
    'funding_agency': '/api/v2/autocomplete/funding_agency/',
    'funding_agency_office': '/api/v2/autocomplete/funding_agency_office/',
    
    # Other autocomplete endpoints
    'recipient': '/api/v2/autocomplete/recipient/',
    'city': '/api/v2/autocomplete/city/',
    'location': '/api/v2/autocomplete/location/',
    'program_activity': '/api/v2/autocomplete/program_activity/',
    'cfda': '/api/v2/autocomplete/cfda/',
    'naics': '/api/v2/autocomplete/naics/',
    'psc': '/api/v2/autocomplete/psc/',
    'glossary': '/api/v2/autocomplete/glossary/',
}

# Alias mapping for user-friendly names
AUTOCOMPLETE_ALIASES = {
    'tas_availability_type': 'accounts_a',
    'tas_agency_id': 'accounts_aid',
    'tas_allocation_transfer_agency': 'accounts_ata',
    'tas_ata': 'accounts_ata',
    'tas_beginning_period_of_availability': 'accounts_bpoa',
    'tas_bpoa': 'accounts_bpoa',
    'tas_ending_period_of_availability': 'accounts_epoa',
    'tas_epoa': 'accounts_epoa',
    'tas_main_account': 'accounts_main',
    'tas_sub_account': 'accounts_sub',
}


def create_session():
    """Create a requests session with proper headers"""
    session = requests.Session()
    session.headers.update({
        'User-Agent': USASPENDING_USER_AGENT,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    })
    return session


def call_usaspending_api(endpoint: str, method: str = 'POST', body: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Call USAspending API endpoint
    
    Args:
        endpoint: API endpoint path (e.g., '/api/v2/autocomplete/recipient/')
        method: HTTP method ('GET' or 'POST')
        body: Request body for POST requests
    
    Returns:
        API response as dictionary
    """
    url = f"{USASPENDING_BASE_URL}{endpoint}"
    session = create_session()
    
    try:
        if method.upper() == 'POST':
            response = session.post(url, json=body, timeout=REQUEST_TIMEOUT)
        else:
            response = session.get(url, params=body, timeout=REQUEST_TIMEOUT)
        
        response.raise_for_status()
        return response.json()
    
    except requests.exceptions.Timeout:
        logger.error(f"Timeout calling USAspending API: {url}")
        raise Exception(f"Request timeout: {url}")
    
    except requests.exceptions.HTTPError as e:
        logger.error(f"HTTP error calling USAspending API: {url}, Status: {e.response.status_code}, Response: {e.response.text}")
        raise Exception(f"API error: {e.response.status_code} - {e.response.text}")
    
    except requests.exceptions.RequestException as e:
        logger.error(f"Request error calling USAspending API: {url}, Error: {str(e)}")
        raise Exception(f"Request failed: {str(e)}")
    
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error for USAspending API response: {url}, Error: {str(e)}")
        raise Exception(f"Invalid JSON response: {str(e)}")
    
    except Exception as e:
        logger.error(f"Unexpected error calling USAspending API: {url}, Error: {str(e)}")
        raise


def handle_account_autocomplete(autocomplete_type: str, request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle account autocomplete endpoints (TAS components)
    
    Args:
        autocomplete_type: Type of account autocomplete (e.g., 'accounts_aid')
        request_body: Request body with search_text and optional filters
    
    Returns:
        Autocomplete results
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS.get(autocomplete_type)
    if not endpoint:
        raise ValueError(f"Unknown account autocomplete type: {autocomplete_type}")
    
    # Account autocomplete endpoints use POST with search_text
    body = {
        'search_text': request_body.get('search_text', ''),
    }
    
    # Add optional limit if provided
    if 'limit' in request_body:
        body['limit'] = request_body['limit']
    
    # Some account endpoints support filter parameter
    if 'filter' in request_body:
        body['filter'] = request_body['filter']
    
    return call_usaspending_api(endpoint, method='POST', body=body)


def handle_agency_autocomplete(autocomplete_type: str, request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle agency autocomplete endpoints
    
    Args:
        autocomplete_type: Type of agency autocomplete (e.g., 'awarding_agency')
        request_body: Request body with search_text and optional filters
    
    Returns:
        Autocomplete results
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS.get(autocomplete_type)
    if not endpoint:
        raise ValueError(f"Unknown agency autocomplete type: {autocomplete_type}")
    
    # Agency autocomplete endpoints use POST with search_text
    body = {
        'search_text': request_body.get('search_text', ''),
    }
    
    # Add optional limit if provided
    if 'limit' in request_body:
        body['limit'] = request_body['limit']
    
    return call_usaspending_api(endpoint, method='POST', body=body)


def handle_recipient_autocomplete(request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle recipient autocomplete endpoint
    
    Args:
        request_body: Request body with search_text and optional filters
    
    Returns:
        Autocomplete results
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS['recipient']
    
    # Recipient autocomplete uses POST with search_text
    body = {
        'search_text': request_body.get('search_text', ''),
    }
    
    # Add optional limit if provided
    if 'limit' in request_body:
        body['limit'] = request_body['limit']
    
    return call_usaspending_api(endpoint, method='POST', body=body)


def handle_city_autocomplete(request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle city autocomplete endpoint
    
    Args:
        request_body: Request body with search_text, limit, and optional filter object
    
    Returns:
        Autocomplete results
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS['city']
    
    # City autocomplete uses POST with search_text, limit, and optional filter object
    # API structure: { "search_text": "...", "limit": 10, "filter": { "country_code": "USA", "scope": "..." } }
    body = {
        'search_text': request_body.get('search_text', ''),
        'limit': request_body.get('limit', 10)
    }
    
    # Build filter object if provided or if country_code/scope are provided
    if 'filter' in request_body and isinstance(request_body['filter'], dict):
        # Use provided filter object
        body['filter'] = request_body['filter']
    else:
        # Build filter object from individual fields or defaults
        filter_obj = {}
        
        # country_code is required in filter - default to "USA" if not provided
        filter_obj['country_code'] = request_body.get('country_code', 'USA')
        
        # scope is required in filter - default to "recipient_location" if not provided
        filter_obj['scope'] = request_body.get('scope', 'recipient_location')
        
        # state_code is optional
        if 'state_code' in request_body:
            filter_obj['state_code'] = request_body['state_code']
        
        body['filter'] = filter_obj
    
    return call_usaspending_api(endpoint, method='POST', body=body)


def handle_location_autocomplete(request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle location autocomplete endpoint
    
    Args:
        request_body: Request body with search_text and optional filters
    
    Returns:
        Autocomplete results
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS['location']
    
    # Location autocomplete uses POST with search_text
    body = {
        'search_text': request_body.get('search_text', ''),
    }
    
    if 'limit' in request_body:
        body['limit'] = request_body['limit']
    
    return call_usaspending_api(endpoint, method='POST', body=body)


def handle_program_activity_autocomplete(request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle program activity autocomplete endpoint
    
    Args:
        request_body: Request body with search_text and optional filters
    
    Returns:
        Autocomplete results
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS['program_activity']
    
    # Program activity autocomplete uses POST with search_text
    body = {
        'search_text': request_body.get('search_text', ''),
    }
    
    if 'limit' in request_body:
        body['limit'] = request_body['limit']
    
    return call_usaspending_api(endpoint, method='POST', body=body)


def handle_cfda_autocomplete(request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle CFDA autocomplete endpoint
    
    Args:
        request_body: Request body with search_text and optional filters
    
    Returns:
        Autocomplete results
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS['cfda']
    
    # CFDA autocomplete uses POST with search_text
    body = {
        'search_text': request_body.get('search_text', ''),
    }
    
    if 'limit' in request_body:
        body['limit'] = request_body['limit']
    
    return call_usaspending_api(endpoint, method='POST', body=body)


def handle_naics_autocomplete(request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle NAICS autocomplete endpoint
    
    Args:
        request_body: Request body with search_text and optional filters
    
    Returns:
        Autocomplete results
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS['naics']
    
    # NAICS autocomplete uses POST with search_text
    body = {
        'search_text': request_body.get('search_text', ''),
    }
    
    if 'limit' in request_body:
        body['limit'] = request_body['limit']
    
    return call_usaspending_api(endpoint, method='POST', body=body)


def handle_psc_autocomplete(request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle PSC autocomplete endpoint
    
    Args:
        request_body: Request body with search_text and optional filters
    
    Returns:
        Autocomplete results
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS['psc']
    
    # PSC autocomplete uses POST with search_text
    body = {
        'search_text': request_body.get('search_text', ''),
    }
    
    if 'limit' in request_body:
        body['limit'] = request_body['limit']
    
    return call_usaspending_api(endpoint, method='POST', body=body)


def handle_glossary_autocomplete(request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle glossary autocomplete endpoint
    
    Args:
        request_body: Request body with search_text and optional filters
    
    Returns:
        Autocomplete results
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS['glossary']
    
    # Glossary autocomplete uses POST with search_text
    body = {
        'search_text': request_body.get('search_text', ''),
    }
    
    if 'limit' in request_body:
        body['limit'] = request_body['limit']
    
    return call_usaspending_api(endpoint, method='POST', body=body)


def route_autocomplete_request(autocomplete_type: str, request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Route autocomplete request to appropriate handler
    
    Args:
        autocomplete_type: Type of autocomplete (e.g., 'recipient', 'accounts_aid')
        request_body: Request body with search parameters
    
    Returns:
        Autocomplete results
    """
    # Check if it's an alias (must be done BEFORE validation)
    if autocomplete_type in AUTOCOMPLETE_ALIASES:
        autocomplete_type = AUTOCOMPLETE_ALIASES[autocomplete_type]
    
    # Validate autocomplete type
    if autocomplete_type not in AUTOCOMPLETE_ENDPOINTS:
        raise ValueError(f"Unknown autocomplete type: {autocomplete_type}. Supported types: {', '.join(AUTOCOMPLETE_ENDPOINTS.keys())}")
    
    # Route to appropriate handler
    if autocomplete_type.startswith('accounts_'):
        return handle_account_autocomplete(autocomplete_type, request_body)
    elif autocomplete_type in ['awarding_agency', 'awarding_agency_office', 'funding_agency', 'funding_agency_office']:
        return handle_agency_autocomplete(autocomplete_type, request_body)
    elif autocomplete_type == 'recipient':
        return handle_recipient_autocomplete(request_body)
    elif autocomplete_type == 'city':
        return handle_city_autocomplete(request_body)
    elif autocomplete_type == 'location':
        return handle_location_autocomplete(request_body)
    elif autocomplete_type == 'program_activity':
        return handle_program_activity_autocomplete(request_body)
    elif autocomplete_type == 'cfda':
        return handle_cfda_autocomplete(request_body)
    elif autocomplete_type == 'naics':
        return handle_naics_autocomplete(request_body)
    elif autocomplete_type == 'psc':
        return handle_psc_autocomplete(request_body)
    elif autocomplete_type == 'glossary':
        return handle_glossary_autocomplete(request_body)
    else:
        raise ValueError(f"Unhandled autocomplete type: {autocomplete_type}")


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for USAspending autocomplete requests
    
    Expected event structure:
    {
        "httpMethod": "POST",
        "path": "/usaspending-autocomplete/{type}",
        "pathParameters": {
            "type": "recipient"  // or other autocomplete type
        },
        "body": "{\"search_text\": \"Lockheed\", \"limit\": 10}"
    }
    
    Or from API Gateway:
    {
        "autocomplete_type": "recipient",
        "search_text": "Lockheed",
        "limit": 10
    }
    """
    try:
        logger.info(f"Received autocomplete request: {json.dumps(event)}")
        
        # Parse request - handle both API Gateway and direct invocation
        if 'httpMethod' in event:
            # API Gateway event
            path_params = event.get('pathParameters') or {}
            autocomplete_type = path_params.get('type') or (path_params.get('proxy', '').split('/')[-1] if path_params.get('proxy') else None)
            
            # Parse body
            if isinstance(event.get('body'), str):
                try:
                    request_body = json.loads(event['body'])
                except json.JSONDecodeError:
                    request_body = {}
            else:
                request_body = event.get('body', {})
            
            # If autocomplete_type not in path, get it from body
            if not autocomplete_type:
                autocomplete_type = request_body.get('autocomplete_type')
        else:
            # Direct invocation
            autocomplete_type = event.get('autocomplete_type') or event.get('type')
            request_body = event
        
        # Validate autocomplete type
        if not autocomplete_type:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({
                    'error': 'Missing autocomplete type',
                    'message': 'Please specify autocomplete type in path or request body',
                    'supported_types': list(AUTOCOMPLETE_ENDPOINTS.keys())
                })
            }
        
        # Validate search_text
        if 'search_text' not in request_body and 'searchText' not in request_body:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
                'body': json.dumps({
                    'error': 'Missing search_text',
                    'message': 'Please provide search_text in request body'
                })
            }
        
        # Normalize search_text field name
        if 'searchText' in request_body:
            request_body['search_text'] = request_body.pop('searchText')
        
        # Route request
        results = route_autocomplete_request(autocomplete_type, request_body)
        
        # Ensure results is a dictionary
        if results is None:
            results = {'results': [], 'messages': []}
        
        # Return success response
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'success': True,
                'autocomplete_type': autocomplete_type,
                'results': results.get('results', []) if isinstance(results, dict) else [],
                'messages': results.get('messages', []) if isinstance(results, dict) else [],
                'metadata': {
                    'timestamp': datetime.utcnow().isoformat(),
                    'endpoint': AUTOCOMPLETE_ENDPOINTS.get(autocomplete_type, 'unknown')
                }
            })
        }
    
    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        return {
            'statusCode': 400,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'error': 'Validation error',
                'message': str(e)
            })
        }
    
    except Exception as e:
        logger.error(f"Error processing autocomplete request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }

