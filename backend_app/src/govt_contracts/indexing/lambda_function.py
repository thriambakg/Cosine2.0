"""
USAspending Indexing Lambda Function
Handles indexing of awards, transactions, and subawards from USAspending API
Stores award metadata in DynamoDB and transaction/subaward details in S3
"""

import json
import os
import logging
import requests
import boto3
import gzip
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone
from decimal import Decimal

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Environment variables
USASPENDING_BASE_URL = os.environ.get('USASPENDING_BASE_URL', 'https://api.usaspending.gov')
USASPENDING_USER_AGENT = os.environ.get('USASPENDING_USER_AGENT', 'Cosine Financial Platform (contact@cosine.financial)')
AWARDS_TABLE_NAME = os.environ.get('AWARDS_TABLE_NAME', 'usaspending-awards-index')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-usaspending-data-production')
REQUEST_TIMEOUT = int(os.environ.get('REQUEST_TIMEOUT', '30'))

# Get DynamoDB table
awards_table = dynamodb.Table(AWARDS_TABLE_NAME) if AWARDS_TABLE_NAME else None


def create_session():
    """Create a requests session with proper headers"""
    session = requests.Session()
    session.headers.update({
        'User-Agent': USASPENDING_USER_AGENT,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    })
    return session


def call_usaspending_api(endpoint: str, method: str = 'GET', body: Optional[Dict] = None, params: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Call USAspending API endpoint
    
    Args:
        endpoint: API endpoint path (e.g., '/api/v2/awards/CONT_AWD_123/')
        method: HTTP method ('GET' or 'POST')
        body: Request body for POST requests
        params: Query parameters for GET requests
    
    Returns:
        API response as dictionary
    """
    url = f"{USASPENDING_BASE_URL}{endpoint}"
    session = create_session()
    
    try:
        if method.upper() == 'POST':
            response = session.post(url, json=body, timeout=REQUEST_TIMEOUT)
        else:
            response = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
        
        response.raise_for_status()
        return response.json()
    
    except requests.exceptions.Timeout:
        logger.error(f"Timeout calling USAspending API: {url}")
        raise Exception(f"Request timeout: {url}")
    
    except requests.exceptions.HTTPError as e:
        logger.error(f"HTTP error calling USAspending API: {url}, Status: {e.response.status_code}")
        if e.response.status_code == 404:
            return None  # Award not found
        # Try to extract error message from response
        try:
            error_data = e.response.json()
            error_msg = error_data.get('detail') or error_data.get('message') or str(error_data)
        except:
            error_msg = e.response.text[:500] if e.response.text else "Unknown error"
        raise Exception(f"API error: {e.response.status_code} - {error_msg}")
    
    except requests.exceptions.RequestException as e:
        logger.error(f"Request error calling USAspending API: {url}, Error: {str(e)}")
        raise Exception(f"Request failed: {str(e)}")
    
    except json.JSONDecodeError as e:
        logger.error(f"JSON decode error for USAspending API response: {url}, Error: {str(e)}")
        raise Exception(f"Invalid JSON response: {str(e)}")
    
    except Exception as e:
        logger.error(f"Unexpected error calling USAspending API: {url}, Error: {str(e)}")
        raise


def extract_fiscal_year(date_str: Optional[str]) -> Optional[int]:
    """Extract fiscal year from date string (YYYY-MM-DD)"""
    if not date_str:
        return None
    try:
        date_obj = datetime.strptime(date_str.split('T')[0], '%Y-%m-%d')
        # Fiscal year: Oct 1 - Sep 30
        if date_obj.month >= 10:
            return date_obj.year + 1
        return date_obj.year
    except:
        return None


def convert_floats_to_decimal(obj: Any) -> Any:
    """
    Recursively convert all float values to Decimal for DynamoDB compatibility.
    DynamoDB doesn't support float types, only Decimal.
    """
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {key: convert_floats_to_decimal(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    else:
        return obj


def flatten_award_data(award_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flatten award data for DynamoDB storage
    Extracts key fields for indexing and GSI queries
    """
    award_id = award_data.get('generated_unique_award_id') or award_data.get('id')
    if not award_id:
        raise ValueError("Award ID not found in award data")
    
    # Extract agency information
    awarding_agency = award_data.get('awarding_agency', {})
    funding_agency = award_data.get('funding_agency', {})
    
    # Extract recipient information
    recipient = award_data.get('recipient', {})
    recipient_location = recipient.get('location', {}) if recipient else {}
    
    # Extract period of performance
    period_of_performance = award_data.get('period_of_performance', {})
    period_start_date = period_of_performance.get('start_date') if period_of_performance else None
    period_end_date = period_of_performance.get('end_date') if period_of_performance else None
    
    # Extract reference codes
    naics_hierarchy = award_data.get('naics_hierarchy', {})
    naics_code = None
    if naics_hierarchy:
        base_code = naics_hierarchy.get('base_code', {})
        naics_code = base_code.get('code') if base_code else None
    
    psc_hierarchy = award_data.get('psc_hierarchy', {})
    psc_code = None
    if psc_hierarchy:
        base_code = psc_hierarchy.get('base_code', {})
        psc_code = base_code.get('code') if base_code else None
    
    # Extract CFDA number (for financial assistance)
    cfda_number = None
    if award_data.get('category') == 'financial_assistance':
        cfda_info = award_data.get('cfda_info', [])
        if cfda_info and len(cfda_info) > 0:
            cfda_number = cfda_info[0].get('number')
    
    # Extract DEF codes
    def_codes = []
    if 'account_obligations_by_defc' in award_data:
        account_obligations = award_data['account_obligations_by_defc']
        if isinstance(account_obligations, dict):
            # If it's a dict, keys are DEF codes
            def_codes = list(account_obligations.keys())
        elif isinstance(account_obligations, list):
            # If it's a list, extract 'code' from each item
            def_codes = [item.get('code') for item in account_obligations if isinstance(item, dict) and item.get('code')]
    
    # Determine award type
    category = award_data.get('category', 'contract')
    award_type = category  # 'contract', 'idv', or 'financial_assistance'
    
    # Calculate fiscal year from period start date
    fiscal_year = extract_fiscal_year(period_start_date)
    
    # Normalize recipient name for GSI
    recipient_name = recipient.get('recipient_name') if recipient else None
    recipient_name_normalized = recipient_name.lower().strip() if recipient_name else None
    
    # Flattened award data
    flattened = {
        'award_id': award_id,
        'award_type': award_type,
        
        # Core award data
        'total_obligation': Decimal(str(award_data.get('total_obligation', 0))),
        'period_start_date': period_start_date,
        'period_end_date': period_end_date,
        'fiscal_year': fiscal_year,
        'description': award_data.get('description', ''),
        
        # Agency information
        'awarding_agency_id': awarding_agency.get('id') if awarding_agency else None,
        'awarding_agency_code': awarding_agency.get('toptier_agency', {}).get('toptier_code') if awarding_agency else None,
        'awarding_agency_name': awarding_agency.get('toptier_agency', {}).get('name') if awarding_agency else None,
        'funding_agency_id': funding_agency.get('id') if funding_agency else None,
        'funding_agency_code': funding_agency.get('toptier_agency', {}).get('toptier_code') if funding_agency else None,
        'funding_agency_name': funding_agency.get('toptier_agency', {}).get('name') if funding_agency else None,
        
        # Recipient information
        'recipient_id': recipient.get('recipient_id') if recipient else None,
        'recipient_name': recipient_name,
        'recipient_name_normalized': recipient_name_normalized,
        'recipient_unique_id': recipient.get('recipient_unique_id') if recipient else None,
        'recipient_location_state': recipient_location.get('state_code') if recipient_location else None,
        'recipient_location_country': recipient_location.get('country_code') if recipient_location else None,
        
        # Reference codes
        'naics_code': naics_code,
        'naics_description': naics_hierarchy.get('base_code', {}).get('description') if naics_hierarchy else None,
        'psc_code': psc_code,
        'psc_description': psc_hierarchy.get('base_code', {}).get('description') if psc_hierarchy else None,
        'cfda_number': cfda_number,
        'def_codes': def_codes,
        
        # Full response (store complete award object)
        # Convert all floats to Decimal for DynamoDB compatibility
        'full_response': convert_floats_to_decimal(award_data),
        
        # Metadata
        'indexed_at': datetime.now(timezone.utc).isoformat(),
        'last_updated': datetime.now(timezone.utc).isoformat(),
        'data_source': 'usaspending_api',
        'api_version': 'v2',
        
        # Flags (will be updated after transactions/subawards are indexed)
        'award_details_indexed': False,
        'full_indexing_complete': False,
        
        # TTL for cache expiration (90 days)
        'ttl': int((datetime.now(timezone.utc).timestamp() + (90 * 24 * 60 * 60)))
    }
    
    # Convert all floats to Decimal in the entire flattened structure for DynamoDB compatibility
    return convert_floats_to_decimal(flattened)


def fetch_all_transactions(award_id: str) -> List[Dict[str, Any]]:
    """
    Fetch all transactions for an award (paginated)
    
    Args:
        award_id: Award ID to fetch transactions for
    
    Returns:
        List of all transactions
    """
    all_transactions = []
    page = 1
    limit = 100
    
    logger.info(f"Fetching transactions for award {award_id}")
    
    while True:
        try:
            response = call_usaspending_api(
                '/api/v2/transactions/',
                method='POST',
                body={
                    'award_id': award_id,
                    'page': page,
                    'limit': limit,
                    'sort': 'action_date',
                    'order': 'desc'
                }
            )
            
            if not response:
                break
            
            transactions = response.get('results', [])
            if not transactions:
                break
            
            all_transactions.extend(transactions)
            logger.info(f"Fetched {len(transactions)} transactions (page {page}, total: {len(all_transactions)})")
            
            # Check if there are more pages
            page_metadata = response.get('page_metadata', {})
            if not page_metadata.get('hasNext', False):
                break
            
            page += 1
        
        except Exception as e:
            logger.error(f"Error fetching transactions page {page} for award {award_id}: {str(e)}")
            break
    
    logger.info(f"Total transactions fetched for award {award_id}: {len(all_transactions)}")
    return all_transactions


def fetch_all_subawards(award_id: str) -> List[Dict[str, Any]]:
    """
    Fetch all subawards for an award (paginated)
    
    Args:
        award_id: Award ID to fetch subawards for
    
    Returns:
        List of all subawards
    """
    all_subawards = []
    page = 1
    limit = 100
    
    logger.info(f"Fetching subawards for award {award_id}")
    
    while True:
        try:
            response = call_usaspending_api(
                '/api/v2/subawards/',
                method='POST',
                body={
                    'award_id': award_id,
                    'page': page,
                    'limit': limit,
                    'sort': 'subaward_amount',
                    'order': 'desc'
                }
            )
            
            if not response:
                break
            
            subawards = response.get('results', [])
            if not subawards:
                break
            
            all_subawards.extend(subawards)
            logger.info(f"Fetched {len(subawards)} subawards (page {page}, total: {len(all_subawards)})")
            
            # Check if there are more pages
            page_metadata = response.get('page_metadata', {})
            if not page_metadata.get('hasNext', False):
                break
            
            page += 1
        
        except Exception as e:
            logger.error(f"Error fetching subawards page {page} for award {award_id}: {str(e)}")
            break
    
    logger.info(f"Total subawards fetched for award {award_id}: {len(all_subawards)}")
    return all_subawards


def upload_award_details_to_s3(award_id: str, transactions: List[Dict], subawards: List[Dict]) -> str:
    """
    Combine transactions and subawards, gzip, and upload to S3
    
    Args:
        award_id: Award ID (used for S3 key)
        transactions: List of transaction objects
        subawards: List of subaward objects
    
    Returns:
        S3 key where the file was uploaded
    """
    # Build combined JSON object
    combined_data = {
        'transactions': transactions,
        'subawards': subawards,
        'indexed_at': datetime.now(timezone.utc).isoformat(),
        'transaction_count': len(transactions),
        'subaward_count': len(subawards)
    }
    
    # Convert to JSON and gzip
    combined_json = json.dumps(combined_data, default=str)
    combined_gzipped = gzip.compress(combined_json.encode('utf-8'))
    
    # S3 key: {award_id}/details.json.gz (using award_id as primary key)
    s3_key = f"{award_id}/details.json.gz"
    
    # Upload to S3
    try:
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=s3_key,
            Body=combined_gzipped,
            ContentType='application/json',
            ContentEncoding='gzip',
            ServerSideEncryption='aws:kms'  # Use KMS encryption if configured
        )
        logger.info(f"Uploaded award details to S3: {s3_key} ({len(combined_gzipped)} bytes gzipped)")
        return s3_key
    except Exception as e:
        logger.error(f"Error uploading award details to S3: {str(e)}")
        raise


def index_award(award_id: str, force_reindex: bool = False) -> Dict[str, Any]:
    """
    Index a single award: fetch details, transactions, subawards, and store in DynamoDB/S3
    
    Args:
        award_id: Award ID to index
        force_reindex: If True, re-index even if already indexed
    
    Returns:
        Dictionary with indexing results
    """
    try:
        logger.info(f"Starting indexing for award: {award_id}")
        
        # Check if award already exists and is fully indexed
        if not force_reindex and awards_table:
            try:
                existing_award = awards_table.get_item(Key={'award_id': award_id})
                if existing_award.get('Item') and existing_award['Item'].get('full_indexing_complete'):
                    logger.info(f"Award {award_id} already fully indexed, skipping")
                    return {
                        'success': True,
                        'award_id': award_id,
                        'skipped': True,
                        'message': 'Award already indexed'
                    }
            except Exception as e:
                logger.warning(f"Error checking existing award: {str(e)}")
        
        # Step 1: Fetch award details
        logger.info(f"Fetching award details for {award_id}")
        award_data = call_usaspending_api(f'/api/v2/awards/{award_id}/', method='GET')
        
        if not award_data:
            return {
                'success': False,
                'award_id': award_id,
                'error': 'Award not found'
            }
        
        # Step 2: Flatten award data
        try:
            flattened_award = flatten_award_data(award_data)
        except Exception as e:
            logger.error(f"Error flattening award data for {award_id}: {str(e)}", exc_info=True)
            return {
                'success': False,
                'award_id': award_id,
                'error': f'Error processing award data: {str(e)}'
            }
        
        # Step 3: Store award in DynamoDB (before fetching transactions/subawards)
        if awards_table:
            try:
                awards_table.put_item(Item=flattened_award)
                logger.info(f"Stored award {award_id} in DynamoDB")
            except Exception as e:
                logger.error(f"Error storing award in DynamoDB: {str(e)}", exc_info=True)
                return {
                    'success': False,
                    'award_id': award_id,
                    'error': f'Error storing award in DynamoDB: {str(e)}'
                }
        
        # Step 4: Fetch transactions and subawards
        try:
            transactions = fetch_all_transactions(award_id)
            subawards = fetch_all_subawards(award_id)
        except Exception as e:
            logger.error(f"Error fetching transactions/subawards for {award_id}: {str(e)}", exc_info=True)
            return {
                'success': False,
                'award_id': award_id,
                'error': f'Error fetching transactions/subawards: {str(e)}'
            }
        
        # Step 5: Upload combined file to S3
        try:
            s3_key = upload_award_details_to_s3(award_id, transactions, subawards)
        except Exception as e:
            logger.error(f"Error uploading award details to S3 for {award_id}: {str(e)}", exc_info=True)
            return {
                'success': False,
                'award_id': award_id,
                'error': f'Error uploading to S3: {str(e)}'
            }
        
        # Step 6: Update DynamoDB with S3 key and completion flags
        if awards_table:
            try:
                awards_table.update_item(
                    Key={'award_id': award_id},
                    UpdateExpression='SET award_details_s3_key = :key, award_details_indexed = :true, '
                                   'transaction_count = :tx_count, subaward_count = :sub_count, '
                                   'full_indexing_complete = :complete, last_updated = :updated',
                    ExpressionAttributeValues={
                        ':key': s3_key,
                        ':true': True,
                        ':tx_count': len(transactions),
                        ':sub_count': len(subawards),
                        ':complete': True,
                        ':updated': datetime.now(timezone.utc).isoformat()
                    }
                )
                logger.info(f"Updated award {award_id} with S3 key and completion flags")
            except Exception as e:
                logger.error(f"Error updating award in DynamoDB: {str(e)}", exc_info=True)
                return {
                    'success': False,
                    'award_id': award_id,
                    'error': f'Error updating DynamoDB: {str(e)}'
                }
        
        return {
            'success': True,
            'award_id': award_id,
            's3_key': s3_key,
            'transaction_count': len(transactions),
            'subaward_count': len(subawards),
            'message': 'Award indexed successfully'
        }
    
    except Exception as e:
        logger.error(f"Error indexing award {award_id}: {str(e)}", exc_info=True)
        return {
            'success': False,
            'award_id': award_id,
            'error': str(e)
        }


def index_multiple_awards(award_ids: List[str], force_reindex: bool = False) -> Dict[str, Any]:
    """
    Index multiple awards
    
    Args:
        award_ids: List of award IDs to index
        force_reindex: If True, re-index even if already indexed
    
    Returns:
        Dictionary with indexing results for all awards
    """
    results = {
        'total': len(award_ids),
        'successful': 0,
        'failed': 0,
        'skipped': 0,
        'results': []
    }
    
    for award_id in award_ids:
        result = index_award(award_id, force_reindex=force_reindex)
        results['results'].append(result)
        
        if result.get('skipped'):
            results['skipped'] += 1
        elif result.get('success'):
            results['successful'] += 1
        else:
            results['failed'] += 1
    
    return results


def build_search_filters(filters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build USAspending API search filters from user-provided filters
    
    Args:
        filters: Dictionary of filter fields (all searchable fields + GSI fields)
    
    Returns:
        Formatted filters dictionary for USAspending API
    """
    # Remove non-filter fields (limit, force_reindex, etc.)
    api_filters = {}
    non_filter_fields = ['limit', 'force_reindex', 'action']
    
    # General search fields
    if filters.get('recipient_search_text'):
        api_filters['recipient_search_text'] = filters['recipient_search_text'] if isinstance(filters['recipient_search_text'], list) else [filters['recipient_search_text']]
    
    if filters.get('keywords'):
        api_filters['keywords'] = filters['keywords'] if isinstance(filters['keywords'], list) else [filters['keywords']]
    
    if filters.get('description'):
        api_filters['description'] = filters['description'] if isinstance(filters['description'], list) else [filters['description']]
    
    # Award amounts
    if filters.get('award_amounts'):
        api_filters['award_amounts'] = filters['award_amounts']
    elif filters.get('min_obligation') or filters.get('max_obligation'):
        award_amounts = []
        if filters.get('min_obligation') or filters.get('max_obligation'):
            award_amounts.append({
                'lower_bound': filters.get('min_obligation'),
                'upper_bound': filters.get('max_obligation')
            })
        if award_amounts:
            api_filters['award_amounts'] = award_amounts
    
    # Time period
    if filters.get('time_period'):
        api_filters['time_period'] = filters['time_period'] if isinstance(filters['time_period'], list) else [filters['time_period']]
    elif filters.get('date_from') or filters.get('date_to'):
        time_period = [{
            'start_date': filters.get('date_from'),
            'end_date': filters.get('date_to'),
            'date_type': filters.get('date_type', 'action_date')
        }]
        api_filters['time_period'] = time_period
    
    # Agencies
    # Note: spending_by_transaction endpoint only accepts 'name', not 'toptier_code'
    if filters.get('agencies'):
        # If agencies are provided, ensure they use 'name' not 'toptier_code'
        agencies_list = filters['agencies'] if isinstance(filters['agencies'], list) else [filters['agencies']]
        cleaned_agencies = []
        for agency in agencies_list:
            cleaned_agency = agency.copy()
            # Remove toptier_code if present (not supported by spending_by_transaction)
            if 'toptier_code' in cleaned_agency:
                # If we have toptier_code but no name, we can't convert it - raise error
                if 'name' not in cleaned_agency:
                    raise ValueError(
                        f"Agency filter has 'toptier_code' ({cleaned_agency.get('toptier_code')}) but 'name' is required for spending_by_transaction endpoint. "
                        f"Please provide 'name' instead of or in addition to 'toptier_code'. "
                        f"Example: {{'type': 'awarding', 'tier': 'toptier', 'name': 'Department of Defense'}}"
                    )
                # Remove toptier_code since it's not supported (name is present, so we can use that)
                del cleaned_agency['toptier_code']
            cleaned_agencies.append(cleaned_agency)
        if cleaned_agencies:
            api_filters['agencies'] = cleaned_agencies
    elif filters.get('awarding_agency_code') or filters.get('awarding_agency_name'):
        agencies = []
        # For spending_by_transaction, we need 'name', not 'toptier_code'
        if filters.get('awarding_agency_name'):
            agencies.append({
                'type': 'awarding',
                'tier': 'toptier',
                'name': filters['awarding_agency_name']
            })
        elif filters.get('awarding_agency_code'):
            # Can't use code directly - need name
            raise ValueError(
                f"Cannot use 'awarding_agency_code' ({filters['awarding_agency_code']}) - 'awarding_agency_name' is required for spending_by_transaction endpoint. "
                f"Please provide 'awarding_agency_name' instead."
            )
        
        if filters.get('funding_agency_name'):
            agencies.append({
                'type': 'funding',
                'tier': 'toptier',
                'name': filters['funding_agency_name']
            })
        elif filters.get('funding_agency_code'):
            # Can't use code directly - need name
            raise ValueError(
                f"Cannot use 'funding_agency_code' ({filters['funding_agency_code']}) - 'funding_agency_name' is required for spending_by_transaction endpoint. "
                f"Please provide 'funding_agency_name' instead."
            )
        
        if agencies:
            api_filters['agencies'] = agencies
    
    # Award types
    if filters.get('award_type_codes'):
        api_filters['award_type_codes'] = filters['award_type_codes'] if isinstance(filters['award_type_codes'], list) else [filters['award_type_codes']]
    
    # Location filters
    if filters.get('place_of_performance_locations'):
        api_filters['place_of_performance_locations'] = filters['place_of_performance_locations']
    if filters.get('recipient_locations'):
        api_filters['recipient_locations'] = filters['recipient_locations']
    
    # Reference codes
    if filters.get('naics_codes'):
        api_filters['naics_codes'] = filters['naics_codes'] if isinstance(filters['naics_codes'], list) else [filters['naics_codes']]
    if filters.get('psc_codes'):
        api_filters['psc_codes'] = filters['psc_codes'] if isinstance(filters['psc_codes'], list) else [filters['psc_codes']]
    if filters.get('program_numbers') or filters.get('cfda_number'):
        program_numbers = filters.get('program_numbers', [])
        if filters.get('cfda_number'):
            program_numbers.append(filters['cfda_number'])
        if program_numbers:
            api_filters['program_numbers'] = program_numbers if isinstance(program_numbers, list) else [program_numbers]
    
    # Advanced filters
    if filters.get('tas_codes'):
        api_filters['tas_codes'] = filters['tas_codes'] if isinstance(filters['tas_codes'], list) else [filters['tas_codes']]
    if filters.get('treasury_account_components'):
        api_filters['treasury_account_components'] = filters['treasury_account_components']
    if filters.get('program_activity') or filters.get('program_activities'):
        program_activities = filters.get('program_activities', [])
        if filters.get('program_activity'):
            program_activities.append(filters['program_activity'])
        if program_activities:
            api_filters['program_activities'] = program_activities if isinstance(program_activities, list) else [program_activities]
    if filters.get('contract_pricing_type_codes'):
        api_filters['contract_pricing_type_codes'] = filters['contract_pricing_type_codes'] if isinstance(filters['contract_pricing_type_codes'], list) else [filters['contract_pricing_type_codes']]
    if filters.get('set_aside_type_codes'):
        api_filters['set_aside_type_codes'] = filters['set_aside_type_codes'] if isinstance(filters['set_aside_type_codes'], list) else [filters['set_aside_type_codes']]
    if filters.get('extent_competed_type_codes'):
        api_filters['extent_competed_type_codes'] = filters['extent_competed_type_codes'] if isinstance(filters['extent_competed_type_codes'], list) else [filters['extent_competed_type_codes']]
    if filters.get('recipient_type_names'):
        api_filters['recipient_type_names'] = filters['recipient_type_names'] if isinstance(filters['recipient_type_names'], list) else [filters['recipient_type_names']]
    if filters.get('recipient_scope'):
        api_filters['recipient_scope'] = filters['recipient_scope']
    if filters.get('place_of_performance_scope'):
        api_filters['place_of_performance_scope'] = filters['place_of_performance_scope']
    if filters.get('def_codes'):
        api_filters['def_codes'] = filters['def_codes'] if isinstance(filters['def_codes'], list) else [filters['def_codes']]
    if filters.get('award_ids'):
        api_filters['award_ids'] = filters['award_ids'] if isinstance(filters['award_ids'], list) else [filters['award_ids']]
    if filters.get('award_unique_id'):
        api_filters['award_unique_id'] = filters['award_unique_id']
    
    # GSI fields (fiscal_year, recipient_id, etc.) - these are used for DynamoDB queries, not API filters
    # But we can use fiscal_year to filter time_period if not already set
    if filters.get('fiscal_year') and 'time_period' not in api_filters:
        # Convert fiscal year to date range (Oct 1 - Sep 30)
        fiscal_year = filters['fiscal_year']
        if isinstance(fiscal_year, list):
            fiscal_year = fiscal_year[0]
        start_date = f"{fiscal_year - 1}-10-01"
        end_date = f"{fiscal_year}-09-30"
        api_filters['time_period'] = [{
            'start_date': start_date,
            'end_date': end_date,
            'date_type': 'action_date'
        }]
    
    return api_filters


def search_and_index_awards(filters: Dict[str, Any], limit: int = 100, force_reindex: bool = False) -> Dict[str, Any]:
    """
    Search for awards using filters and index all found awards
    
    Args:
        filters: Search filter dictionary (all searchable fields + GSI fields)
        limit: Maximum number of awards to search and index
        force_reindex: If True, re-index even if already indexed
    
    Returns:
        Dictionary with search and indexing results
    """
    logger.info(f"Searching for awards with filters: {json.dumps(filters, default=str)}")
    
    # Build API filters
    api_filters = build_search_filters(filters)
    logger.info(f"Built API filters: {json.dumps(api_filters, default=str)}")
    
    # Search for awards
    all_award_ids = []
    page = 1
    page_limit = min(limit, 100)  # API limit per page
    
    while len(all_award_ids) < limit:
        try:
            # Use spending_by_transaction endpoint (more reliable based on test script)
            # Note: sort field must be included in fields array
            search_body = {
                'filters': api_filters,
                'fields': [
                    'Award ID',
                    'generated_internal_id',
                    'internal_id',
                    'Recipient Name',
                    'Awarding Agency',
                    'Transaction Amount',  # Required for sorting
                    'Action Date',
                    'Award Type'
                ],
                'limit': page_limit,
                'page': page,
                'sort': 'Transaction Amount',
                'order': 'desc'
            }
            
            logger.info(f"Searching page {page} with filters: {json.dumps(api_filters, default=str)}")
            response = call_usaspending_api('/api/v2/search/spending_by_transaction/', method='POST', body=search_body)
            
            if not response:
                logger.warning(f"No response from API on page {page}")
                break
            
            # Log API messages if present (often contains useful info about why no results)
            if response.get('messages'):
                logger.warning(f"API messages: {response.get('messages')}")
            
            results = response.get('results', [])
            if not results:
                logger.warning(f"No results found on page {page}")
                # Log full response structure for debugging
                logger.info(f"Response structure: {json.dumps({k: type(v).__name__ for k, v in response.items()}, default=str)}")
                if response.get('page_metadata'):
                    logger.info(f"Page metadata: {response.get('page_metadata')}")
                break
            
            logger.info(f"Found {len(results)} transactions on page {page}")
            
            # Extract award IDs from transactions
            for result in results:
                # Try multiple fields for award ID (based on test script)
                award_id = result.get('generated_internal_id') or result.get('internal_id') or result.get('Award ID')
                if award_id and award_id not in all_award_ids:
                    all_award_ids.append(award_id)
                    if len(all_award_ids) >= limit:
                        break
            
            logger.info(f"Found {len(all_award_ids)} unique awards so far (page {page})")
            
            # Check if there are more pages
            page_metadata = response.get('page_metadata', {})
            if not page_metadata.get('hasNext', False) or len(all_award_ids) >= limit:
                break
            
            page += 1
        
        except Exception as e:
            logger.error(f"Error searching for awards on page {page}: {str(e)}", exc_info=True)
            # If it's an API error (400, 422, etc.), we should return error instead of empty results
            error_msg = str(e)
            if 'API error:' in error_msg or '400' in error_msg or '422' in error_msg:
                # Re-raise to be caught by lambda_handler
                raise Exception(f"Search API error: {error_msg}")
            break
    
    logger.info(f"Total unique awards found: {len(all_award_ids)}")
    
    # Index all found awards
    indexing_results = index_multiple_awards(all_award_ids[:limit], force_reindex=force_reindex)
    
    return {
        'search_results': {
            'total_found': len(all_award_ids),
            'award_ids': all_award_ids[:limit]
        },
        'indexing_results': indexing_results
    }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for USAspending indexing requests
    
    Expected event structure (API Gateway):
    {
        "httpMethod": "POST",
        "body": "{\"action\": \"search_and_index\", \"filters\": {...}, ...}"
    }
    
    Or direct invocation:
    {
        "action": "index_award" | "index_multiple" | "search_and_index",
        "award_id": "CONT_AWD_123",  // For single award
        "award_ids": ["CONT_AWD_123", ...],  // For multiple awards
        "filters": {...},  // For search_and_index (all searchable fields + GSI fields)
        "limit": 100,  // For search_and_index
        "force_reindex": false
    }
    """
    try:
        # Handle API Gateway event
        if event.get('httpMethod'):
            headers = {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
            }
            
            if event['httpMethod'] == 'OPTIONS':
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps({'message': 'CORS pre-flight response'})
                }
            
            try:
                body = json.loads(event.get('body', '{}'))
            except json.JSONDecodeError:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Invalid JSON in request body'
                    })
                }
        else:
            # Direct invocation
            body = event
            headers = {'Content-Type': 'application/json'}
        
        logger.info(f"Received indexing request: {json.dumps(body)}")
        
        action = body.get('action', 'index_award')
        force_reindex = body.get('force_reindex', False)
        
        if action == 'index_award':
            award_id = body.get('award_id')
            if not award_id:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Missing award_id',
                        'message': 'Please provide award_id in request body'
                    })
                }
            
            result = index_award(award_id, force_reindex=force_reindex)
            
            if result.get('success'):
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps(result)
                }
            else:
                return {
                    'statusCode': 500,
                    'headers': headers,
                    'body': json.dumps(result)
                }
        
        elif action == 'index_multiple':
            award_ids = body.get('award_ids', [])
            if not award_ids:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Missing award_ids',
                        'message': 'Please provide award_ids array in request body'
                    })
                }
            
            results = index_multiple_awards(award_ids, force_reindex=force_reindex)
            
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps(results)
            }
        
        elif action == 'search_and_index':
            filters = body.get('filters', {})
            # Remove limit from filters if it's accidentally included there
            if 'limit' in filters:
                logger.warning("Found 'limit' in filters object, removing it (should be top-level)")
                filters = {k: v for k, v in filters.items() if k != 'limit'}
            limit = body.get('limit', 100)
            
            if not filters:
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Missing filters',
                        'message': 'Please provide filters in request body'
                    })
                }
            
            try:
                results = search_and_index_awards(filters, limit=limit, force_reindex=force_reindex)
                
                return {
                    'statusCode': 200,
                    'headers': headers,
                    'body': json.dumps(results)
                }
            except ValueError as e:
                # Validation errors (e.g., missing required fields, invalid filter format)
                error_msg = str(e)
                logger.error(f"Validation error in search_and_index: {error_msg}")
                return {
                    'statusCode': 400,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Invalid request',
                        'message': error_msg,
                        'search_results': {
                            'total_found': 0,
                            'award_ids': []
                        },
                        'indexing_results': {
                            'total': 0,
                            'successful': 0,
                            'failed': 0,
                            'skipped': 0,
                            'results': []
                        }
                    })
                }
            except Exception as e:
                error_msg = str(e)
                # Determine status code based on error type
                if 'API error: 400' in error_msg or '400' in error_msg:
                    status_code = 400
                elif 'API error: 422' in error_msg or '422' in error_msg:
                    status_code = 422
                elif 'API error: 404' in error_msg or '404' in error_msg:
                    status_code = 404
                else:
                    status_code = 500
                
                logger.error(f"Error in search_and_index: {error_msg}", exc_info=True)
                return {
                    'statusCode': status_code,
                    'headers': headers,
                    'body': json.dumps({
                        'error': 'Search failed',
                        'message': error_msg,
                        'search_results': {
                            'total_found': 0,
                            'award_ids': []
                        },
                        'indexing_results': {
                            'total': 0,
                            'successful': 0,
                            'failed': 0,
                            'skipped': 0,
                            'results': []
                        }
                    })
                }
        
        else:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({
                    'error': 'Invalid action',
                    'message': f'Unknown action: {action}. Supported actions: index_award, index_multiple, search_and_index'
                })
            }
    
    except Exception as e:
        logger.error(f"Error processing indexing request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': headers if 'headers' in locals() else {'Content-Type': 'application/json'},
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }

