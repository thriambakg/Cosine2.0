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
# Note: awarding_agency and funding_agency are deprecated by USAspending API
# They are mapped via aliases to awarding_agency_office and funding_agency_office
AUTOCOMPLETE_ENDPOINTS = {
    # Account autocomplete endpoints
    'accounts_a': '/api/v2/autocomplete/accounts/a/',
    'accounts_aid': '/api/v2/autocomplete/accounts/aid/',
    'accounts_ata': '/api/v2/autocomplete/accounts/ata/',
    'accounts_bpoa': '/api/v2/autocomplete/accounts/bpoa/',
    'accounts_epoa': '/api/v2/autocomplete/accounts/epoa/',
    'accounts_main': '/api/v2/autocomplete/accounts/main/',
    'accounts_sub': '/api/v2/autocomplete/accounts/sub/',
    
    # Agency autocomplete endpoints (using non-deprecated endpoints)
    'awarding_agency_office': '/api/v2/autocomplete/awarding_agency_office/',
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

# Alias mapping for user-friendly names and backward compatibility
# Deprecated endpoints are mapped to their replacements
AUTOCOMPLETE_ALIASES = {
    # TAS (Treasury Account Symbol) aliases
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
    
    # Deprecated agency endpoints -> new endpoints (for backward compatibility)
    'awarding_agency': 'awarding_agency_office',  # Deprecated: use awarding_agency_office
    'funding_agency': 'funding_agency_office',     # Deprecated: use funding_agency_office
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


def transform_agency_office_results(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Transform awarding_agency_office/funding_agency_office results to flat format
    
    The office endpoints return nested structures with toptier_agency, subtier_agency, and office.
    We need to flatten these into a simple array of {code, name} objects.
    
    Args:
        results: List of agency/office match objects from USAspending API
    
    Returns:
        Flattened list of {code, name, type} objects
    """
    flattened = []
    seen_codes = set()  # Prevent duplicates
    seen_names = set()  # Also track by name to prevent duplicates when code is missing
    
    if not isinstance(results, list):
        logger.error(f"transform_agency_office_results: Expected list, got {type(results)}")
        return []
    
    for item in results:
        if not isinstance(item, dict):
            logger.warning(f"transform_agency_office_results: Skipping non-dict item: {type(item)}")
            continue
        # Handle toptier_agency - can be a dict or a list of dicts
        if 'toptier_agency' in item:
            agencies = item['toptier_agency']
            # Handle both single dict and list of dicts
            if isinstance(agencies, dict):
                agencies = [agencies]
            elif not isinstance(agencies, list):
                continue
            
            for agency in agencies:
                if not isinstance(agency, dict):
                    continue
                try:
                    code = str(agency.get('code', '') or '')
                    name = str(agency.get('name', '') or '')
                    
                    # Use code as primary identifier, fall back to name if code is missing
                    identifier = code if code else name
                    if identifier and identifier not in seen_codes:
                        flattened.append({
                            'code': code or name,  # Use name as code if code is missing
                            'name': name,
                            'type': 'toptier_agency',
                            'abbreviation': agency.get('abbreviation', '')
                        })
                        seen_codes.add(identifier)
                        if name:
                            seen_names.add(name.lower())
                except Exception as e:
                    logger.warning(f"Error processing toptier_agency: {str(e)}")
                    continue
        
        # Handle subtier_agency - can be a dict or a list of dicts
        if 'subtier_agency' in item:
            agencies = item['subtier_agency']
            # Handle both single dict and list of dicts
            if isinstance(agencies, dict):
                agencies = [agencies]
            elif not isinstance(agencies, list):
                continue
            
            for agency in agencies:
                if not isinstance(agency, dict):
                    continue
                try:
                    code = str(agency.get('code', '') or '')
                    name = str(agency.get('name', '') or '')
                    
                    # Use code as primary identifier, fall back to name if code is missing
                    identifier = code if code else name
                    if identifier and identifier not in seen_codes:
                        # Also check name to avoid duplicates
                        name_lower = name.lower() if name else ''
                        if not name_lower or name_lower not in seen_names:
                            flattened.append({
                                'code': code or name,  # Use name as code if code is missing
                                'name': name,
                                'type': 'subtier_agency',
                                'abbreviation': agency.get('abbreviation', '')
                            })
                            seen_codes.add(identifier)
                            if name_lower:
                                seen_names.add(name_lower)
                except Exception as e:
                    logger.warning(f"Error processing subtier_agency: {str(e)}")
                    continue
        
        # Handle office - can be a dict or a list of dicts
        if 'office' in item:
            offices = item['office']
            # Handle both single dict and list of dicts
            if isinstance(offices, dict):
                offices = [offices]
            elif not isinstance(offices, list):
                continue
            
            for office in offices:
                if not isinstance(office, dict):
                    continue
                try:
                    code = str(office.get('code', '') or '')
                    name = str(office.get('name', '') or '')
                    
                    # Use code as primary identifier, fall back to name if code is missing
                    identifier = code if code else name
                    if identifier and identifier not in seen_codes:
                        # Also check name to avoid duplicates
                        name_lower = name.lower() if name else ''
                        if not name_lower or name_lower not in seen_names:
                            flattened.append({
                                'code': code or name,  # Use name as code if code is missing
                                'name': name,
                                'type': 'office'
                            })
                            seen_codes.add(identifier)
                            if name_lower:
                                seen_names.add(name_lower)
                except Exception as e:
                    logger.warning(f"Error processing office: {str(e)}")
                    continue
    
    return flattened


def handle_agency_autocomplete(autocomplete_type: str, request_body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Handle agency autocomplete endpoints
    
    Args:
        autocomplete_type: Type of agency autocomplete (e.g., 'awarding_agency_office')
        request_body: Request body with search_text and optional filters
    
    Returns:
        Autocomplete results with transformed structure for office endpoints
    """
    endpoint = AUTOCOMPLETE_ENDPOINTS.get(autocomplete_type)
    if not endpoint:
        raise ValueError(f"Unknown agency autocomplete type: {autocomplete_type}")
    
    # Agency autocomplete endpoints use POST with search_text
    body = {
        'search_text': request_body.get('search_text', ''),
    }
    
    # Add optional limit if provided, but cap at 50 to prevent 413 errors
    limit = min(request_body.get('limit', 20), 50)
    body['limit'] = limit
    
    try:
        # Call API
        api_response = call_usaspending_api(endpoint, method='POST', body=body)
    except Exception as e:
        # Handle all errors from USAspending API gracefully
        error_str = str(e)
        # Check if it's an API error (from call_usaspending_api)
        if 'API error:' in error_str or 'Request timeout' in error_str or 'Request failed' in error_str:
            logger.error(f"Error calling USAspending API for {autocomplete_type}: {error_str}", exc_info=True)
            # Extract status code if available
            status_code = None
            if 'API error:' in error_str:
                try:
                    # Extract status code from error message like "API error: 500 - ..."
                    parts = error_str.split('API error:')
                    if len(parts) > 1:
                        status_part = parts[1].strip().split()[0]
                        status_code = int(status_part)
                except (ValueError, IndexError):
                    pass
            
            error_msg = f"USAspending API error"
            if status_code:
                error_msg = f"USAspending API returned {status_code}"
            
            # Return empty results with error message instead of crashing
            return {
                'results': [],
                'messages': [f"Unable to fetch results: {error_msg}. The USAspending API may be experiencing issues."]
            }
        else:
            # Unexpected error - log and return empty results
            logger.error(f"Unexpected error calling USAspending API for {autocomplete_type}: {error_str}", exc_info=True)
            return {
                'results': [],
                'messages': [f"Unable to fetch results: {error_str}"]
            }
    
    # Transform results for office endpoints (they return nested structures)
    if autocomplete_type in ['awarding_agency_office', 'funding_agency_office']:
        try:
            original_results = api_response.get('results', [])
            
            # Log the structure we received for debugging
            logger.info(f"API response for {autocomplete_type}: results type = {type(original_results)}")
            
            # Handle case where results is a single dict (one match object)
            # The API can return either a list of dicts OR a single dict with keys ['toptier_agency', 'subtier_agency', 'office']
            if isinstance(original_results, dict):
                # Check if this is a single match object (has the expected keys)
                if any(key in original_results for key in ['toptier_agency', 'subtier_agency', 'office']):
                    logger.info(f"Results is a single match object with keys: {list(original_results.keys())}")
                    # Log the structure for debugging
                    for key in ['toptier_agency', 'subtier_agency', 'office']:
                        if key in original_results:
                            obj = original_results[key]
                            if isinstance(obj, dict):
                                logger.info(f"  {key}: code={obj.get('code', 'N/A')}, name={obj.get('name', 'N/A')[:50]}")
                            elif isinstance(obj, list):
                                logger.info(f"  {key}: list with {len(obj)} items")
                                if len(obj) > 0 and isinstance(obj[0], dict):
                                    logger.info(f"    First item: code={obj[0].get('code', 'N/A')}, name={obj[0].get('name', 'N/A')[:50]}")
                            else:
                                logger.info(f"  {key}: type={type(obj)}")
                    # Wrap it in a list so transform_agency_office_results can process it
                    original_results = [original_results]
                # Or if it's a dict containing a 'results' key with a list
                elif 'results' in original_results and isinstance(original_results['results'], list):
                    logger.info("Results dict contains 'results' key with list")
                    original_results = original_results['results']
                # Or if it's a dict containing a 'data' key with a list
                elif 'data' in original_results and isinstance(original_results['data'], list):
                    logger.info("Results dict contains 'data' key with list")
                    original_results = original_results['data']
                else:
                    logger.warning(f"Results dict has unexpected structure, keys: {list(original_results.keys())[:10]}")
                    # Try to convert dict values to list if they look like match objects
                    dict_values = list(original_results.values())
                    if dict_values and isinstance(dict_values[0], dict) and any(key in dict_values[0] for key in ['toptier_agency', 'subtier_agency', 'office']):
                        logger.info("Converting dict values to list of match objects")
                        original_results = dict_values
                    else:
                        original_results = []
            
            if isinstance(original_results, list):
                if len(original_results) > 0:
                    logger.info(f"Transforming {len(original_results)} results for {autocomplete_type}")
                transformed_results = transform_agency_office_results(original_results)
                api_response['results'] = transformed_results[:limit]  # Ensure we don't exceed limit
                logger.info(f"Transformed to {len(api_response['results'])} results")
            else:
                logger.error(f"Could not transform results for {autocomplete_type}: results is {type(original_results)}, value: {str(original_results)[:200]}")
                api_response['results'] = []  # Return empty array if transformation fails
        except Exception as e:
            logger.error(f"Error transforming results for {autocomplete_type}: {str(e)}", exc_info=True)
            # Return empty results instead of crashing
            api_response['results'] = []
            api_response['messages'] = api_response.get('messages', []) + [f"Error processing results: {str(e)}"]
    
    return api_response


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


def get_cors_headers() -> Dict[str, str]:
    """
    Get CORS headers for API Gateway responses
    
    Returns:
        Dictionary of CORS headers
    """
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
    }


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
    elif autocomplete_type in ['awarding_agency_office', 'funding_agency_office']:
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
    cors_headers = get_cors_headers()
    
    # Handle OPTIONS preflight request
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }
    
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
                'headers': cors_headers,
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
                'headers': cors_headers,
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
        
        # Extract results array and ensure it's actually an array
        results_array = results.get('results', [])
        if not isinstance(results_array, list):
            # If results is not a list, try to convert it
            if isinstance(results_array, dict):
                # For nested structures, try to extract a list
                logger.warning(f"Results is a dict instead of list for {autocomplete_type}, attempting to extract list")
                logger.info(f"Results dict structure: keys = {list(results_array.keys())[:10]}")
                
                # Try common patterns
                if 'results' in results_array:
                    results_array = results_array['results']
                elif 'data' in results_array:
                    results_array = results_array['data']
                elif len(results_array) > 0:
                    # If it's a dict with values, try to use the values
                    dict_values = list(results_array.values())
                    if dict_values and isinstance(dict_values[0], (dict, str)):
                        results_array = dict_values
                    else:
                        results_array = []
                else:
                    results_array = []
                
                # If still not a list after extraction, log and return empty
                if not isinstance(results_array, list):
                    logger.error(f"Could not convert results dict to list for {autocomplete_type}, returning empty array")
                    results_array = []
            else:
                logger.warning(f"Results is {type(results_array)} instead of list for {autocomplete_type}, returning empty array")
                results_array = []
        
        # Limit results to prevent 413 errors (max 50 items, but be conservative)
        # Each item should be small, but we'll limit to 50 to be safe
        # Note: This is a safety check - individual handlers should also limit their results
        max_items = 50
        if len(results_array) > max_items:
            logger.info(f"Truncating results from {len(results_array)} to {max_items} items to prevent 413 error")
            results_array = results_array[:max_items]
        
        # Return success response
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({
                'success': True,
                'autocomplete_type': autocomplete_type,
                'results': results_array,
                'messages': results.get('messages', []) if isinstance(results, dict) else [],
                'metadata': {
                    'timestamp': datetime.utcnow().isoformat(),
                    'endpoint': AUTOCOMPLETE_ENDPOINTS.get(autocomplete_type, 'unknown'),
                    'result_count': len(results_array)
                }
            })
        }
    
    except ValueError as e:
        logger.error(f"Validation error: {str(e)}")
        return {
            'statusCode': 400,
            'headers': cors_headers,
            'body': json.dumps({
                'error': 'Validation error',
                'message': str(e)
            })
        }
    
    except Exception as e:
        logger.error(f"Error processing autocomplete request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }

