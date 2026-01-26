"""
USAspending Award Enrichment Lambda Function
Fetches up-to-date award data from USAspending API and updates DynamoDB
"""

import json
import os
import logging
import boto3
import gzip
import hashlib
import time
import requests
from typing import Dict, List, Any, Optional
from decimal import Decimal
import decimal
from datetime import datetime, timezone
import sys
from cors_helper import get_cors_headers, validate_origin


# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Environment variables
AWARDS_TABLE_NAME = os.environ.get('AWARDS_TABLE_NAME', 'usaspending-awards-index')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-usaspending-data-production')
USASPENDING_BASE_URL = os.environ.get('USASPENDING_BASE_URL', 'https://api.usaspending.gov')
USASPENDING_USER_AGENT = os.environ.get('USASPENDING_USER_AGENT', 'Cosine Financial Platform (contact@cosine.financial)')
REQUEST_TIMEOUT = int(os.environ.get('REQUEST_TIMEOUT', '30'))
MAX_RETRIES = int(os.environ.get('MAX_RETRIES', '5'))
RETRY_BASE_DELAY = float(os.environ.get('RETRY_BASE_DELAY', '2.0'))

# Get DynamoDB table
awards_table = dynamodb.Table(AWARDS_TABLE_NAME) if AWARDS_TABLE_NAME else None

# Global session for connection pooling
_global_session = None
_last_api_call_time = 0


def build_cors_headers(origin: str = None):
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        **get_cors_headers(origin),
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
    }


def create_session():
    """Create a requests session with proper headers and retry logic"""
    global _global_session
    
    if _global_session is not None:
        return _global_session
    
    session = requests.Session()
    session.headers.update({
        'User-Agent': USASPENDING_USER_AGENT,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    })
    
    _global_session = session
    return session


def rate_limit():
    """Enforce rate limiting between API calls"""
    global _last_api_call_time
    current_time = time.time()
    time_since_last_call = current_time - _last_api_call_time
    
    parallel_rate_limit = 0.1
    if time_since_last_call < parallel_rate_limit:
        sleep_time = parallel_rate_limit - time_since_last_call
        time.sleep(sleep_time)
    
    _last_api_call_time = time.time()


def call_usaspending_api(endpoint: str, method: str = 'GET', body: Optional[Dict] = None, params: Optional[Dict] = None) -> Dict[str, Any]:
    """Call USAspending API endpoint with retry logic and rate limiting"""
    url = f"{USASPENDING_BASE_URL}{endpoint}"
    session = create_session()
    
    rate_limit()
    
    last_exception = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            if method.upper() == 'POST':
                response = session.post(url, json=body, timeout=REQUEST_TIMEOUT)
            else:
                response = session.get(url, params=params, timeout=REQUEST_TIMEOUT)
            
            if response.status_code == 429:
                retry_after = int(response.headers.get('Retry-After', RETRY_BASE_DELAY * (2 ** attempt)))
                if attempt < MAX_RETRIES:
                    logger.warning(f"Rate limited (429). Waiting {retry_after}s before retry {attempt + 1}/{MAX_RETRIES}")
                    time.sleep(retry_after)
                    continue
                else:
                    response.raise_for_status()
            
            if response.status_code >= 500:
                if attempt < MAX_RETRIES:
                    backoff_delay = RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(f"Server error {response.status_code}. Retrying in {backoff_delay}s (attempt {attempt + 1}/{MAX_RETRIES})")
                    time.sleep(backoff_delay)
                    continue
                else:
                    response.raise_for_status()
            
            response.raise_for_status()
            return response.json()
            
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout, 
                requests.exceptions.RequestException) as e:
            last_exception = e
            if attempt < MAX_RETRIES:
                backoff_delay = RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(f"Request error (attempt {attempt + 1}/{MAX_RETRIES}): {str(e)[:200]}")
                time.sleep(backoff_delay)
                continue
            else:
                raise
    
    if last_exception:
        raise last_exception
    raise Exception("Failed to call USAspending API after retries")


def fetch_all_transactions(award_id: str) -> List[Dict[str, Any]]:
    """Fetch all transactions for an award with pagination"""
    all_transactions = []
    page = 1
    limit = 5000  # Max per page
    
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
            
            results = response.get('results', [])
            if not results:
                break
            
            all_transactions.extend(results)
            
            # Check if there are more pages
            page_metadata = response.get('page_metadata', {})
            if not page_metadata.get('hasNext', False):
                break
            
            page += 1
            
        except Exception as e:
            logger.error(f"Error fetching transactions page {page} for award {award_id}: {str(e)}")
            break
    
    logger.info(f"Fetched {len(all_transactions)} transactions for award {award_id}")
    return all_transactions


def fetch_all_subawards(award_id: str) -> List[Dict[str, Any]]:
    """Fetch all subawards for an award with pagination"""
    all_subawards = []
    page = 1
    limit = 100  # Default limit
    
    while True:
        try:
            response = call_usaspending_api(
                '/api/v2/subawards/',
                method='POST',
                body={
                    'award_id': award_id,
                    'page': page,
                    'limit': limit,
                    'sort': 'subaward_number',
                    'order': 'desc'
                }
            )
            
            results = response.get('results', [])
            if not results:
                break
            
            all_subawards.extend(results)
            
            # Check if there are more pages
            page_metadata = response.get('page_metadata', {})
            if not page_metadata.get('hasNext', False):
                break
            
            page += 1
            
        except Exception as e:
            logger.error(f"Error fetching subawards page {page} for award {award_id}: {str(e)}")
            break
    
    logger.info(f"Fetched {len(all_subawards)} subawards for award {award_id}")
    return all_subawards


def fetch_child_award_ids(award_id: str) -> List[str]:
    """Fetch child award IDs for an IDV with pagination"""
    all_child_award_ids = []
    page = 1
    limit = 100  # Default limit
    
    while True:
        try:
            response = call_usaspending_api(
                '/api/v2/idvs/awards/',
                method='POST',
                body={
                    'award_id': award_id,
                    'type': 'child_awards',
                    'page': page,
                    'limit': limit,
                    'sort': 'period_of_performance_start_date',
                    'order': 'desc'
                }
            )
            
            results = response.get('results', [])
            if not results:
                break
            
            # Extract child award IDs from results
            for child in results:
                child_id = child.get('generated_unique_award_id') or child.get('award_id')
                if child_id:
                    all_child_award_ids.append(str(child_id))
            
            # Check if there are more pages
            page_metadata = response.get('page_metadata', {})
            if not page_metadata.get('hasNext', False):
                break
            
            page += 1
            
        except Exception as e:
            logger.error(f"Error fetching child award IDs page {page} for IDV {award_id}: {str(e)}")
            break
    
    logger.info(f"Fetched {len(all_child_award_ids)} child award IDs for IDV {award_id}")
    return all_child_award_ids


def store_child_award_as_full_record(child_award_id: str, parent_idv_id: str, parent_award: Optional[Dict[str, Any]] = None) -> bool:
    """
    Fetch and store a child award as a full award record in DynamoDB.
    Mimics the glue job behavior - stores child awards as complete award records.
    """
    try:
        logger.info(f"Fetching full details for child award {child_award_id}...")
        
        # Check if child award already exists
        existing_child = get_existing_award(child_award_id)
        if existing_child:
            logger.info(f"Child award {child_award_id} already exists in DynamoDB, will update with fresh data")
        
        # Fetch full award details from USAspending API
        child_award_details = fetch_award_details(child_award_id)
        if not child_award_details:
            logger.warning(f"❌ Could not fetch full details for child award {child_award_id} from USAspending API")
            return False
        
        logger.info(f"✅ Fetched award details for {child_award_id}, fetching transactions and subawards...")
        
        # Fetch transactions for child award
        logger.info(f"Fetching transactions for child award {child_award_id}...")
        child_transactions = fetch_all_transactions(child_award_id)
        normalized_child_transactions = [normalize_transaction(tx) for tx in child_transactions]
        logger.info(f"Fetched {len(normalized_child_transactions)} transactions for child award {child_award_id}")
        
        # Fetch subawards for child award
        logger.info(f"Fetching subawards for child award {child_award_id}...")
        child_subawards = fetch_all_subawards(child_award_id)
        normalized_child_subawards = [normalize_subaward(sub) for sub in child_subawards]
        logger.info(f"Fetched {len(normalized_child_subawards)} subawards for child award {child_award_id}")
        
        # Build child award record similar to glue job format
        # Start with required fields
        child_award_record = {
            'award_id': child_award_id,  # Primary key - required
            'parent_idv_id': parent_idv_id,  # Link to parent IDV
            'is_idv_child': True,  # Flag indicating this is a child award
            'award_type': child_award_details.get('type', ''),
            'award_type_description': child_award_details.get('type_description', ''),
            'category': child_award_details.get('category', 'contract'),
            'description': child_award_details.get('description', ''),
            'total_obligated_amount': Decimal(str(child_award_details.get('total_obligation', 0))),
            'transaction_count': len(normalized_child_transactions),
            'subaward_count': len(normalized_child_subawards),
            'transactions': convert_floats_to_decimal(normalized_child_transactions),
            'subawards': convert_floats_to_decimal(normalized_child_subawards),
            'data_source': 'usaspending_api_enrichment',
            'api_version': 'api_v2',
            'indexed_at': datetime.now(timezone.utc).isoformat(),
            'last_updated': datetime.now(timezone.utc).isoformat(),
            'full_indexing_complete': True,
            'ttl': int((datetime.now(timezone.utc).timestamp() + (90 * 24 * 60 * 60))),
            'usaspending_permalink': f'https://www.usaspending.gov/award/{child_award_id}',  # USAspending URL for frontend auto-detection
        }
        
        logger.info(f"Built child award record for {child_award_id} with {len(normalized_child_transactions)} transactions and {len(normalized_child_subawards)} subawards")
        
        # Extract and add fields from award details API response
        # Map API response fields to DynamoDB schema (matching glue job format)
        if 'piid' in child_award_details:
            child_award_record['award_id_piid'] = child_award_details['piid']
        
        # Dates
        if 'date_signed' in child_award_details:
            child_award_record['period_of_performance_start_date'] = child_award_details['date_signed']
            child_award_record['period_start_date'] = child_award_details['date_signed']
        if 'period_of_performance_current_end_date' in child_award_details:
            child_award_record['period_of_performance_current_end_date'] = child_award_details['period_of_performance_current_end_date']
            child_award_record['period_end_date'] = child_award_details['period_of_performance_current_end_date']
        
        # Fiscal year from start date
        if 'date_signed' in child_award_details:
            try:
                from datetime import datetime as dt
                date_obj = dt.strptime(child_award_details['date_signed'], '%Y-%m-%d')
                # Fiscal year: Oct 1 - Sep 30, so if month >= 10, fiscal year is next calendar year
                fiscal_year = date_obj.year if date_obj.month < 10 else date_obj.year + 1
                child_award_record['fiscal_year'] = fiscal_year
            except:
                pass
        
        # Agency information
        if 'awarding_agency' in child_award_details:
            agency = child_award_details['awarding_agency']
            if isinstance(agency, dict):
                if agency.get('name'):
                    child_award_record['awarding_agency_name'] = agency.get('name')
                if agency.get('id'):
                    child_award_record['awarding_agency_code'] = str(agency.get('id'))
        
        if 'funding_agency' in child_award_details:
            agency = child_award_details['funding_agency']
            if isinstance(agency, dict):
                if agency.get('name'):
                    child_award_record['funding_agency_name'] = agency.get('name')
                if agency.get('id'):
                    child_award_record['funding_agency_code'] = str(agency.get('id'))
        
        # Recipient information
        if 'recipient' in child_award_details:
            recipient = child_award_details['recipient']
            if isinstance(recipient, dict):
                recipient_name = recipient.get('name', '')
                if recipient_name:
                    child_award_record['recipient_name'] = recipient_name
                    child_award_record['recipient_name_normalized'] = recipient_name.lower()
                if 'location' in recipient and isinstance(recipient['location'], dict):
                    location = recipient['location']
                    if location.get('state_code'):
                        child_award_record['recipient_location_state'] = location.get('state_code')
                    if location.get('state_name'):
                        child_award_record['recipient_state_name'] = location.get('state_name')
                    if location.get('city_name'):
                        child_award_record['recipient_city_name'] = location.get('city_name')
                    if location.get('country_name'):
                        child_award_record['recipient_country_name'] = location.get('country_name')
        
        # Place of performance
        if 'place_of_performance' in child_award_details:
            pop = child_award_details['place_of_performance']
            if isinstance(pop, dict):
                if pop.get('state_code'):
                    child_award_record['primary_place_of_performance_state_code'] = pop.get('state_code')
                if pop.get('state_name'):
                    child_award_record['primary_place_of_performance_state_name'] = pop.get('state_name')
                if pop.get('city_name'):
                    child_award_record['primary_place_of_performance_city_name'] = pop.get('city_name')
                if pop.get('country_name'):
                    child_award_record['primary_place_of_performance_country_name'] = pop.get('country_name')
        
        # Additional important fields
        if 'base_exercised_options' in child_award_details and child_award_details['base_exercised_options'] is not None:
            try:
                child_award_record['base_and_exercised_options_value'] = Decimal(str(child_award_details['base_exercised_options']))
            except (ValueError, TypeError, decimal.InvalidOperation) as e:
                logger.warning(f"Could not convert base_exercised_options to Decimal for child award {child_award_id}: {e}")
        
        if 'base_and_all_options' in child_award_details and child_award_details['base_and_all_options'] is not None:
            try:
                child_award_record['base_and_all_options_value'] = Decimal(str(child_award_details['base_and_all_options']))
            except (ValueError, TypeError, decimal.InvalidOperation) as e:
                logger.warning(f"Could not convert base_and_all_options to Decimal for child award {child_award_id}: {e}")
        
        # Update outlay amounts (Amount Paid in UI)
        # The UI checks multiple field names: total_outlayed_amount_for_overall_award, total_outlay, total_account_outlay
        if 'total_account_outlay' in child_award_details and child_award_details['total_account_outlay'] is not None:
            try:
                outlay_amount = Decimal(str(child_award_details['total_account_outlay']))
                child_award_record['total_account_outlay'] = outlay_amount
                child_award_record['total_outlay'] = outlay_amount
                child_award_record['total_outlayed_amount_for_overall_award'] = str(outlay_amount)  # UI expects string for this field
                child_award_record['total_outlayed_amount'] = outlay_amount
            except (ValueError, TypeError, decimal.InvalidOperation) as e:
                logger.warning(f"Could not convert total_account_outlay to Decimal for child award {child_award_id}: {e}")
        
        # Merge with existing data if it exists
        if existing_child:
            # Preserve existing fields that might not be in API response
            for key, value in existing_child.items():
                if key not in child_award_record and key not in ['transactions', 'subawards', 'transaction_count', 'subaward_count']:
                    child_award_record[key] = value
        
        # Ensure full_indexing_complete is set
        child_award_record['full_indexing_complete'] = True
        
        # Inherit missing GSI key fields from parent IDV if available
        if parent_award:
            gsi_key_fields_to_inherit = [
                'awarding_agency_code', 'awarding_agency_name',
                'funding_agency_code', 'funding_agency_name',
                'recipient_name_normalized', 'recipient_location_state',
                'fiscal_year'
            ]
            for key in gsi_key_fields_to_inherit:
                # Only inherit if child award doesn't have the field or it's empty
                if key not in child_award_record or child_award_record.get(key) == '':
                    parent_value = parent_award.get(key)
                    if parent_value and parent_value != '':
                        child_award_record[key] = parent_value
                        logger.info(f"Inherited {key} from parent IDV for child award {child_award_id}")
        
        # Remove empty strings from GSI keys (DynamoDB doesn't allow empty strings for key attributes)
        # GSI keys that cannot be empty strings:
        gsi_key_fields = [
            'awarding_agency_code', 'awarding_agency_name', 
            'recipient_name_normalized', 'recipient_location_state',
            'award_type', 'fiscal_year'
        ]
        for key in gsi_key_fields:
            if key in child_award_record and child_award_record[key] == '':
                del child_award_record[key]
                logger.warning(f"Removed empty string GSI key '{key}' from child award {child_award_id}")
        
        # Store child award in DynamoDB
        logger.info(f"Storing child award {child_award_id} to DynamoDB (transaction_count={child_award_record.get('transaction_count', 0)}, subaward_count={child_award_record.get('subaward_count', 0)})...")
        success = update_award_in_dynamodb(child_award_id, child_award_record)
        
        if success:
            logger.info(f"✅ Successfully stored child award {child_award_id} as full award record in DynamoDB")
            return True
        else:
            logger.error(f"❌ Failed to store child award {child_award_id} in DynamoDB")
            return False
            
    except Exception as e:
        logger.error(f"Error storing child award {child_award_id} as full record: {str(e)}", exc_info=True)
        return False


def fetch_idv_amounts(award_id: str) -> Optional[Dict[str, Any]]:
    """Fetch combined amounts for an IDV"""
    try:
        response = call_usaspending_api(f'/api/v2/idvs/amounts/{award_id}/', method='GET')
        return response
    except Exception as e:
        logger.error(f"Error fetching IDV amounts for {award_id}: {str(e)}")
        return None


def fetch_award_details(award_id: str) -> Optional[Dict[str, Any]]:
    """Fetch full award details from USAspending API"""
    try:
        response = call_usaspending_api(f'/api/v2/awards/{award_id}/', method='GET')
        return response
    except Exception as e:
        logger.error(f"Error fetching award details for {award_id}: {str(e)}")
        return None


def convert_floats_to_decimal(obj: Any) -> Any:
    """Recursively convert float values to Decimal for DynamoDB"""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {key: convert_floats_to_decimal(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    else:
        return obj


def calculate_hash(data: Any) -> str:
    """Calculate hash of data for comparison"""
    # Convert to JSON string and hash
    json_str = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(json_str.encode('utf-8')).hexdigest()


def normalize_transaction(tx: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize transaction data to match DynamoDB schema"""
    normalized = {}
    
    # Map USAspending API fields to our schema
    field_mapping = {
        'id': 'transaction_unique_key',
        'action_date': 'action_date',
        'action_type': 'action_type_code',
        'action_type_description': 'action_type_description',
        'modification_number': 'modification_number',
        'description': 'transaction_description',
        'federal_action_obligation': 'federal_action_obligation',
        'face_value_loan_guarantee': 'face_value_of_loan',
        'original_loan_subsidy_cost': 'original_loan_subsidy_cost',
        'cfda_number': 'cfda_number',
        'type': 'transaction_type_code',
        'type_description': 'transaction_type_description'
    }
    
    for api_field, db_field in field_mapping.items():
        if api_field in tx and tx[api_field] is not None:
            normalized[db_field] = tx[api_field]
    
    return normalized


def normalize_subaward(sub: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize subaward data to match DynamoDB schema"""
    normalized = {}
    
    # Map USAspending API fields to our schema
    field_mapping = {
        'id': 'subaward_id',
        'subaward_number': 'subaward_number',
        'description': 'subaward_description',
        'action_date': 'subaward_action_date',
        'amount': 'subaward_amount',
        'recipient_name': 'subawardee_name'
    }
    
    for api_field, db_field in field_mapping.items():
        if api_field in sub and sub[api_field] is not None:
            normalized[db_field] = sub[api_field]
    
    return normalized


def normalize_child_award(child: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize child award data"""
    normalized = {}
    
    # Map USAspending API fields
    field_mapping = {
        'generated_unique_award_id': 'award_id',
        'award_id': 'award_id_internal',
        'piid': 'piid',
        'description': 'description',
        'obligated_amount': 'total_obligated_amount',
        'period_of_performance_start_date': 'period_of_performance_start_date',
        'period_of_performance_current_end_date': 'period_of_performance_current_end_date',
        'award_type': 'award_type',
        'funding_agency': 'funding_agency_name',
        'awarding_agency': 'awarding_agency_name'
    }
    
    for api_field, db_field in field_mapping.items():
        if api_field in child and child[api_field] is not None:
            normalized[db_field] = child[api_field]
    
    return normalized


def fetch_oversized_award_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """Fetch oversized award from S3"""
    try:
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        compressed_data = response['Body'].read()
        json_data = gzip.decompress(compressed_data)
        award_data = json.loads(json_data.decode('utf-8'))
        return award_data
    except Exception as e:
        logger.error(f"Error fetching oversized award from S3 {s3_key}: {str(e)}")
        return None


def get_existing_award(award_id: str) -> Optional[Dict[str, Any]]:
    """Get existing award from DynamoDB, including fetching from S3 if oversized"""
    try:
        response = awards_table.get_item(Key={'award_id': award_id})
        item = response.get('Item')
        
        if not item:
            return None
        
        # Convert is_assistance from bytes to number if needed (for GSI compatibility)
        if 'is_assistance' in item:
            is_assistance_val = item['is_assistance']
            if isinstance(is_assistance_val, bytes):
                item['is_assistance'] = 1 if is_assistance_val == b'\x01' else 0
            elif isinstance(is_assistance_val, bool):
                item['is_assistance'] = 1 if is_assistance_val else 0
        
        # If this is an oversized award, fetch full data from S3
        oversize_s3_key = item.get('oversize_s3_key')
        if oversize_s3_key:
            logger.info(f"Fetching full award data from S3 for oversized award {award_id}")
            full_award = fetch_oversized_award_from_s3(oversize_s3_key)
            if full_award:
                # Convert is_assistance in S3 data too if needed
                if 'is_assistance' in full_award:
                    is_assistance_val = full_award['is_assistance']
                    if isinstance(is_assistance_val, bytes):
                        full_award['is_assistance'] = 1 if is_assistance_val == b'\x01' else 0
                    elif isinstance(is_assistance_val, bool):
                        full_award['is_assistance'] = 1 if is_assistance_val else 0
                # Merge S3 data with DynamoDB GSI fields (S3 data takes precedence)
                full_award.update(item)
                return full_award
            else:
                logger.warning(f"Failed to fetch from S3 for {award_id}, using DynamoDB data only")
        
        return item
    except Exception as e:
        logger.error(f"Error fetching existing award {award_id}: {str(e)}")
        return None


def store_oversized_item_to_s3(award_id: str, full_item: Dict[str, Any]) -> str:
    """Store oversized item to S3 in oversize/ folder"""
    s3_key = f"oversize/{award_id}.json.gz"
    
    # Convert Decimal values to JSON-serializable types
    json_ready_item = convert_decimal_to_float(full_item)
    
    # Convert to JSON
    json_data = json.dumps(json_ready_item, ensure_ascii=False, indent=2)
    
    # Compress and upload to S3
    json_bytes = json_data.encode('utf-8')
    compressed_data = gzip.compress(json_bytes)
    
    s3_client.put_object(
        Bucket=S3_BUCKET_NAME,
        Key=s3_key,
        Body=compressed_data,
        ContentType='application/json',
        ContentEncoding='gzip'
    )
    
    logger.info(f"Stored oversized award {award_id} to S3: {s3_key}")
    return s3_key


def convert_decimal_to_float(obj: Any) -> Any:
    """Recursively convert Decimal to float for JSON serialization"""
    if isinstance(obj, Decimal):
        try:
            return float(obj)
        except (OverflowError, ValueError):
            return str(obj)
    elif isinstance(obj, dict):
        return {key: convert_decimal_to_float(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimal_to_float(item) for item in obj]
    else:
        return obj


def extract_gsi_fields_only(full_item: Dict[str, Any]) -> Dict[str, Any]:
    """Extract only GSI fields and essential metadata for DynamoDB (for KEYS_ONLY GSIs)"""
    gsi_fields = {
        'award_id': full_item.get('award_id'),
        # GSI hash keys
        'awarding_agency_code': full_item.get('awarding_agency_code'),
        'awarding_agency_name': full_item.get('awarding_agency_name'),
        'recipient_name_normalized': full_item.get('recipient_name_normalized') or 'unknown',
        'recipient_location_state': full_item.get('recipient_location_state'),
        'award_type': full_item.get('award_type'),
        'is_assistance': full_item.get('is_assistance'),
        'fiscal_year': full_item.get('fiscal_year'),
        # GSI range keys
        'total_obligated_amount': full_item.get('total_obligated_amount'),
        'period_start_date': full_item.get('period_start_date') or full_item.get('period_of_performance_start_date'),
        'period_end_date': full_item.get('period_end_date') or full_item.get('period_of_performance_current_end_date'),
        # Essential metadata
        'transaction_count': full_item.get('transaction_count', 0),
        'subaward_count': full_item.get('subaward_count', 0),
        'full_indexing_complete': full_item.get('full_indexing_complete', True),
        'last_updated': full_item.get('last_updated'),
        'indexed_at': full_item.get('indexed_at'),
        'data_source': full_item.get('data_source', 'usaspending_api_enrichment'),
        'api_version': full_item.get('api_version', 'api_v2'),
        'ttl': full_item.get('ttl'),
        'is_oversized': True,
        # Preserve category if present (used for filtering)
        'category': full_item.get('category'),
    }
    
    # Remove None values (but keep False/0/empty string if they're valid values)
    cleaned = {}
    for k, v in gsi_fields.items():
        if v is not None:
            # Convert is_assistance to number (N type) for GSI compatibility
            if k == 'is_assistance':
                if isinstance(v, bytes):
                    # Convert bytes to number (legacy format)
                    cleaned[k] = 1 if v == b'\x01' else 0
                elif isinstance(v, bool):
                    # Convert bool to number
                    cleaned[k] = 1 if v else 0
                else:
                    # Already a number, use as-is
                    cleaned[k] = v
            # For numeric fields, keep 0 values
            elif k in ['transaction_count', 'subaward_count', 'fiscal_year'] and v == 0:
                cleaned[k] = v
            # For string fields, keep non-empty strings (but allow 'unknown' for recipient_name_normalized)
            elif isinstance(v, str) and (v or k == 'recipient_name_normalized'):
                cleaned[k] = v
            # For other types, include if not None
            elif not isinstance(v, str):
                cleaned[k] = v
    
    return cleaned


def update_award_in_dynamodb(award_id: str, updated_data: Dict[str, Any]) -> bool:
    """Update award in DynamoDB with retry logic"""
    max_put_retries = 3
    
    for put_attempt in range(max_put_retries):
        try:
            awards_table.put_item(Item=updated_data)
            return True
        except Exception as put_error:
            error_str = str(put_error)
            
            # Handle oversized items
            if 'ValidationException' in error_str and 'Item size has exceeded' in error_str:
                logger.warning(f"Award {award_id} exceeds DynamoDB size limit, storing to S3...")
                
                oversize_s3_key = store_oversized_item_to_s3(award_id, updated_data)
                gsi_only_item = extract_gsi_fields_only(updated_data)
                gsi_only_item['oversize_s3_key'] = oversize_s3_key
                
                try:
                    awards_table.put_item(Item=gsi_only_item)
                    logger.info(f"Stored GSI fields for oversized award {award_id} to DynamoDB, full data in S3")
                    return True
                except Exception as gsi_error:
                    logger.error(f"Even GSI-only item too large for {award_id}: {str(gsi_error)}")
                    raise
            
            # Handle throttling
            elif 'ThrottlingException' in error_str or 'ProvisionedThroughputExceededException' in error_str:
                if put_attempt < max_put_retries - 1:
                    wait_time = (put_attempt + 1) * 2
                    logger.warning(f"DynamoDB throttled for award {award_id}, waiting {wait_time}s before retry {put_attempt + 1}/{max_put_retries}")
                    time.sleep(wait_time)
                    continue
            
            # Re-raise if not throttling or out of retries
            raise
    
    return False


def enrich_award(award_id: str) -> Dict[str, Any]:
    """Main enrichment function - fetches and updates award data"""
    try:
        # Get existing award
        existing_award = get_existing_award(award_id)
        if not existing_award:
            return {
                'success': False,
                'error': f'Award {award_id} not found in DynamoDB'
            }
        
        # Check if this is an oversized award (stored in S3)
        existing_oversize_s3_key = existing_award.get('oversize_s3_key')
        is_oversized = existing_award.get('is_oversized', False) or existing_oversize_s3_key is not None
        
        logger.info(f"Starting enrichment for award {award_id} (oversized: {is_oversized})")
        
        # Fetch fresh data from USAspending API
        award_details = fetch_award_details(award_id)
        if not award_details:
            return {
                'success': False,
                'error': f'Failed to fetch award details from USAspending API'
            }
        
        # Fetch transactions
        transactions = fetch_all_transactions(award_id)
        normalized_transactions = [normalize_transaction(tx) for tx in transactions]
        
        # Fetch subawards
        subawards = fetch_all_subawards(award_id)
        normalized_subawards = [normalize_subaward(sub) for sub in subawards]
        
        # Check if this is an IDV - check multiple ways to be robust
        # 1. Check award_id pattern (CONT_IDV_...)
        # 2. Check category and type from API response
        # 3. Check existing award's is_idv_parent flag
        award_type = award_details.get('type', '')
        award_category = award_details.get('category', '')
        is_idv_by_id = 'CONT_IDV_' in award_id or award_id.startswith('CONT_IDV_')
        is_idv_by_type = (award_category == 'contract' and 
                          (award_type.upper() in ['IDV', 'IDC', 'BPA', 'BOA'] or 
                           'IDV' in str(award_type).upper()))
        is_idv_by_existing = existing_award.get('is_idv_parent', False) or existing_award.get('award_or_idv_flag') == 'IDV'
        
        is_idv = is_idv_by_id or is_idv_by_type or is_idv_by_existing
        
        logger.info(f"IDV detection for {award_id}: by_id={is_idv_by_id}, by_type={is_idv_by_type} (type={award_type}, category={award_category}), by_existing={is_idv_by_existing}, final={is_idv}")
        
        child_award_ids = []
        idv_amounts = None
        
        if is_idv:
            logger.info(f"Detected IDV {award_id}, fetching child awards...")
            child_award_ids = fetch_child_award_ids(award_id)
            logger.info(f"Fetched {len(child_award_ids)} child award IDs for IDV {award_id}")
            
            if child_award_ids:
                idv_amounts = fetch_idv_amounts(award_id)
                
                # Store each child award as a full award record (like glue job)
                # Pass parent award details so child awards can inherit missing fields
                logger.info(f"Processing {len(child_award_ids)} child awards for IDV {award_id}...")
                stored_count = 0
                failed_count = 0
                for idx, child_id in enumerate(child_award_ids, 1):
                    logger.info(f"Processing child award {idx}/{len(child_award_ids)}: {child_id}")
                    if store_child_award_as_full_record(child_id, award_id, parent_award=existing_award):
                        stored_count += 1
                    else:
                        failed_count += 1
                logger.info(f"Completed: Stored {stored_count}/{len(child_award_ids)} child awards as full records for IDV {award_id} (failed: {failed_count})")
            else:
                logger.info(f"No child awards found for IDV {award_id}")
        
        # Compare with existing data using hash comparison
        existing_transactions_hash = calculate_hash(existing_award.get('transactions', []))
        new_transactions_hash = calculate_hash(normalized_transactions)
        
        existing_subawards_hash = calculate_hash(existing_award.get('subawards', []))
        new_subawards_hash = calculate_hash(normalized_subawards)
        
        # Check if data has changed
        transactions_changed = existing_transactions_hash != new_transactions_hash
        subawards_changed = existing_subawards_hash != new_subawards_hash
        child_awards_changed = False
        
        if is_idv:
            # Compare child award ID lists (not full objects)
            existing_child_awards = existing_award.get('child_awards', [])
            # Handle both list of IDs and list of objects
            existing_child_ids = []
            if existing_child_awards:
                for child in existing_child_awards:
                    if isinstance(child, str):
                        existing_child_ids.append(child)
                    elif isinstance(child, dict):
                        existing_child_ids.append(child.get('award_id') or child.get('generated_unique_award_id', ''))
            
            existing_child_ids_set = set(existing_child_ids)
            new_child_ids_set = set(child_award_ids)
            child_awards_changed = existing_child_ids_set != new_child_ids_set
        
        # If nothing changed, return early
        if not (transactions_changed or subawards_changed or child_awards_changed):
            logger.info(f"No changes detected for award {award_id}")
            return {
                'success': True,
                'updated': False,
                'message': 'Award data is already up to date',
                'award_id': award_id
            }
        
        # Prepare updated award data
        updated_award = existing_award.copy()
        
        # Update GSI fields from fresh API response (important for KEYS_ONLY GSIs)
        # Extract recipient information
        if 'recipient' in award_details:
            recipient = award_details['recipient']
            if isinstance(recipient, dict):
                recipient_name = recipient.get('recipient_name') or recipient.get('name', '')
                if recipient_name:
                    # Store raw recipient_name in uppercase (matches USAspending standard and glue job)
                    recipient_name_upper = recipient_name.upper() if isinstance(recipient_name, str) else recipient_name
                    updated_award['recipient_name'] = recipient_name_upper
                    updated_award['recipient_name_normalized'] = recipient_name_upper.lower()
                    logger.info(f"Updated recipient_name and recipient_name_normalized from API for award {award_id}")
                elif not updated_award.get('recipient_name_normalized'):
                    # If recipient_name is missing, set default for GSI (required field)
                    updated_award['recipient_name_normalized'] = "unknown"
                    logger.warning(f"Recipient name missing for award {award_id}, setting recipient_name_normalized to 'unknown'")
                
                # Update recipient location fields
                if 'location' in recipient and isinstance(recipient['location'], dict):
                    location = recipient['location']
                    if location.get('state_code'):
                        updated_award['recipient_location_state'] = location.get('state_code')
                    if location.get('state_name'):
                        updated_award['recipient_state_name'] = location.get('state_name')
                    if location.get('city_name'):
                        updated_award['recipient_city_name'] = location.get('city_name')
                    if location.get('country_name'):
                        updated_award['recipient_country_name'] = location.get('country_name')
        
        # Update place of performance fields
        if 'place_of_performance' in award_details:
            pop = award_details['place_of_performance']
            if isinstance(pop, dict):
                if pop.get('state_code'):
                    updated_award['primary_place_of_performance_state_code'] = pop.get('state_code')
                if pop.get('state_name'):
                    updated_award['primary_place_of_performance_state_name'] = pop.get('state_name')
                if pop.get('city_name'):
                    updated_award['primary_place_of_performance_city_name'] = pop.get('city_name')
                if pop.get('country_name'):
                    updated_award['primary_place_of_performance_country_name'] = pop.get('country_name')
        
        # Update agency information (GSI fields)
        if 'awarding_agency' in award_details:
            agency = award_details['awarding_agency']
            if isinstance(agency, dict):
                if agency.get('name'):
                    updated_award['awarding_agency_name'] = agency.get('name')
                if agency.get('id'):
                    updated_award['awarding_agency_code'] = str(agency.get('id'))
        
        if 'funding_agency' in award_details:
            agency = award_details['funding_agency']
            if isinstance(agency, dict):
                if agency.get('name'):
                    updated_award['funding_agency_name'] = agency.get('name')
                if agency.get('id'):
                    updated_award['funding_agency_code'] = str(agency.get('id'))
        
        # Update award type (GSI field)
        if award_type:
            updated_award['award_type'] = award_type
        if award_details.get('type_description'):
            updated_award['award_type_description'] = award_details.get('type_description')
        
        # Update description
        if 'description' in award_details:
            updated_award['description'] = award_details.get('description')
        
        # Update PIID (Procurement Instrument Identifier)
        if 'piid' in award_details:
            updated_award['award_id_piid'] = award_details.get('piid')
        
        # Update USAspending permalink
        updated_award['usaspending_permalink'] = f'https://www.usaspending.gov/award/{award_id}'
        
        # Update category and is_assistance (GSI field) from API response
        if award_category:
            updated_award['category'] = award_category
            # Set is_assistance based on category (matches glue job logic)
            # is_assistance: 1 = True (assistance), 0 = False (contract) - must be number (N) for GSI
            if award_category == 'assistance' or award_category == 'grant':
                updated_award['is_assistance'] = 1
            else:
                updated_award['is_assistance'] = 0
            logger.info(f"Updated category={award_category} and is_assistance from API for award {award_id}")
        
        # Update fiscal year from dates (GSI field)
        if 'date_signed' in award_details:
            try:
                from datetime import datetime as dt
                date_obj = dt.strptime(award_details['date_signed'], '%Y-%m-%d')
                # Fiscal year: Oct 1 - Sep 30, so if month >= 10, fiscal year is next calendar year
                fiscal_year = date_obj.year if date_obj.month < 10 else date_obj.year + 1
                updated_award['fiscal_year'] = fiscal_year
            except Exception as e:
                logger.warning(f"Could not calculate fiscal_year from date_signed for award {award_id}: {e}")
        
        # Update date fields (GSI range keys)
        if 'date_signed' in award_details:
            updated_award['period_of_performance_start_date'] = award_details['date_signed']
            updated_award['period_start_date'] = award_details['date_signed']
        if 'period_of_performance_current_end_date' in award_details:
            updated_award['period_of_performance_current_end_date'] = award_details['period_of_performance_current_end_date']
            updated_award['period_end_date'] = award_details['period_of_performance_current_end_date']
        
        # Update total_obligated_amount (GSI range key)
        if 'total_obligation' in award_details:
            updated_award['total_obligated_amount'] = Decimal(str(award_details['total_obligation']))
        
        # Update base_and_exercised_options_value and base_and_all_options_value
        # These fields show the full contract value including exercised options and all potential options
        if 'base_exercised_options' in award_details and award_details['base_exercised_options'] is not None:
            try:
                updated_award['base_and_exercised_options_value'] = Decimal(str(award_details['base_exercised_options']))
            except (ValueError, TypeError, decimal.InvalidOperation) as e:
                logger.warning(f"Could not convert base_exercised_options to Decimal for award {award_id}: {e}")
        
        if 'base_and_all_options' in award_details and award_details['base_and_all_options'] is not None:
            try:
                updated_award['base_and_all_options_value'] = Decimal(str(award_details['base_and_all_options']))
            except (ValueError, TypeError, decimal.InvalidOperation) as e:
                logger.warning(f"Could not convert base_and_all_options to Decimal for award {award_id}: {e}")
        
        # Update outlay amounts (Amount Paid in UI)
        # For IDVs, use combined outlay from IDV amounts API (child awards)
        # For regular awards, use outlay from award details API
        if is_idv and idv_amounts:
            # For parent IDVs, get combined outlay from child awards via IDV amounts API
            # Try child_award_total_outlay first (direct child outlay)
            if 'child_award_total_outlay' in idv_amounts and idv_amounts['child_award_total_outlay'] is not None:
                try:
                    combined_outlay = Decimal(str(idv_amounts['child_award_total_outlay']))
                    updated_award['total_account_outlay'] = combined_outlay
                    updated_award['total_outlay'] = combined_outlay
                    updated_award['total_outlayed_amount_for_overall_award'] = str(combined_outlay)
                    updated_award['total_outlayed_amount'] = combined_outlay
                    logger.info(f"Updated combined outlay from IDV amounts for {award_id}: {combined_outlay}")
                except (ValueError, TypeError, decimal.InvalidOperation) as e:
                    logger.warning(f"Could not convert child_award_total_outlay to Decimal for IDV {award_id}: {e}")
            
            # Fallback to child_total_account_outlay if child_award_total_outlay is not available
            elif 'child_total_account_outlay' in idv_amounts and idv_amounts['child_total_account_outlay'] is not None:
                try:
                    combined_outlay = Decimal(str(idv_amounts['child_total_account_outlay']))
                    updated_award['total_account_outlay'] = combined_outlay
                    updated_award['total_outlay'] = combined_outlay
                    updated_award['total_outlayed_amount_for_overall_award'] = str(combined_outlay)
                    updated_award['total_outlayed_amount'] = combined_outlay
                    logger.info(f"Updated combined outlay from IDV account outlay for {award_id}: {combined_outlay}")
                except (ValueError, TypeError, decimal.InvalidOperation) as e:
                    logger.warning(f"Could not convert child_total_account_outlay to Decimal for IDV {award_id}: {e}")
        else:
            # For regular awards, use outlay from award details API
            # The UI checks multiple field names: total_outlayed_amount_for_overall_award, total_outlay, total_account_outlay
            # The API returns total_account_outlay, so we'll store it in all the expected field names
            if 'total_account_outlay' in award_details and award_details['total_account_outlay'] is not None:
                try:
                    outlay_amount = Decimal(str(award_details['total_account_outlay']))
                    updated_award['total_account_outlay'] = outlay_amount
                    updated_award['total_outlay'] = outlay_amount
                    updated_award['total_outlayed_amount_for_overall_award'] = str(outlay_amount)  # UI expects string for this field
                    updated_award['total_outlayed_amount'] = outlay_amount
                except (ValueError, TypeError, decimal.InvalidOperation) as e:
                    logger.warning(f"Could not convert total_account_outlay to Decimal for award {award_id}: {e}")
        
        # Update transactions if changed
        if transactions_changed:
            updated_award['transactions'] = convert_floats_to_decimal(normalized_transactions)
            updated_award['transaction_count'] = len(normalized_transactions)
            logger.info(f"Updated {len(normalized_transactions)} transactions for award {award_id}")
        
        # Update subawards if changed
        if subawards_changed:
            updated_award['subawards'] = convert_floats_to_decimal(normalized_subawards)
            updated_award['subaward_count'] = len(normalized_subawards)
            logger.info(f"Updated {len(normalized_subawards)} subawards for award {award_id}")
        
        # Update child awards if changed (for IDVs)
        # Store child award IDs in parent (not full objects, like glue job)
        if is_idv and child_awards_changed:
            updated_award['child_awards'] = child_award_ids  # Just the IDs, not full objects
            updated_award['child_award_count'] = len(child_award_ids)
            updated_award['is_idv_parent'] = True
            logger.info(f"Updated {len(child_award_ids)} child award IDs for IDV {award_id}")
            
            # Update combined obligated amount from IDV amounts
            if idv_amounts and 'child_award_total_obligation' in idv_amounts:
                updated_award['combined_obligated_amount'] = Decimal(str(idv_amounts['child_award_total_obligation']))
        
        # Preserve important fields from existing award that shouldn't be overwritten
        # Note: is_assistance and category are already updated from API response above if available
        # Only preserve if not updated from API
        if 'is_assistance' not in updated_award and 'is_assistance' in existing_award:
            existing_is_assistance = existing_award['is_assistance']
            # Convert bytes to number if needed (legacy data might have bytes)
            if isinstance(existing_is_assistance, bytes):
                updated_award['is_assistance'] = 1 if existing_is_assistance == b'\x01' else 0
            elif isinstance(existing_is_assistance, bool):
                updated_award['is_assistance'] = 1 if existing_is_assistance else 0
            else:
                # Already a number, use as-is
                updated_award['is_assistance'] = existing_is_assistance
        if 'category' not in updated_award and 'category' in existing_award:
            updated_award['category'] = existing_award['category']
        # Preserve award_or_idv_flag if it exists
        if 'award_or_idv_flag' in existing_award:
            updated_award['award_or_idv_flag'] = existing_award['award_or_idv_flag']
        
        # Update enrichment metadata
        updated_award['last_enriched_at'] = datetime.now(timezone.utc).isoformat()
        updated_award['last_updated'] = datetime.now(timezone.utc).isoformat()
        updated_award['enrichment_source'] = 'usaspending_api_v2'
        
        # Convert all floats to Decimal
        updated_award = convert_floats_to_decimal(updated_award)
        
        # Handle oversized items - update S3 file instead of DynamoDB
        if is_oversized:
            logger.info(f"Award {award_id} is oversized, updating S3 file...")
            # Update the S3 file with new data
            if existing_oversize_s3_key:
                # Use existing S3 key
                oversize_s3_key = existing_oversize_s3_key
            else:
                # Generate new S3 key (shouldn't happen, but handle it)
                oversize_s3_key = f"oversize/{award_id}.json.gz"
            
            # Store updated award to S3
            store_oversized_item_to_s3(award_id, updated_award)
            
            # Update GSI fields in DynamoDB
            gsi_only_item = extract_gsi_fields_only(updated_award)
            gsi_only_item['oversize_s3_key'] = oversize_s3_key
            gsi_only_item['is_oversized'] = True
            
            # Preserve is_assistance in GSI item if it exists (ensure it's a number)
            if 'is_assistance' in updated_award:
                is_assistance_val = updated_award['is_assistance']
                # Convert to number if needed
                if isinstance(is_assistance_val, bytes):
                    gsi_only_item['is_assistance'] = 1 if is_assistance_val == b'\x01' else 0
                elif isinstance(is_assistance_val, bool):
                    gsi_only_item['is_assistance'] = 1 if is_assistance_val else 0
                else:
                    gsi_only_item['is_assistance'] = is_assistance_val
            if 'category' in updated_award:
                gsi_only_item['category'] = updated_award['category']
            
            # Update DynamoDB with GSI fields only
            try:
                awards_table.put_item(Item=gsi_only_item)
                logger.info(f"Updated oversized award {award_id} in S3 and DynamoDB GSI fields")
                success = True
            except Exception as s3_update_error:
                logger.error(f"Failed to update DynamoDB GSI fields for oversized award {award_id}: {str(s3_update_error)}")
                success = False
        else:
            # Normal award - update in DynamoDB
            success = update_award_in_dynamodb(award_id, updated_award)
        
        if success:
            return {
                'success': True,
                'updated': True,
                'message': 'Award data updated successfully',
                'award_id': award_id,
                'transactions_count': len(normalized_transactions),
                'subawards_count': len(normalized_subawards),
                'child_awards_count': len(child_award_ids) if is_idv else 0
            }
        else:
            return {
                'success': False,
                'error': 'Failed to update award in DynamoDB'
            }
            
    except Exception as e:
        logger.error(f"Error enriching award {award_id}: {str(e)}", exc_info=True)
        return {
            'success': False,
            'error': f'Error enriching award: {str(e)}'
        }


def process_enrichment_request(event, context):
    """Process enrichment request (extracted from lambda_handler for reuse)"""
    try:
        # Extract origin from request headers for CORS validation
        headers = event.get('headers', {})
        origin = headers.get('Origin') or headers.get('origin')
        
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': build_cors_headers(origin),
                'body': json.dumps({'message': 'CORS preflight'})
            }
        
        # Parse request
        http_method = event.get('httpMethod', 'POST')
        path = event.get('path', '')
        
        # Extract award_id from path or body
        award_id = None
        
        if http_method == 'POST':
            try:
                body = json.loads(event.get('body', '{}'))
                award_id = body.get('award_id')
            except json.JSONDecodeError:
                pass
        
        # Try to extract from path (e.g., /enrich/{award_id})
        if not award_id and path:
            path_parts = path.strip('/').split('/')
            if len(path_parts) >= 2 and path_parts[0] == 'enrich':
                award_id = path_parts[1]
        
        if not award_id:
            return {
                'statusCode': 400,
                'headers': build_cors_headers(origin),
                'body': json.dumps({
                    'success': False,
                    'error': 'award_id is required'
                })
            }
        
        # Enrich the award
        result = enrich_award(award_id)
        
        status_code = 200 if result.get('success') else 500
        
        return {
            'statusCode': status_code,
            'headers': build_cors_headers(origin),
            'body': json.dumps(result, default=str)
        }
        
    except Exception as e:
        logger.error(f"Error processing enrichment request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': build_cors_headers(origin),
            'body': json.dumps({
                'success': False,
                'error': f'Internal server error: {str(e)}'
            })
        }


def lambda_handler(event, context):
    """Lambda handler for award enrichment"""
    # Handle SQS events
    if 'Records' in event and len(event.get('Records', [])) > 0:
        # This is an SQS event
        try:
            record = event['Records'][0]
            message_body = json.loads(record.get('body', '{}'))
            request_id = message_body.get('request_id')
            api_gateway_event = message_body.get('api_gateway_event', {})
            
            # Get SNS topic ARN from environment
            sns_topic_arn = os.environ.get('USASPENDING_ENRICHMENT_COMPLETION_SNS_TOPIC_ARN')
            
            # Initialize SNS client
            sns_client = boto3.client('sns')
            
            # Process the request
            try:
                result = process_enrichment_request(api_gateway_event, context)
                
                # Publish completion notification
                if sns_topic_arn:
                    sns_client.publish(
                        TopicArn=sns_topic_arn,
                        Message=json.dumps({
                            'request_id': request_id,
                            'status': 'completed',
                            'response': result
                        }),
                        MessageAttributes={
                            'request_id': {
                                'DataType': 'String',
                                'StringValue': request_id
                            }
                        }
                    )
                
                return result
            except Exception as e:
                logger.error(f"Error processing SQS event: {str(e)}", exc_info=True)
                
                # Publish failure notification
                if sns_topic_arn:
                    sns_client.publish(
                        TopicArn=sns_topic_arn,
                        Message=json.dumps({
                            'request_id': request_id,
                            'status': 'failed',
                            'error': str(e)
                        }),
                        MessageAttributes={
                            'request_id': {
                                'DataType': 'String',
                                'StringValue': request_id
                            }
                        }
                    )
                
                raise
        except Exception as e:
            logger.error(f"Error processing SQS event: {str(e)}", exc_info=True)
            raise
    
    # Regular API Gateway or direct invocation
    return process_enrichment_request(event, context)



