"""
USAspending Search Lambda Function
Queries DynamoDB awards table using GSIs and filters to return matching awards
"""

import json
import os
import logging
import time
import boto3
import gzip
from typing import Dict, List, Any, Optional
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr
from boto3.dynamodb.types import TypeDeserializer

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Environment variables
AWARDS_TABLE_NAME = os.environ.get('AWARDS_TABLE_NAME', 'usaspending-awards-index')
S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'cosine-usaspending-data-production')

# Get DynamoDB table
awards_table = dynamodb.Table(AWARDS_TABLE_NAME) if AWARDS_TABLE_NAME else None


def get_cors_headers():
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
    }


def convert_decimal_to_float(obj: Any) -> Any:
    """
    Recursively convert Decimal values to float and bytes/Binary to appropriate types for JSON serialization
    """
    # Handle DynamoDB Binary type (boto3.dynamodb.types.Binary)
    try:
        from boto3.dynamodb.types import Binary
        if isinstance(obj, Binary):
            obj = obj.value  # Extract the bytes value
    except ImportError:
        pass
    
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, bytes):
        # Handle binary bytes - convert to appropriate type
        # is_assistance: b'\x01' = True (assistance), b'\x00' = False (contract)
        if len(obj) == 1:
            # Single byte - likely a boolean flag
            return bool(obj[0])
        else:
            # Multiple bytes - convert to base64 string for JSON serialization
            import base64
            return base64.b64encode(obj).decode('utf-8')
    elif isinstance(obj, dict):
        return {key: convert_decimal_to_float(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimal_to_float(item) for item in obj]
    else:
        return obj


def fetch_oversized_award_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """
    Fetch oversized award details from S3 (when oversize_s3_key exists)
    
    Args:
        s3_key: S3 key for the oversized award file (gzipped JSON)
    
    Returns:
        Full award dictionary, or None if error
    """
    try:
        if not s3_key:
            return None
        
        # Fetch object from S3
        response = s3_client.get_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        
        # Decompress gzipped content
        gzipped_content = response['Body'].read()
        decompressed_content = gzip.decompress(gzipped_content)
        
        # Parse JSON
        award_details = json.loads(decompressed_content.decode('utf-8'))
        
        return award_details
        
    except s3_client.exceptions.NoSuchKey:
        logger.warning(f"Oversized award not found in S3: {s3_key}")
        return None
    except Exception as e:
        logger.error(f"Error fetching oversized award from S3 ({s3_key}): {str(e)}", exc_info=True)
        return None


def is_agency_code(value: str) -> bool:
    """
    Determine if a value is an agency code or name.
    Codes are typically short alphanumeric strings (e.g., "012", "020").
    Names are longer strings with spaces (e.g., "Department of Agriculture").
    
    Args:
        value: The value to check
    
    Returns:
        True if it looks like a code, False if it looks like a name
    """
    if not value or not isinstance(value, str):
        return False
    
    # If it contains spaces, it's likely a name
    if ' ' in value:
        return False
    
    # If it's very short (1-4 chars) and alphanumeric, it's likely a code
    if len(value) <= 4 and value.replace('-', '').replace('_', '').isalnum():
        return True
    
    # If it's longer but still no spaces and looks like a code pattern, treat as code
    # Otherwise, treat as name
    return len(value) <= 10 and not any(c.islower() for c in value if c.isalpha())


def apply_python_filter(item: Dict[str, Any], filters: Dict[str, Any]) -> bool:
    """
    Apply filters to an item in Python (for post-BatchGetItem filtering with KEYS_ONLY GSIs)
    
    Args:
        item: Award item to filter
        filters: Dictionary of filter fields
    
    Returns:
        True if item matches all filters, False otherwise
    """
    # Award type filter
    if filters.get('award_type'):
        award_types = filters['award_type'] if isinstance(filters['award_type'], list) else [filters['award_type']]
        item_type = item.get('award_type')
        if not item_type or item_type not in award_types:
            return False
    
    # Agency filters - support both code and name
    # Check awarding_agency_name first (preferred when frontend sends names)
    if filters.get('awarding_agency_name'):
        values = filters['awarding_agency_name'] if isinstance(filters['awarding_agency_name'], list) else [filters['awarding_agency_name']]
        values = [v for v in values if v and str(v).strip()]
        if values:
            item_name = str(item.get('awarding_agency_name') or '').strip()
            matches = False
            for val in values:
                val_str = str(val).strip()
                # Case-insensitive substring match for names
                if item_name and val_str.lower() in item_name.lower():
                    matches = True
                    break
                # Also try reverse match (item name in search term)
                if item_name and item_name.lower() in val_str.lower():
                    matches = True
                    break
            if not matches:
                logger.debug(f"Awarding agency name filter failed: search={values}, item_name='{item_name}', award_id={item.get('award_id', 'unknown')}")
                return False
    
    # Also support awarding_agency_code (for backward compatibility and direct code searches)
    if filters.get('awarding_agency_code'):
        values = filters['awarding_agency_code'] if isinstance(filters['awarding_agency_code'], list) else [filters['awarding_agency_code']]
        values = [v for v in values if v and str(v).strip()]
        if values:
            # Handle both string and numeric codes
            item_code = item.get('awarding_agency_code')
            if item_code is not None:
                item_code = str(item_code).strip()
            else:
                item_code = ''
            item_name = str(item.get('awarding_agency_name') or '').strip()
            # Check if item matches any of the values (code or name)
            matches = False
            for val in values:
                val_str = str(val).strip()
                if is_agency_code(val_str):
                    # Exact match for codes (normalize to string, handle leading zeros)
                    val_normalized = val_str.zfill(3)  # Pad to 3 digits
                    item_code_normalized = item_code.zfill(3) if item_code else ''
                    if item_code == val_str or item_code == val_normalized or item_code_normalized == val_normalized:
                        matches = True
                        break
                    # Also try numeric comparison
                    try:
                        if int(item_code) == int(val_str):
                            matches = True
                            break
                    except (ValueError, TypeError):
                        pass
                else:
                    # Name match (case-insensitive contains) - for backward compatibility
                    if item_name and val_str.lower() in item_name.lower():
                        matches = True
                        break
            if not matches:
                logger.info(f"Awarding agency code filter failed: search={values}, item_code='{item_code}' (type={type(item.get('awarding_agency_code'))}), item_name='{item_name}', award_id={item.get('award_id', 'unknown')}")
                return False
    
    if filters.get('funding_agency_code'):
        values = filters['funding_agency_code'] if isinstance(filters['funding_agency_code'], list) else [filters['funding_agency_code']]
        values = [v for v in values if v and str(v).strip()]
        if values:
            item_code = item.get('funding_agency_code')
            item_name = item.get('funding_agency_name', '')
            matches = False
            for val in values:
                if is_agency_code(str(val)):
                    if str(item_code) == str(val):
                        matches = True
                        break
                else:
                    if item_name and str(val).lower() in item_name.lower():
                        matches = True
                        break
            if not matches:
                return False
    
    # Recipient filters
    if filters.get('recipient_name'):
        recipient_names = filters['recipient_name'] if isinstance(filters['recipient_name'], list) else [filters['recipient_name']]
        # Try both recipient_name_normalized and recipient_name fields
        item_name_normalized = str(item.get('recipient_name_normalized') or '').lower().strip()
        item_name_raw = str(item.get('recipient_name') or '').lower().strip()
        matches = False
        for name in recipient_names:
            if not name or not str(name).strip():
                continue
            normalized = str(name).lower().strip()
            # Check if normalized search term is in normalized field (substring match)
            if item_name_normalized and normalized in item_name_normalized:
                matches = True
                break
            # Also check if normalized search term is in raw name field (substring match)
            if item_name_raw and normalized in item_name_raw:
                matches = True
                break
            # Also try reverse - check if item name is in search term (for partial matches)
            if item_name_normalized and item_name_normalized in normalized:
                matches = True
                break
            if item_name_raw and item_name_raw in normalized:
                matches = True
                break
        if not matches:
            logger.debug(f"Recipient name filter failed: search={recipient_names}, item_normalized='{item_name_normalized}', item_raw='{item_name_raw}'")
            return False
    
    # Location filters
    if filters.get('recipient_location_state'):
        states = filters['recipient_location_state'] if isinstance(filters['recipient_location_state'], list) else [filters['recipient_location_state']]
        item_state = item.get('recipient_location_state')
        if not item_state or item_state not in states:
            return False
    
    if filters.get('recipient_location_country'):
        countries = filters['recipient_location_country'] if isinstance(filters['recipient_location_country'], list) else [filters['recipient_location_country']]
        item_country = item.get('recipient_location_country')
        if not item_country or item_country not in countries:
            return False
    
    # Reference code filters
    if filters.get('naics_code'):
        codes = filters['naics_code'] if isinstance(filters['naics_code'], list) else [filters['naics_code']]
        item_code = item.get('naics_code')
        if not item_code or item_code not in codes:
            return False
    
    if filters.get('psc_code'):
        codes = filters['psc_code'] if isinstance(filters['psc_code'], list) else [filters['psc_code']]
        item_code = item.get('psc_code')
        if not item_code or item_code not in codes:
            return False
    
    if filters.get('cfda_number'):
        numbers = filters['cfda_number'] if isinstance(filters['cfda_number'], list) else [filters['cfda_number']]
        item_number = item.get('cfda_number')
        if not item_number or item_number not in numbers:
            return False
    
    # Amount filters
    if filters.get('min_obligation') is not None:
        item_amount = item.get('total_obligated_amount') or item.get('total_obligation', 0)
        try:
            if float(item_amount) < float(filters['min_obligation']):
                return False
        except (ValueError, TypeError):
            return False
    
    if filters.get('max_obligation') is not None:
        item_amount = item.get('total_obligated_amount') or item.get('total_obligation', 0)
        try:
            if float(item_amount) > float(filters['max_obligation']):
                return False
        except (ValueError, TypeError):
            return False
    
    # Date filters
    if filters.get('date_from'):
        item_date = item.get('period_start_date') or item.get('period_of_performance_start_date', '')
        if not item_date:
            logger.debug(f"Date from filter failed: item has no period_start_date, award_id={item.get('award_id', 'unknown')}")
            return False
        # Normalize dates to YYYY-MM-DD format for comparison
        try:
            item_date_str = str(item_date).split('T')[0]  # Get just date part
            filter_date_str = str(filters['date_from']).split('T')[0]
            if item_date_str < filter_date_str:
                logger.debug(f"Date from filter failed: item_date='{item_date_str}' < filter_date='{filter_date_str}', award_id={item.get('award_id', 'unknown')}")
                return False
        except (ValueError, TypeError) as e:
            logger.warning(f"Error comparing dates: item_date='{item_date}', filter_date='{filters['date_from']}', error={e}")
            return False
    
    if filters.get('date_to'):
        item_date = item.get('period_start_date') or item.get('period_of_performance_start_date', '')
        if not item_date:
            logger.debug(f"Date to filter failed: item has no period_start_date, award_id={item.get('award_id', 'unknown')}")
            return False
        # Normalize dates to YYYY-MM-DD format for comparison
        try:
            item_date_str = str(item_date).split('T')[0]  # Get just date part
            filter_date_str = str(filters['date_to']).split('T')[0]
            if item_date_str > filter_date_str:
                logger.debug(f"Date to filter failed: item_date='{item_date_str}' > filter_date='{filter_date_str}', award_id={item.get('award_id', 'unknown')}")
                return False
        except (ValueError, TypeError) as e:
            logger.warning(f"Error comparing dates: item_date='{item_date}', filter_date='{filters['date_to']}', error={e}")
            return False
    
    # Fiscal year filter
    if filters.get('fiscal_year'):
        fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
        item_fy = item.get('fiscal_year')
        if not item_fy or item_fy not in fiscal_years:
            return False
    
    # All filters passed
    return True


def build_filter_expression(filters: Dict[str, Any]) -> Optional[Any]:
    """
    Build DynamoDB filter expression from user filters
    
    Args:
        filters: Dictionary of filter fields
    
    Returns:
        DynamoDB ConditionExpression or None
    """
    conditions = []
    
    # Award type filter
    if filters.get('award_type'):
        award_types = filters['award_type'] if isinstance(filters['award_type'], list) else [filters['award_type']]
        if len(award_types) == 1:
            conditions.append(Attr('award_type').eq(award_types[0]))
        else:
            conditions.append(Attr('award_type').is_in(award_types))
    
    # Agency filters - support both codes and names
    if filters.get('awarding_agency_code'):
        values = filters['awarding_agency_code'] if isinstance(filters['awarding_agency_code'], list) else [filters['awarding_agency_code']]
        # Filter out empty strings
        values = [v for v in values if v and str(v).strip()]
        if not values:
            # Skip if all values are empty
            pass
        else:
            # Separate codes and names
            codes = [v for v in values if is_agency_code(str(v))]
            names = [v for v in values if not is_agency_code(str(v))]
            
            # Build conditions for codes
            code_conditions = []
            if codes:
                if len(codes) == 1:
                    code_conditions.append(Attr('awarding_agency_code').eq(codes[0]))
                else:
                    code_conditions.append(Attr('awarding_agency_code').is_in(codes))
            
            # Build conditions for names (use contains for partial matching, like recipient_name)
            # Note: DynamoDB contains is case-sensitive
            name_conditions = []
            if names:
                for name in names:
                    name_str = str(name).strip()
                    if name_str:
                        # Try both original case and lowercase for case-insensitive matching
                        variations = [name_str]
                        if name_str.lower() != name_str:
                            variations.append(name_str.lower())
                        
                        # Create OR condition for variations
                        if len(variations) == 1:
                            name_conditions.append(Attr('awarding_agency_name').contains(variations[0]))
                        else:
                            combined = Attr('awarding_agency_name').contains(variations[0])
                            for var in variations[1:]:
                                combined = combined | Attr('awarding_agency_name').contains(var)
                            name_conditions.append(combined)
            
            # Combine code and name conditions with OR if both exist, otherwise use the single condition
            if code_conditions and name_conditions:
                # Both codes and names: combine with OR
                combined = code_conditions[0]
                for cond in code_conditions[1:] + name_conditions:
                    combined = combined | cond
                conditions.append(combined)
            elif code_conditions:
                conditions.extend(code_conditions)
            elif name_conditions:
                if len(name_conditions) == 1:
                    conditions.extend(name_conditions)
                else:
                    # Multiple names: combine with OR
                    combined = name_conditions[0]
                    for cond in name_conditions[1:]:
                        combined = combined | cond
                    conditions.append(combined)
    
    # Handle awarding_agency_name directly (when not using awarding_agency_code)
    if filters.get('awarding_agency_name') and not filters.get('awarding_agency_code'):
        values = filters['awarding_agency_name'] if isinstance(filters['awarding_agency_name'], list) else [filters['awarding_agency_name']]
        # Filter out empty strings
        values = [v for v in values if v and str(v).strip()]
        if values:
            name_conditions = []
            for name in values:
                name_str = str(name).strip()
                if name_str:
                    # Try both original case and lowercase for case-insensitive matching
                    variations = [name_str]
                    if name_str.lower() != name_str:
                        variations.append(name_str.lower())
                    
                    # Create OR condition for variations
                    if len(variations) == 1:
                        name_conditions.append(Attr('awarding_agency_name').contains(variations[0]))
                    else:
                        combined = Attr('awarding_agency_name').contains(variations[0])
                        for var in variations[1:]:
                            combined = combined | Attr('awarding_agency_name').contains(var)
                        name_conditions.append(combined)
            
            if name_conditions:
                if len(name_conditions) == 1:
                    conditions.extend(name_conditions)
                else:
                    # Multiple names: combine with OR
                    combined = name_conditions[0]
                    for cond in name_conditions[1:]:
                        combined = combined | cond
                    conditions.append(combined)
    
    if filters.get('funding_agency_code'):
        values = filters['funding_agency_code'] if isinstance(filters['funding_agency_code'], list) else [filters['funding_agency_code']]
        # Filter out empty strings
        values = [v for v in values if v and str(v).strip()]
        if not values:
            # Skip if all values are empty
            pass
        else:
            # Separate codes and names
            codes = [v for v in values if is_agency_code(str(v))]
            names = [v for v in values if not is_agency_code(str(v))]
            
            # Build conditions for codes
            code_conditions = []
            if codes:
                if len(codes) == 1:
                    code_conditions.append(Attr('funding_agency_code').eq(codes[0]))
                else:
                    code_conditions.append(Attr('funding_agency_code').is_in(codes))
            
            # Build conditions for names (use contains for partial matching, like recipient_name)
            name_conditions = []
            if names:
                for name in names:
                    name_str = str(name).strip()
                    if name_str:
                        # Try both original case and lowercase for case-insensitive matching
                        variations = [name_str]
                        if name_str.lower() != name_str:
                            variations.append(name_str.lower())
                        
                        # Create OR condition for variations
                        if len(variations) == 1:
                            name_conditions.append(Attr('funding_agency_name').contains(variations[0]))
                        else:
                            combined = Attr('funding_agency_name').contains(variations[0])
                            for var in variations[1:]:
                                combined = combined | Attr('funding_agency_name').contains(var)
                            name_conditions.append(combined)
            
            # Combine code and name conditions with OR if both exist, otherwise use the single condition
            if code_conditions and name_conditions:
                # Both codes and names: combine with OR
                combined = code_conditions[0]
                for cond in code_conditions[1:] + name_conditions:
                    combined = combined | cond
                conditions.append(combined)
            elif code_conditions:
                conditions.extend(code_conditions)
            elif name_conditions:
                if len(name_conditions) == 1:
                    conditions.extend(name_conditions)
                else:
                    # Multiple names: combine with OR
                    combined = name_conditions[0]
                    for cond in name_conditions[1:]:
                        combined = combined | cond
                    conditions.append(combined)
    
    # Recipient filters
    if filters.get('recipient_name'):
        # Use contains for partial name matching (case-insensitive via normalized field)
        recipient_names = filters['recipient_name'] if isinstance(filters['recipient_name'], list) else [filters['recipient_name']]
        name_conditions = []
        for name in recipient_names:
            normalized = name.lower().strip()
            name_conditions.append(Attr('recipient_name_normalized').contains(normalized))
        if name_conditions:
            # OR condition for multiple names
            combined = name_conditions[0]
            for cond in name_conditions[1:]:
                combined = combined | cond
            conditions.append(combined)
    
    # Location filters
    if filters.get('recipient_location_state'):
        states = filters['recipient_location_state'] if isinstance(filters['recipient_location_state'], list) else [filters['recipient_location_state']]
        if len(states) == 1:
            conditions.append(Attr('recipient_location_state').eq(states[0]))
        else:
            conditions.append(Attr('recipient_location_state').is_in(states))
    
    if filters.get('recipient_location_country'):
        countries = filters['recipient_location_country'] if isinstance(filters['recipient_location_country'], list) else [filters['recipient_location_country']]
        if len(countries) == 1:
            conditions.append(Attr('recipient_location_country').eq(countries[0]))
        else:
            conditions.append(Attr('recipient_location_country').is_in(countries))
    
    # Reference code filters
    if filters.get('naics_code'):
        codes = filters['naics_code'] if isinstance(filters['naics_code'], list) else [filters['naics_code']]
        if len(codes) == 1:
            conditions.append(Attr('naics_code').eq(codes[0]))
        else:
            conditions.append(Attr('naics_code').is_in(codes))
    
    if filters.get('psc_code'):
        codes = filters['psc_code'] if isinstance(filters['psc_code'], list) else [filters['psc_code']]
        if len(codes) == 1:
            conditions.append(Attr('psc_code').eq(codes[0]))
        else:
            conditions.append(Attr('psc_code').is_in(codes))
    
    if filters.get('cfda_number'):
        numbers = filters['cfda_number'] if isinstance(filters['cfda_number'], list) else [filters['cfda_number']]
        if len(numbers) == 1:
            conditions.append(Attr('cfda_number').eq(numbers[0]))
        else:
            conditions.append(Attr('cfda_number').is_in(numbers))
    
    # Amount filters
    if filters.get('min_obligation') is not None:
        conditions.append(Attr('total_obligation').gte(Decimal(str(filters['min_obligation']))))
    
    if filters.get('max_obligation') is not None:
        conditions.append(Attr('total_obligation').lte(Decimal(str(filters['max_obligation']))))
    
    # Date filters
    if filters.get('date_from'):
        conditions.append(Attr('period_start_date').gte(filters['date_from']))
    
    if filters.get('date_to'):
        conditions.append(Attr('period_start_date').lte(filters['date_to']))
    
    # Fiscal year filter
    if filters.get('fiscal_year'):
        fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
        if len(fiscal_years) == 1:
            conditions.append(Attr('fiscal_year').eq(fiscal_years[0]))
        else:
            conditions.append(Attr('fiscal_year').is_in(fiscal_years))
    
    # Combine all conditions with AND
    if conditions:
        filter_expr = conditions[0]
        for cond in conditions[1:]:
            filter_expr = filter_expr & cond
        return filter_expr
    
    return None


def determine_query_method(filters: Dict[str, Any]) -> tuple[str, Optional[str], Optional[Dict]]:
    """
    Determine the best query method based on available filters
    
    Returns:
        Tuple of (method, index_name, key_condition_dict)
        method: 'query' or 'scan'
        index_name: GSI name if using query, None if scan
        key_condition: Dict with hash_key and range_key conditions
    """
    # Check for GSI-optimized queries
    
    # AwardingAgencyCodeFiscalYearIndex: hash_key=awarding_agency_code, range_key=fiscal_year
    if filters.get('awarding_agency_code'):
        values = filters['awarding_agency_code'] if isinstance(filters['awarding_agency_code'], list) else [filters['awarding_agency_code']]
        # Filter out empty strings
        values = [v for v in values if v and str(v).strip()]
        if values:
            # Separate codes and names
            codes = [v for v in values if is_agency_code(str(v))]
            names = [v for v in values if not is_agency_code(str(v))]
            
            # Prefer codes over names for GSI query
            if codes:
                # Use first code for hash key
                agency_code = codes[0]
                fiscal_year = None
                if filters.get('fiscal_year'):
                    fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                    if fiscal_years:
                        fiscal_year = fiscal_years[0]
                
                key_condition = {
                    'hash_key': ('awarding_agency_code', agency_code),
                    'range_key': ('fiscal_year', fiscal_year) if fiscal_year else None
                }
                return ('query', 'AwardingAgencyCodeFiscalYearIndex', key_condition)
            elif names:
                # For agency names, we can't use GSI query with exact match because:
                # 1. Users might search with partial names (e.g., "Treasury" to find "Department of the Treasury")
                # 2. Stored values might differ slightly (e.g., "Department of Treasury" vs "Department of the Treasury")
                # So we should use scan with contains filter instead of GSI query
                # This allows partial matching which is more user-friendly
                # Fall through to scan (don't return query here)
                pass
    
    # StateFiscalYearIndex: hash_key=recipient_location_state, range_key=fiscal_year
    if filters.get('recipient_location_state') and filters.get('fiscal_year'):
        state = filters['recipient_location_state']
        if isinstance(state, list):
            state = state[0]  # Use first state for hash key
        fiscal_year = filters['fiscal_year']
        if isinstance(fiscal_year, list):
            fiscal_year = fiscal_year[0]  # Use first fiscal year for range key
        
        key_condition = {
            'hash_key': ('recipient_location_state', state),
            'range_key': ('fiscal_year', fiscal_year)
        }
        return ('query', 'StateFiscalYearIndex', key_condition)
    
    # AwardTypeFiscalYearIndex: hash_key=award_type, range_key=fiscal_year
    if filters.get('award_type') and filters.get('fiscal_year'):
        award_type = filters['award_type']
        if isinstance(award_type, list):
            award_type = award_type[0]  # Use first award type for hash key
        fiscal_year = filters['fiscal_year']
        if isinstance(fiscal_year, list):
            fiscal_year = fiscal_year[0]  # Use first fiscal year for range key
        
        key_condition = {
            'hash_key': ('award_type', award_type),
            'range_key': ('fiscal_year', fiscal_year)
        }
        return ('query', 'AwardTypeFiscalYearIndex', key_condition)
    
    # AwardTypeFiscalYearIndex with just award_type (no fiscal_year filter)
    if filters.get('award_type') and not filters.get('fiscal_year'):
        award_type = filters['award_type']
        if isinstance(award_type, list):
            award_type = award_type[0]
        
        key_condition = {
            'hash_key': ('award_type', award_type),
            'range_key': None  # No range key filter
        }
        return ('query', 'AwardTypeFiscalYearIndex', key_condition)
    
    # StateFiscalYearIndex with just state (no fiscal_year filter)
    if filters.get('recipient_location_state') and not filters.get('fiscal_year'):
        state = filters['recipient_location_state']
        if isinstance(state, list):
            state = state[0]
        
        key_condition = {
            'hash_key': ('recipient_location_state', state),
            'range_key': None  # No range key filter
        }
        return ('query', 'StateFiscalYearIndex', key_condition)
    
    # RecipientNameFiscalYearIndex: hash_key=recipient_name_normalized, range_key=fiscal_year
    if filters.get('recipient_name'):
        recipient_names = filters['recipient_name'] if isinstance(filters['recipient_name'], list) else [filters['recipient_name']]
        # Filter out empty strings
        recipient_names = [n for n in recipient_names if n and str(n).strip()]
        if recipient_names:
            # Use first recipient name for hash key (normalized)
            recipient_name = recipient_names[0].lower().strip()
            fiscal_year = None
            if filters.get('fiscal_year'):
                fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                if fiscal_years:
                    fiscal_year = fiscal_years[0]
            
            key_condition = {
                'hash_key': ('recipient_name_normalized', recipient_name),
                'range_key': ('fiscal_year', fiscal_year) if fiscal_year else None
            }
            return ('query', 'RecipientNameFiscalYearIndex', key_condition)
    
    # FiscalYearObligationIndex: hash_key=fiscal_year, range_key=total_obligation
    if filters.get('fiscal_year'):
        fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
        if fiscal_years:
            fiscal_year = fiscal_years[0]
            # Use this GSI if we have obligation filters (min/max)
            # The range key condition will be built in the query logic using BETWEEN/GTE/LTE
            if filters.get('min_obligation') is not None or filters.get('max_obligation') is not None:
                key_condition = {
                    'hash_key': ('fiscal_year', fiscal_year),
                    'range_key': ('total_obligation', None)  # Will be handled with BETWEEN/GTE/LTE in query logic
                }
                return ('query', 'FiscalYearObligationIndex', key_condition)
    
    # FiscalYearStartDateIndex: hash_key=fiscal_year, range_key=period_start_date
    if filters.get('fiscal_year'):
        fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
        if fiscal_years:
            fiscal_year = fiscal_years[0]
            # Use this GSI if we have date_from or date_to filter (for date ranges)
            # Prefer this over PeriodEndDateIndex if we have date_from
            if filters.get('date_from') or filters.get('date_to'):
                key_condition = {
                    'hash_key': ('fiscal_year', fiscal_year),
                    'range_key': ('period_start_date', None)  # Will be handled with BETWEEN/GTE/LTE in query logic
                }
                return ('query', 'FiscalYearStartDateIndex', key_condition)
    
    # PeriodStartDateIndex: hash_key=fiscal_year, range_key=period_start_date (duplicate of FiscalYearStartDateIndex)
    # Note: This is a duplicate, so we use FiscalYearStartDateIndex above
    
    # PeriodEndDateIndex: hash_key=fiscal_year, range_key=period_end_date
    # Only use this if we have date_to but no date_from (and no obligation filters)
    if filters.get('fiscal_year') and filters.get('date_to') and not filters.get('date_from') and not (filters.get('min_obligation') or filters.get('max_obligation')):
        fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
        if fiscal_years:
            fiscal_year = fiscal_years[0]
            key_condition = {
                'hash_key': ('fiscal_year', fiscal_year),
                'range_key': ('period_end_date', None)  # Will be handled with LTE in query logic
            }
            return ('query', 'PeriodEndDateIndex', key_condition)
    
    # FiscalYearObligationIndex with just fiscal_year (no obligation filter)
    if filters.get('fiscal_year') and not (filters.get('min_obligation') or filters.get('max_obligation') or 
                                           filters.get('date_from') or filters.get('date_to')):
        fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
        if fiscal_years:
            fiscal_year = fiscal_years[0]
            key_condition = {
                'hash_key': ('fiscal_year', fiscal_year),
                'range_key': None  # No range key filter
            }
            return ('query', 'FiscalYearObligationIndex', key_condition)
    
    # Default to scan if no GSI-optimized query available
    return ('scan', None, None)


def query_gsi_for_award_ids(index_name: str, hash_key_name: str, hash_key_value: Any, 
                            range_key_name: Optional[str] = None, range_key_value: Any = None,
                            range_key_condition: Optional[str] = None, limit: int = 1000,
                            exclusive_start_key: Optional[Dict] = None, get_all: bool = False) -> tuple[List[str], Optional[Dict]]:
    """
    Query a GSI and return award_ids (for KEYS_ONLY GSIs)
    
    Args:
        index_name: Name of the GSI to query
        hash_key_name: Hash key attribute name
        hash_key_value: Hash key value
        range_key_name: Optional range key attribute name
        range_key_value: Optional range key value (for exact match)
        range_key_condition: Optional range key condition ('gte', 'lte', 'between')
        limit: Maximum number of award_ids to return per batch
        exclusive_start_key: Pagination token to continue from
        get_all: If True, paginate to get all items (up to limit). If False, return single batch.
    
    Returns:
        Tuple of (award_ids list, last_evaluated_key for pagination)
    """
    award_ids = []
    last_eval_key = exclusive_start_key
    
    params = {
        'IndexName': index_name,
        'KeyConditionExpression': Key(hash_key_name).eq(hash_key_value),
        'Limit': limit,
        'ProjectionExpression': 'award_id'  # Only need award_id from KEYS_ONLY GSI
    }
    
    # Add range key condition if provided
    if range_key_name:
        if range_key_condition == 'between' and isinstance(range_key_value, tuple):
            params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).between(range_key_value[0], range_key_value[1])
        elif range_key_condition == 'gte':
            params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).gte(range_key_value)
        elif range_key_condition == 'lte':
            params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).lte(range_key_value)
        elif range_key_value is not None:
            params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).eq(range_key_value)
    
    # Query GSI (with pagination if get_all=True)
    max_rounds = 100 if get_all else 1  # Limit pagination rounds
    round_count = 0
    
    while round_count < max_rounds:
        round_count += 1
        try:
            if last_eval_key:
                params['ExclusiveStartKey'] = last_eval_key
            
            response = awards_table.query(**params)
            gsi_items = response.get('Items', [])
            last_eval_key = response.get('LastEvaluatedKey')
            
            # Extract award_ids
            for item in gsi_items:
                award_id = item.get('award_id')
                if award_id:
                    award_ids.append(award_id)
            
            # Stop if no more items or we have enough (and not getting all)
            if not last_eval_key:
                break
            if not get_all:
                break
            if len(award_ids) >= limit:
                break
                
        except Exception as e:
            logger.error(f"Error querying GSI {index_name}: {str(e)}", exc_info=True)
            break
    
    return award_ids[:limit], last_eval_key


def identify_queryable_filters(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Identify which filters can use GSIs and return query configurations
    
    Returns:
        List of query configs, each with: filter_key, index_name, hash_key, hash_value, range_key, range_value
    """
    query_configs = []
    
    # AwardingAgencyCodeFiscalYearIndex: hash_key=awarding_agency_code, range_key=fiscal_year
    if filters.get('awarding_agency_code'):
        values = filters['awarding_agency_code'] if isinstance(filters['awarding_agency_code'], list) else [filters['awarding_agency_code']]
        values = [v for v in values if v and str(v).strip()]
        if values:
            codes = [v for v in values if is_agency_code(str(v))]
            if codes:
                fiscal_year = None
                if filters.get('fiscal_year'):
                    fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                    if fiscal_years:
                        fiscal_year = fiscal_years[0]
                
                query_configs.append({
                    'filter_key': 'awarding_agency_code',
                    'index_name': 'AwardingAgencyCodeFiscalYearIndex',
                    'hash_key': 'awarding_agency_code',
                    'hash_value': codes[0],
                    'range_key': 'fiscal_year' if fiscal_year else None,
                    'range_value': fiscal_year,
                    'range_condition': None
                })
    
    # RecipientNameFiscalYearIndex: hash_key=recipient_name_normalized, range_key=fiscal_year
    if filters.get('recipient_name'):
        recipient_names = filters['recipient_name'] if isinstance(filters['recipient_name'], list) else [filters['recipient_name']]
        recipient_names = [n for n in recipient_names if n and str(n).strip()]
        if recipient_names:
            # Use first recipient name (normalized) for hash key
            recipient_name = recipient_names[0].lower().strip()
            fiscal_year = None
            if filters.get('fiscal_year'):
                fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                if fiscal_years:
                    fiscal_year = fiscal_years[0]
            
            query_configs.append({
                'filter_key': 'recipient_name',
                'index_name': 'RecipientNameFiscalYearIndex',
                'hash_key': 'recipient_name_normalized',
                'hash_value': recipient_name,
                'range_key': 'fiscal_year' if fiscal_year else None,
                'range_value': fiscal_year,
                'range_condition': None
            })
    
    # StateFiscalYearIndex: hash_key=recipient_location_state, range_key=fiscal_year
    if filters.get('recipient_location_state'):
        states = filters['recipient_location_state'] if isinstance(filters['recipient_location_state'], list) else [filters['recipient_location_state']]
        if states:
            state = states[0]
            fiscal_year = None
            if filters.get('fiscal_year'):
                fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                if fiscal_years:
                    fiscal_year = fiscal_years[0]
            
            query_configs.append({
                'filter_key': 'recipient_location_state',
                'index_name': 'StateFiscalYearIndex',
                'hash_key': 'recipient_location_state',
                'hash_value': state,
                'range_key': 'fiscal_year' if fiscal_year else None,
                'range_value': fiscal_year,
                'range_condition': None
            })
    
    # AwardTypeFiscalYearIndex: hash_key=award_type, range_key=fiscal_year
    if filters.get('award_type'):
        award_types = filters['award_type'] if isinstance(filters['award_type'], list) else [filters['award_type']]
        if award_types:
            award_type = award_types[0]
            fiscal_year = None
            if filters.get('fiscal_year'):
                fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                if fiscal_years:
                    fiscal_year = fiscal_years[0]
            
            query_configs.append({
                'filter_key': 'award_type',
                'index_name': 'AwardTypeFiscalYearIndex',
                'hash_key': 'award_type',
                'hash_value': award_type,
                'range_key': 'fiscal_year' if fiscal_year else None,
                'range_value': fiscal_year,
                'range_condition': None
            })
    
    # FiscalYearObligationIndex: hash_key=fiscal_year, range_key=total_obligated_amount
    if filters.get('fiscal_year') and (filters.get('min_obligation') is not None or filters.get('max_obligation') is not None):
        fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
        if fiscal_years:
            fiscal_year = fiscal_years[0]
            range_condition = None
            range_value = None
            if filters.get('min_obligation') is not None and filters.get('max_obligation') is not None:
                range_condition = 'between'
                range_value = (Decimal(str(filters['min_obligation'])), Decimal(str(filters['max_obligation'])))
            elif filters.get('min_obligation') is not None:
                range_condition = 'gte'
                range_value = Decimal(str(filters['min_obligation']))
            elif filters.get('max_obligation') is not None:
                range_condition = 'lte'
                range_value = Decimal(str(filters['max_obligation']))
            
            query_configs.append({
                'filter_key': 'fiscal_year_obligation',
                'index_name': 'FiscalYearObligationIndex',
                'hash_key': 'fiscal_year',
                'hash_value': fiscal_year,
                'range_key': 'total_obligated_amount',
                'range_value': range_value,
                'range_condition': range_condition
            })
    
    # PeriodStartDateIndex: hash_key=fiscal_year, range_key=period_start_date
    if filters.get('date_from'):
        date_from = filters['date_from']
        if date_from and str(date_from).strip():
            # Calculate fiscal_year from date_from if not provided
            fiscal_year = None
            if filters.get('fiscal_year'):
                fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                if fiscal_years:
                    fiscal_year = fiscal_years[0]
            else:
                # Calculate fiscal year from date (US fiscal year: Oct 1 - Sep 30)
                try:
                    from datetime import datetime
                    date_obj = datetime.strptime(str(date_from).split('T')[0], '%Y-%m-%d')
                    year = date_obj.year
                    month = date_obj.month
                    # Fiscal year starts Oct 1, so months 10-12 belong to next fiscal year
                    fiscal_year = year + 1 if month >= 10 else year
                except (ValueError, TypeError):
                    pass
            
            if fiscal_year:
                query_configs.append({
                    'filter_key': 'date_from',
                    'index_name': 'PeriodStartDateIndex',
                    'hash_key': 'fiscal_year',
                    'hash_value': fiscal_year,
                    'range_key': 'period_start_date',
                    'range_value': str(date_from).split('T')[0],  # Use just date part
                    'range_condition': 'gte'  # Greater than or equal to date_from
                })
    
    # PeriodEndDateIndex: hash_key=fiscal_year, range_key=period_end_date
    if filters.get('date_to'):
        date_to = filters['date_to']
        if date_to and str(date_to).strip():
            # Calculate fiscal_year from date_to if not provided
            fiscal_year = None
            if filters.get('fiscal_year'):
                fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                if fiscal_years:
                    fiscal_year = fiscal_years[0]
            else:
                # Calculate fiscal year from date (US fiscal year: Oct 1 - Sep 30)
                try:
                    from datetime import datetime
                    date_obj = datetime.strptime(str(date_to).split('T')[0], '%Y-%m-%d')
                    year = date_obj.year
                    month = date_obj.month
                    # Fiscal year starts Oct 1, so months 10-12 belong to next fiscal year
                    fiscal_year = year + 1 if month >= 10 else year
                except (ValueError, TypeError):
                    pass
            
            if fiscal_year:
                query_configs.append({
                    'filter_key': 'date_to',
                    'index_name': 'PeriodEndDateIndex',
                    'hash_key': 'fiscal_year',
                    'hash_value': fiscal_year,
                    'range_key': 'period_end_date',
                    'range_value': str(date_to).split('T')[0],  # Use just date part
                    'range_condition': 'lte'  # Less than or equal to date_to
                })
    
    return query_configs


def search_awards(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search awards in DynamoDB using filters with multi-GSI intersection approach
    
    Strategy:
    1. Query each filter's GSI separately to get award_ids
    2. Use the shortest list as source of truth (most restrictive filter)
    3. Fetch full items for that list
    4. Apply remaining filters in Python
    5. Paginate until one query runs out of items
    
    Args:
        filters: Dictionary of filter fields
        limit: Maximum number of results to return
        last_evaluated_key: Pagination token from previous request (not used in new approach)
    
    Returns:
        Dictionary with search results and pagination info
    """
    if not awards_table:
        raise Exception("DynamoDB awards table not initialized")
    
    # Identify which filters can use GSIs
    query_configs = identify_queryable_filters(filters)
    
    # If we have multiple queryable filters, use intersection approach
    if len(query_configs) > 1:
        logger.info(f"Using multi-GSI intersection approach with {len(query_configs)} GSIs")
        
        # Query each GSI to get initial batch of award_ids (to determine shortest list)
        gsi_results = {}
        for config in query_configs:
            logger.info(f"Querying {config['index_name']} for {config['filter_key']}={config['hash_value']}")
            # Get first batch to determine which is shortest
            award_ids, _ = query_gsi_for_award_ids(
                index_name=config['index_name'],
                hash_key_name=config['hash_key'],
                hash_key_value=config['hash_value'],
                range_key_name=config.get('range_key'),
                range_key_value=config.get('range_value'),
                range_key_condition=config.get('range_condition'),
                limit=1000,  # Get first batch
                get_all=False
            )
            gsi_results[config['filter_key']] = {
                'award_ids': set(award_ids),  # Will be updated during pagination
                'config': config,
                'total_count': len(award_ids),
                'last_eval_key': None  # Will be set during pagination
            }
            logger.info(f"Found {len(award_ids)} award_ids from {config['index_name']} (first batch)")
        
        # Find the shortest list (most restrictive filter) - this is our source of truth
        shortest_key = min(gsi_results.keys(), key=lambda k: len(gsi_results[k]['award_ids']))
        source_award_ids = list(gsi_results[shortest_key]['award_ids'])
        source_config = gsi_results[shortest_key]['config']
        
        logger.info(f"Using {shortest_key} as source of truth ({len(source_award_ids)} award_ids)")
        
        # Remove the source filter from filters (we've already applied it via GSI)
        # Keep all other filters to apply in Python
        remaining_filters = filters.copy()
        if shortest_key == 'awarding_agency_code':
            del remaining_filters['awarding_agency_code']
            # Also remove awarding_agency_name if present (code takes precedence when using GSI)
            if 'awarding_agency_name' in remaining_filters:
                del remaining_filters['awarding_agency_name']
        elif shortest_key == 'recipient_name':
            del remaining_filters['recipient_name']
        elif shortest_key == 'recipient_location_state':
            del remaining_filters['recipient_location_state']
        elif shortest_key == 'award_type':
            del remaining_filters['award_type']
        elif shortest_key == 'fiscal_year_obligation':
            if 'fiscal_year' in remaining_filters:
                del remaining_filters['fiscal_year']
            if 'min_obligation' in remaining_filters:
                del remaining_filters['min_obligation']
            if 'max_obligation' in remaining_filters:
                del remaining_filters['max_obligation']
        elif shortest_key == 'date_from':
            # Remove date_from since we've applied it via GSI
            if 'date_from' in remaining_filters:
                del remaining_filters['date_from']
            # Also remove fiscal_year if it was calculated from date_from
            if 'fiscal_year' in remaining_filters and not filters.get('fiscal_year'):
                # Only remove if it wasn't explicitly provided
                pass  # Keep it for now, might be needed for other filters
        elif shortest_key == 'date_to':
            # Remove date_to since we've applied it via GSI
            if 'date_to' in remaining_filters:
                del remaining_filters['date_to']
            # Also remove fiscal_year if it was calculated from date_to
            if 'fiscal_year' in remaining_filters and not filters.get('fiscal_year'):
                # Only remove if it wasn't explicitly provided
                pass  # Keep it for now, might be needed for other filters
        
        logger.info(f"Remaining filters to apply in Python: {list(remaining_filters.keys())}")
        
        # Paginate through source GSI until we have enough results or it runs out
        all_matching_items = []  # Store full items that match all filters
        source_last_eval_key = None
        max_pagination_rounds = 50  # Limit to avoid infinite loops
        pagination_round = 0
        
        while len(all_matching_items) < limit and pagination_round < max_pagination_rounds:
            pagination_round += 1
            
            # Query source GSI with pagination
            source_award_ids_batch, source_last_eval_key = query_gsi_for_award_ids(
                index_name=source_config['index_name'],
                hash_key_name=source_config['hash_key'],
                hash_key_value=source_config['hash_value'],
                range_key_name=source_config.get('range_key'),
                range_key_value=source_config.get('range_value'),
                range_key_condition=source_config.get('range_condition'),
                limit=1000,
                exclusive_start_key=source_last_eval_key,
                get_all=False
            )
            
            if not source_award_ids_batch:
                logger.info(f"Source GSI {source_config['index_name']} ran out of items")
                break
            
            logger.info(f"Pagination round {pagination_round}: Got {len(source_award_ids_batch)} award_ids from source GSI")
            
            # Fetch full items for this batch (no GSI intersection - we'll filter in Python)
            items_batch = []
            if source_award_ids_batch:
                batch_size = 100
                for i in range(0, len(source_award_ids_batch), batch_size):
                    batch_ids = source_award_ids_batch[i:i + batch_size]
                    dynamodb_client = boto3.client('dynamodb')
                    request_items = {
                        AWARDS_TABLE_NAME: {
                            'Keys': [{'award_id': {'S': str(aid)}} for aid in batch_ids]
                        }
                    }
                    batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                    batch_items = batch_response.get('Responses', {}).get(AWARDS_TABLE_NAME, [])
                    deserializer = TypeDeserializer()
                    for item in batch_items:
                        converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                        items_batch.append(converted_item)
            
            # Apply remaining filters in Python
            for item in items_batch:
                if apply_python_filter(item, remaining_filters):
                    all_matching_items.append(item)  # Store the full item that matches all filters
                else:
                    # Log why item was filtered out
                    award_id = item.get('award_id', 'unknown')
                    item_agency_code = item.get('awarding_agency_code', 'missing')
                    item_agency_name = item.get('awarding_agency_name', 'missing')
                    logger.info(f"Item {award_id} filtered out: agency_code='{item_agency_code}' (type={type(item.get('awarding_agency_code'))}), agency_name='{item_agency_name}', filter_value={remaining_filters.get('awarding_agency_code')}")
            
            logger.info(f"Pagination round {pagination_round}: {len(all_matching_items)} items matched all filters (out of {len(items_batch)} fetched)")
            
            # Stop if source GSI ran out or we have enough results
            if not source_last_eval_key or len(all_matching_items) >= limit:
                break
        
        # Use the collected items directly (they're already full items)
        items = all_matching_items[:limit]
        
        logger.info(f"Multi-GSI intersection complete: {len(items)} items matching all filters")
        method = 'multi_gsi_intersection'
        index_name = f"{len(query_configs)}_GSIs"
        
        # Convert Decimal to float and bytes for JSON serialization
        results = [convert_decimal_to_float(item) for item in items]
        
        # Enrich results - handle transactions/subawards and oversized items
        enriched_results = []
        s3_fetch_success_count = 0
        s3_fetch_fail_count = 0
        for award in results:
            # Check if this is an oversized item (full details in S3)
            oversize_s3_key = award.get('oversize_s3_key')
            if oversize_s3_key:
                # Fetch full award details from S3
                full_award = fetch_oversized_award_from_s3(oversize_s3_key)
                if full_award:
                    # Replace award with full details from S3
                    award = convert_decimal_to_float(full_award)
                    s3_fetch_success_count += 1
                else:
                    s3_fetch_fail_count += 1
            
            # Transactions and subawards are now stored directly in the table
            # Ensure they exist (may be None or missing)
            if 'transactions' not in award or award.get('transactions') is None:
                award['transactions'] = []
            if 'subawards' not in award or award.get('subawards') is None:
                award['subawards'] = []
            
            # Parse is_assistance binary byte if present
            if 'is_assistance' in award:
                is_assistance_val = award['is_assistance']
                if isinstance(is_assistance_val, bytes):
                    award['is_assistance'] = bool(is_assistance_val[0]) if len(is_assistance_val) > 0 else False
                elif isinstance(is_assistance_val, int):
                    award['is_assistance'] = bool(is_assistance_val)
            
            # Calculate combined obligated amount from transactions for IDVs
            if award.get('transactions') and isinstance(award['transactions'], list):
                combined_obligated = 0.0
                for transaction in award['transactions']:
                    if isinstance(transaction, dict):
                        obligation = transaction.get('federal_action_obligation') or \
                                    transaction.get('total_obligated_amount') or \
                                    transaction.get('obligated_amount') or 0
                        try:
                            if isinstance(obligation, (int, float)):
                                combined_obligated += float(obligation)
                            elif isinstance(obligation, str):
                                combined_obligated += float(obligation)
                        except (ValueError, TypeError):
                            pass
                
                if combined_obligated > 0 and (not award.get('total_obligated_amount') or award.get('total_obligated_amount') == 0):
                    award['combined_obligated_amount'] = combined_obligated
            
            # Fetch child award details for IDV parents
            if award.get('is_idv_parent') and award.get('child_awards'):
                child_award_ids = award.get('child_awards', [])
                if isinstance(child_award_ids, list) and len(child_award_ids) > 0:
                    logger.info(f"Fetching details for {len(child_award_ids)} child awards for IDV {award.get('award_id')}")
                    child_awards_details = []
                    for child_id in child_award_ids:
                        try:
                            child_response = awards_table.get_item(Key={'award_id': str(child_id)})
                            if 'Item' in child_response:
                                child_item = child_response['Item']
                                child_item = convert_decimal_to_float(child_item)
                                child_summary = {
                                    'award_id': child_item.get('award_id'),
                                    'award_id_piid': child_item.get('award_id_piid'),
                                    'description': child_item.get('description'),
                                    'total_obligated_amount': child_item.get('total_obligated_amount'),
                                    'period_of_performance_start_date': child_item.get('period_of_performance_start_date') or child_item.get('period_start_date'),
                                    'period_of_performance_current_end_date': child_item.get('period_of_performance_current_end_date') or child_item.get('period_end_date'),
                                    'transaction_count': child_item.get('transaction_count', 0),
                                    'subaward_count': child_item.get('subaward_count', 0),
                                    'award_type': child_item.get('award_type'),
                                    'award_type_description': child_item.get('award_type_description'),
                                    'recipient_name': child_item.get('recipient_name'),
                                    'awarding_agency_name': child_item.get('awarding_agency_name'),
                                    'parent_idv_id': child_item.get('parent_idv_id'),
                                    'is_idv_child': child_item.get('is_idv_child', False),
                                }
                                child_awards_details.append(child_summary)
                        except Exception as e:
                            logger.error(f"Error fetching child award {child_id}: {str(e)}")
                            continue
                    
                    award['child_awards_details'] = child_awards_details
        
            enriched_results.append(award)
        
        if enriched_results:
            logger.info(f"Enriched {len(enriched_results)} award(s). S3 fetch: {s3_fetch_success_count} success, {s3_fetch_fail_count} failed")
        
        # Return results for multi-GSI intersection
        return {
            'success': True,
            'results': enriched_results,
            'count': len(enriched_results),
            'has_more': False,  # Multi-GSI intersection doesn't support pagination yet
            'last_evaluated_key': None,
            'method': method,
            'index_used': index_name
        }
    
    # Fall back to single GSI query or scan
    method, index_name, key_condition = determine_query_method(filters)
    
    # Build filter expression, but exclude conditions already in key_condition
    # Create a copy of filters to avoid modifying the original
    filter_filters = filters.copy()
    
    # If using GSI query, remove the hash_key and range_key conditions from filters to avoid duplication
    # DynamoDB doesn't allow primary key attributes in FilterExpression when they're in KeyConditionExpression
    if method == 'query' and key_condition:
        hash_key_name = key_condition.get('hash_key', [None])[0] if key_condition.get('hash_key') else None
        range_key_name = key_condition.get('range_key', [None])[0] if key_condition.get('range_key') else None
        
        # Remove hash key from filter - it's already in KeyConditionExpression
        # This is critical: DynamoDB doesn't allow primary key attributes in FilterExpression
        if hash_key_name == 'awarding_agency_code' or hash_key_name == 'awarding_agency_name':
            # Remove awarding_agency_code from filters since we're using it as hash key
            # Note: We can't filter for multiple agency codes/names when using GSI query
            # The first one is used for the hash key, others would need to be filtered client-side
            if 'awarding_agency_code' in filter_filters:
                del filter_filters['awarding_agency_code']
        elif hash_key_name == 'recipient_name_normalized':
            # Remove recipient_name from filters since we're using it as hash key
            if 'recipient_name' in filter_filters:
                del filter_filters['recipient_name']
        elif hash_key_name == 'recipient_location_state':
            # Remove recipient_location_state from filters since we're using it as hash key
            if 'recipient_location_state' in filter_filters:
                del filter_filters['recipient_location_state']
        elif hash_key_name == 'award_type':
            # Remove award_type from filters since we're using it as hash key
            if 'award_type' in filter_filters:
                del filter_filters['award_type']
        elif hash_key_name == 'fiscal_year':
            # Remove fiscal_year from filters since we're using it as hash key
            if 'fiscal_year' in filter_filters:
                del filter_filters['fiscal_year']
        
        # Remove range key from filter if it's being used in KeyConditionExpression
        if range_key_name == 'fiscal_year' and 'fiscal_year' in filter_filters:
            del filter_filters['fiscal_year']
        elif range_key_name == 'total_obligation':
            # Remove obligation filters since they're handled in KeyConditionExpression
            if 'min_obligation' in filter_filters:
                del filter_filters['min_obligation']
            if 'max_obligation' in filter_filters:
                del filter_filters['max_obligation']
        elif range_key_name == 'period_start_date':
            # Remove date_from since it's handled in KeyConditionExpression
            if 'date_from' in filter_filters:
                del filter_filters['date_from']
            # Note: date_to might still be needed in FilterExpression if not in range key
        elif range_key_name == 'period_end_date':
            # Remove date_to since it's handled in KeyConditionExpression
            if 'date_to' in filter_filters:
                del filter_filters['date_to']
    
    # Build filter expression
    filter_expr = build_filter_expression(filter_filters)
    
    # Build query/scan parameters
    # For scans, we need to scan more items than the result limit to account for filtering
    # DynamoDB Limit parameter limits the number of items evaluated, not just results returned
    scan_limit = None  # Will be set for scans
    if method == 'scan':
        # Scan more items to increase chances of finding matches after filtering
        # Use a multiplier to scan more items (e.g., scan 10x the limit to find matches)
        scan_limit = max(limit * 10, 1000)  # Scan at least 10x the limit, minimum 1000 items
        params = {
            'Limit': scan_limit
        }
        logger.info(f"Using scan with Limit={scan_limit} (result limit={limit}) to find matches")
    else:
        # For queries with KEYS_ONLY GSIs, we need to fetch more items than the limit
        # because we'll filter in Python after BatchGetItem (some items may not match filters)
        # Use a multiplier to fetch more items (e.g., fetch 5x the limit to account for filtering)
        query_limit = max(limit * 5, 100)  # Fetch at least 5x the limit, minimum 100 items
        params = {
            'Limit': query_limit
        }
        logger.info(f"Using GSI query with Limit={query_limit} (result limit={limit}) to account for post-filtering")
    
    if method == 'query' and index_name:
        # Use GSI query
        hash_key_name, hash_key_value = key_condition['hash_key']
        params['IndexName'] = index_name
        params['KeyConditionExpression'] = Key(hash_key_name).eq(hash_key_value)
        
        # Add range key condition if provided
        if key_condition.get('range_key'):
            range_key_name, range_key_value = key_condition['range_key']
            # Check if we need to use BETWEEN, GTE, or LTE for range key
            # This is determined by the original filters
            if range_key_value is None:
                # Range key name is set but value is None - use filters to build condition
                if range_key_name == 'period_start_date':
                    if filters.get('date_from') and filters.get('date_to'):
                        # Use BETWEEN for date range
                        params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).between(filters['date_from'], filters['date_to'])
                    elif filters.get('date_from'):
                        # Use GTE for date_from
                        params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).gte(filters['date_from'])
                    # If only date_to, we can't use this GSI effectively
                elif range_key_name == 'period_end_date':
                    if filters.get('date_to'):
                        # Use LTE for date_to
                        params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).lte(filters['date_to'])
                elif range_key_name == 'total_obligation':
                    if filters.get('min_obligation') is not None and filters.get('max_obligation') is not None:
                        # Use BETWEEN for obligation range
                        from decimal import Decimal
                        params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).between(Decimal(str(filters['min_obligation'])), Decimal(str(filters['max_obligation'])))
                    elif filters.get('min_obligation') is not None:
                        # Use GTE for min_obligation
                        from decimal import Decimal
                        params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).gte(Decimal(str(filters['min_obligation'])))
                    elif filters.get('max_obligation') is not None:
                        # Use LTE for max_obligation
                        from decimal import Decimal
                        params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).lte(Decimal(str(filters['max_obligation'])))
                # If range_key_value is None and no filter matches, don't add range key condition
            else:
                # Default to equals
                params['KeyConditionExpression'] = params['KeyConditionExpression'] & Key(range_key_name).eq(range_key_value)
        
        # For KEYS_ONLY GSIs, we cannot use FilterExpression on non-key attributes
        # All filtering will be done after fetching full items with BatchGetItem
        # Skip FilterExpression for GSI queries - we'll filter in Python after BatchGetItem
        # Note: This is necessary because KEYS_ONLY GSIs only project the hash/range keys
        # and award_id, so FilterExpression can't access other attributes
        logger.info(f"Skipping FilterExpression for KEYS_ONLY GSI {index_name} - will filter after BatchGetItem")
        
        # Validate and use last_evaluated_key for pagination
        # For GSI queries, the key must include the GSI's hash key and range key (if applicable)
        if last_evaluated_key:
            try:
                # Validate that the last_evaluated_key has the correct structure for this GSI
                if isinstance(last_evaluated_key, dict):
                    # Check if the key has the required hash key for this GSI
                    # For GSI queries, LastEvaluatedKey should have the GSI's key structure
                    # It should include the hash_key_name and optionally the range_key_name
                    has_hash_key = hash_key_name in last_evaluated_key
                    
                    if key_condition.get('range_key'):
                        range_key_name = key_condition['range_key'][0]
                        has_range_key = range_key_name in last_evaluated_key
                        if has_hash_key and has_range_key:
                            params['ExclusiveStartKey'] = last_evaluated_key
                        else:
                            logger.warning(f"last_evaluated_key structure doesn't match GSI {index_name} (hash_key={hash_key_name}, range_key={range_key_name}), ignoring pagination")
                    else:
                        # No range key, just need hash key
                        if has_hash_key:
                            params['ExclusiveStartKey'] = last_evaluated_key
                        else:
                            logger.warning(f"last_evaluated_key missing hash key {hash_key_name} for GSI {index_name}, ignoring pagination")
                else:
                    logger.warning(f"last_evaluated_key is not a dict, ignoring pagination")
            except Exception as e:
                logger.warning(f"Error validating last_evaluated_key: {e}, ignoring pagination")
        
        logger.info(f"Querying {index_name} with hash_key={hash_key_name}={hash_key_value}")
        response = awards_table.query(**params)
        
        # Store last_evaluated_key for potential pagination
        last_eval_key = response.get('LastEvaluatedKey')
        initial_last_eval_key = last_eval_key  # Store for pagination
    
    else:
        # Use table scan
        if filter_expr:
            params['FilterExpression'] = filter_expr
        
        if last_evaluated_key:
            params['ExclusiveStartKey'] = last_evaluated_key
        
        logger.info(f"Scanning awards table with filters")
        response = awards_table.scan(**params)
    
    # Extract results from GSI query/scan
    # With KEYS_ONLY GSIs, items only contain award_id + hash/range keys
    gsi_items = response.get('Items', [])
    last_eval_key = response.get('LastEvaluatedKey')
    scanned_count = response.get('ScannedCount', 0)
    
    # For scans, if we didn't find enough results and there are more items, continue scanning
    if method == 'scan' and scan_limit is not None and len(gsi_items) < limit and last_eval_key and scanned_count > 0:
        # Continue scanning if we haven't found enough results
        # Limit the number of continuation scans to avoid infinite loops
        max_continuation_scans = 10
        continuation_count = 0
        
        while len(gsi_items) < limit and last_eval_key and continuation_count < max_continuation_scans:
            continuation_count += 1
            logger.info(f"Continuing scan (iteration {continuation_count}/{max_continuation_scans}), found {len(gsi_items)} items so far, scanned {scanned_count} total")
            
            # Continue scan from last evaluated key
            continuation_params = params.copy()
            continuation_params['ExclusiveStartKey'] = last_eval_key
            continuation_params['Limit'] = scan_limit  # Use the same scan limit
            
            continuation_response = awards_table.scan(**continuation_params)
            continuation_items = continuation_response.get('Items', [])
            last_eval_key = continuation_response.get('LastEvaluatedKey')
            scanned_count += continuation_response.get('ScannedCount', 0)
            
            gsi_items.extend(continuation_items)
            
            # Stop if we have enough results or no more items
            if len(gsi_items) >= limit or not last_eval_key:
                break
        
        logger.info(f"Scan complete: found {len(gsi_items)} items after scanning {scanned_count} total items")
    
    # Extract award_ids from GSI results (KEYS_ONLY projection only returns keys)
    award_ids = []
    for item in gsi_items:
        award_id = item.get('award_id')
        if award_id:
            award_ids.append(award_id)
    
    # Don't limit award_ids yet - we need to fetch more items than the limit
    # because we'll filter in Python after BatchGetItem (some items may not match filters)
    # We'll limit after filtering
    
    # Log initial results found
    if award_ids:
        logger.info(f"Found {len(award_ids)} award_id(s) from {method}" + (f" with index {index_name}" if index_name else ""))
    else:
        logger.info(f"No awards found using {method}" + (f" with index {index_name}" if index_name else ""))
    
    # Phase 2: Fetch full items from main table using BatchGetItem
    # DynamoDB BatchGetItem limit is 100 items per batch
    items = []
    if award_ids:
        batch_size = 100
        for i in range(0, len(award_ids), batch_size):
            batch_ids = award_ids[i:i + batch_size]
            
            try:
                # Use table resource's batch_get_item (simpler than client)
                # Build keys for batch_get_item
                keys = [{'award_id': award_id} for award_id in batch_ids]
                
                # Use the table's batch_get_item method
                # Note: boto3 resource doesn't have a direct batch_get_item, so we use the client
                # But we can use get_item in a loop or use the client's batch_get_item
                # For efficiency, we'll use the client's batch_get_item and convert manually
                dynamodb_client = boto3.client('dynamodb')
                
                # Build request items
                request_items = {
                    AWARDS_TABLE_NAME: {
                        'Keys': [{'award_id': {'S': str(award_id)}} for award_id in batch_ids]
                    }
                }
                
                batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                
                # Extract items from response
                batch_items = batch_response.get('Responses', {}).get(AWARDS_TABLE_NAME, [])
                
                # Convert DynamoDB format to Python dict using TypeDeserializer
                deserializer = TypeDeserializer()
                for item in batch_items:
                    # Convert entire item using deserializer
                    converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                    items.append(converted_item)
                
                # Handle unprocessed keys (throttling) - retry once
                unprocessed = batch_response.get('UnprocessedKeys', {})
                if unprocessed:
                    unprocessed_keys = unprocessed.get(AWARDS_TABLE_NAME, {}).get('Keys', [])
                    if unprocessed_keys:
                        logger.warning(f"Unprocessed keys in batch {i//batch_size + 1}: {len(unprocessed_keys)} items, retrying...")
                        # Extract award_ids from unprocessed keys
                        retry_ids = []
                        for key_dict in unprocessed_keys:
                            if 'award_id' in key_dict and 'S' in key_dict['award_id']:
                                retry_ids.append(key_dict['award_id']['S'])
                        
                        if retry_ids:
                            # Retry with a small delay
                            time.sleep(0.1)
                            retry_request = {
                                AWARDS_TABLE_NAME: {
                                    'Keys': [{'award_id': {'S': str(aid)}} for aid in retry_ids]
                                }
                            }
                            retry_response = dynamodb_client.batch_get_item(RequestItems=retry_request)
                            retry_items = retry_response.get('Responses', {}).get(AWARDS_TABLE_NAME, [])
                            
                            # Convert retry items using deserializer
                            deserializer = TypeDeserializer()
                            for item in retry_items:
                                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                                items.append(converted_item)
            
            except Exception as e:
                logger.error(f"Error in BatchGetItem for batch {i//batch_size + 1}: {str(e)}", exc_info=True)
                # Continue with other batches even if one fails
                continue
        
        logger.info(f"Fetched {len(items)} full award item(s) from main table using BatchGetItem")
    
    # Apply filters in Python after fetching full items
    # This is necessary for:
    # 1. KEYS_ONLY GSI queries (FilterExpression can't be used on non-key attributes)
    # 2. Scans with filters that aren't supported in FilterExpression (like awarding_agency_name)
    if items and filter_filters:
        if method == 'query':
            logger.info(f"Applying filters in Python to {len(items)} items (KEYS_ONLY GSI doesn't support FilterExpression)")
        elif method == 'scan':
            logger.info(f"Applying filters in Python to {len(items)} items from scan (some filters like awarding_agency_name not in FilterExpression)")
        logger.debug(f"Filter criteria: {json.dumps(filter_filters, default=str)}")
        filtered_items = []
        filter_failures = {}
        for idx, item in enumerate(items):
            if apply_python_filter(item, filter_filters):
                filtered_items.append(item)
            else:
                # Track why items are being filtered out (for debugging)
                award_id = item.get('award_id', 'unknown')
                if award_id not in filter_failures:
                    filter_failures[award_id] = {
                        'recipient_name': item.get('recipient_name'),
                        'recipient_name_normalized': item.get('recipient_name_normalized'),
                        'awarding_agency_code': item.get('awarding_agency_code'),
                        'awarding_agency_name': item.get('awarding_agency_name'),
                    }
                # Only log first few failures to avoid spam
                if len(filter_failures) <= 3:
                    logger.debug(f"Item {award_id} filtered out: recipient_name='{item.get('recipient_name')}', recipient_name_normalized='{item.get('recipient_name_normalized')}', awarding_agency_code='{item.get('awarding_agency_code')}', awarding_agency_name='{item.get('awarding_agency_name')}'")
        
        if len(filtered_items) == 0 and len(items) > 0:
            logger.warning(f"All {len(items)} items were filtered out. Sample filtered items: {json.dumps(list(filter_failures.values())[:3], default=str)}")
        
        # If we don't have enough filtered results, continue querying with pagination (only for queries, not scans)
        if len(filtered_items) < limit and method == 'query' and index_name and 'initial_last_eval_key' in locals() and initial_last_eval_key:
            logger.info(f"Only found {len(filtered_items)} matching items, need {limit}. Continuing query with pagination...")
            max_pagination_rounds = 10  # Limit pagination to avoid infinite loops
            pagination_round = 0
            current_last_eval_key = initial_last_eval_key
            
            while len(filtered_items) < limit and pagination_round < max_pagination_rounds:
                pagination_round += 1
                
                # Continue querying from where we left off
                continuation_params = params.copy()
                continuation_params['ExclusiveStartKey'] = current_last_eval_key
                continuation_params['Limit'] = query_limit
                
                try:
                    continuation_response = awards_table.query(**continuation_params)
                    continuation_gsi_items = continuation_response.get('Items', [])
                    current_last_eval_key = continuation_response.get('LastEvaluatedKey')
                    
                    if not continuation_gsi_items:
                        logger.info(f"No more items in GSI, stopping pagination")
                        break
                    
                    logger.info(f"Pagination round {pagination_round}: Found {len(continuation_gsi_items)} more items from GSI")
                    
                    # Extract award_ids
                    continuation_award_ids = [item.get('award_id') for item in continuation_gsi_items if item.get('award_id')]
                    
                    # Fetch full items
                    continuation_items = []
                    if continuation_award_ids:
                        batch_size = 100
                        for i in range(0, len(continuation_award_ids), batch_size):
                            batch_ids = continuation_award_ids[i:i + batch_size]
                            dynamodb_client = boto3.client('dynamodb')
                            request_items = {
                                AWARDS_TABLE_NAME: {
                                    'Keys': [{'award_id': {'S': str(aid)}} for aid in batch_ids]
                                }
                            }
                            batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                            batch_items = batch_response.get('Responses', {}).get(AWARDS_TABLE_NAME, [])
                            deserializer = TypeDeserializer()
                            for item in batch_items:
                                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                                continuation_items.append(converted_item)
                    
                    logger.info(f"Fetched {len(continuation_items)} full items for pagination round {pagination_round}")
                    
                    # Apply filters to continuation items
                    for item in continuation_items:
                        if apply_python_filter(item, filter_filters):
                            filtered_items.append(item)
                            if len(filtered_items) >= limit:
                                break
                    
                    logger.info(f"Pagination round {pagination_round}: Found {len(filtered_items)} total matching items so far")
                    
                    if not current_last_eval_key or len(filtered_items) >= limit:
                        break
                        
                except Exception as e:
                    logger.error(f"Error in pagination round {pagination_round}: {str(e)}", exc_info=True)
                    break
        
        items = filtered_items
        logger.info(f"Filtered to {len(items)} items matching all criteria")
    
    # Limit results to requested limit
    items = items[:limit]
    
    # Convert Decimal to float and bytes for JSON serialization
    results = [convert_decimal_to_float(item) for item in items]
    
    # Enrich results - handle transactions/subawards and oversized items
    enriched_results = []
    s3_fetch_success_count = 0
    s3_fetch_fail_count = 0
    for award in results:
        # Check if this is an oversized item (full details in S3)
        oversize_s3_key = award.get('oversize_s3_key')
        if oversize_s3_key:
            # Fetch full award details from S3
            full_award = fetch_oversized_award_from_s3(oversize_s3_key)
            if full_award:
                # Replace award with full details from S3
                award = convert_decimal_to_float(full_award)
                s3_fetch_success_count += 1
            else:
                s3_fetch_fail_count += 1
        
        # Transactions and subawards are now stored directly in the table
        # Ensure they exist (may be None or missing)
        if 'transactions' not in award or award.get('transactions') is None:
                award['transactions'] = []
        if 'subawards' not in award or award.get('subawards') is None:
                award['subawards'] = []
        
        # Parse is_assistance binary byte if present (should already be converted by convert_decimal_to_float)
        # is_assistance: b'\x01' = True (assistance), b'\x00' = False (contract)
        # This is a safety check in case conversion didn't happen
        if 'is_assistance' in award:
            is_assistance_val = award['is_assistance']
            if isinstance(is_assistance_val, bytes):
                award['is_assistance'] = bool(is_assistance_val[0]) if len(is_assistance_val) > 0 else False
            elif isinstance(is_assistance_val, int):
                award['is_assistance'] = bool(is_assistance_val)
            # If it's already bool, leave it as is
        
        # Calculate combined obligated amount from transactions for IDVs or when total_obligated_amount is 0
        # This helps display the actual obligated amounts for IDVs which have obligations on child awards
        if award.get('transactions') and isinstance(award['transactions'], list):
            combined_obligated = 0.0
            for transaction in award['transactions']:
                if isinstance(transaction, dict):
                    # Try different possible field names for obligation amount
                    obligation = transaction.get('federal_action_obligation') or \
                                transaction.get('total_obligated_amount') or \
                                transaction.get('obligated_amount') or 0
                    try:
                        if isinstance(obligation, (int, float)):
                            combined_obligated += float(obligation)
                        elif isinstance(obligation, str):
                            combined_obligated += float(obligation)
                    except (ValueError, TypeError):
                        pass
            
            # Only set combined_obligated_amount if we calculated a non-zero value
            # and the award's total_obligated_amount is 0 or missing (common for IDVs)
            if combined_obligated > 0 and (not award.get('total_obligated_amount') or award.get('total_obligated_amount') == 0):
                award['combined_obligated_amount'] = combined_obligated
        
        # Fetch child award details for IDV parents
        if award.get('is_idv_parent') and award.get('child_awards'):
            child_award_ids = award.get('child_awards', [])
            if isinstance(child_award_ids, list) and len(child_award_ids) > 0:
                logger.info(f"Fetching details for {len(child_award_ids)} child awards for IDV {award.get('award_id')}")
                child_awards_details = []
                for child_id in child_award_ids:
                    try:
                        # Get child award from DynamoDB
                        child_response = awards_table.get_item(Key={'award_id': str(child_id)})
                        if 'Item' in child_response:
                            child_item = child_response['Item']
                            # Convert to JSON-serializable format
                            child_item = convert_decimal_to_float(child_item)
                            
                            # Extract top-level fields for display
                            child_summary = {
                                'award_id': child_item.get('award_id'),
                                'award_id_piid': child_item.get('award_id_piid'),
                                'description': child_item.get('description'),
                                'total_obligated_amount': child_item.get('total_obligated_amount'),
                                'period_of_performance_start_date': child_item.get('period_of_performance_start_date') or child_item.get('period_start_date'),
                                'period_of_performance_current_end_date': child_item.get('period_of_performance_current_end_date') or child_item.get('period_end_date'),
                                'transaction_count': child_item.get('transaction_count', 0),
                                'subaward_count': child_item.get('subaward_count', 0),
                                'award_type': child_item.get('award_type'),
                                'award_type_description': child_item.get('award_type_description'),
                                'recipient_name': child_item.get('recipient_name'),
                                'awarding_agency_name': child_item.get('awarding_agency_name'),
                                'parent_idv_id': child_item.get('parent_idv_id'),  # Include parent ID for navigation
                                'is_idv_child': child_item.get('is_idv_child', False),
                            }
                            child_awards_details.append(child_summary)
                        else:
                            logger.warning(f"Child award {child_id} not found in DynamoDB")
                    except Exception as e:
                        logger.error(f"Error fetching child award {child_id}: {str(e)}")
                        continue
                
                award['child_awards_details'] = child_awards_details
                logger.info(f"Added {len(child_awards_details)} child award details for IDV {award.get('award_id')}")
        
        enriched_results.append(award)
    
    # Log enrichment results
    if enriched_results:
        logger.info(f"Enriched {len(enriched_results)} award(s). S3 fetch: {s3_fetch_success_count} success, {s3_fetch_fail_count} failed")
    
    # Convert last_evaluated_key to JSON-serializable format
    # DynamoDB LastEvaluatedKey may contain Decimal types and other DynamoDB-specific types
    serializable_last_key = None
    if last_eval_key:
        try:
            serializable_last_key = convert_decimal_to_float(last_eval_key)
        except Exception as e:
            logger.warning(f"Error converting last_evaluated_key to serializable format: {e}")
            serializable_last_key = None
    
    return {
        'success': True,
        'results': enriched_results,
        'count': len(enriched_results),
        'has_more': last_eval_key is not None,
        'last_evaluated_key': serializable_last_key,
        'method': method,
        'index_used': index_name
    }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler for searching awards
    
    Handles both:
    1. API Gateway events (direct invocation)
    2. SQS events (from wrapper Lambda when worker is at concurrency)
    
    Expected event structure (API Gateway AWS_PROXY):
    {
        "httpMethod": "POST",
        "body": "{\"filters\": {...}, \"limit\": 100}"
    }
    
    Expected event structure (SQS):
    {
        "Records": [{
            "eventSource": "aws:sqs",
            "body": "{\"request_id\": \"...\", \"job_id\": \"...\", \"api_gateway_event\": {...}}"
        }]
    }
    """
    # Track if this is from SQS (for completion notification)
    is_sqs_event = False
    job_id = None
    request_id = None
    completion_sns_topic = os.environ.get('USASPENDING_SEARCH_COMPLETION_SNS_TOPIC_ARN')
    
    # Handle SQS events (from wrapper Lambda when worker is at concurrency)
    if 'Records' in event and isinstance(event.get('Records'), list) and len(event.get('Records', [])) > 0:
        first_record = event['Records'][0]
        if first_record.get('eventSource') == 'aws:sqs':
            is_sqs_event = True
            logger.info("📬 SQS EVENT DETECTED - Processing queued request")
            try:
                # Parse SQS message body
                message_body_str = first_record.get('body', '{}')
                message_body = json.loads(message_body_str) if isinstance(message_body_str, str) else message_body_str
                
                # Extract job_id, request_id, and API Gateway event
                job_id = message_body.get('job_id')
                request_id = message_body.get('request_id')
                api_gateway_event = message_body.get('api_gateway_event', {})
                
                logger.info(f"📬 Processing SQS message - job_id: {job_id}, request_id: {request_id}")
                
                # Replace event with API Gateway event for processing
                event = api_gateway_event
                
            except Exception as e:
                logger.error(f"❌ Error parsing SQS message: {e}", exc_info=True)
                return {
                    'statusCode': 500,
                    'body': json.dumps({'error': f'Failed to parse SQS message: {str(e)}'})
                }
    
    try:
        headers = get_cors_headers()
        
        # Handle CORS preflight
        if event.get('httpMethod') == 'OPTIONS':
            return {
                'statusCode': 200,
                'headers': headers,
                'body': json.dumps({'message': 'CORS pre-flight response'})
            }
        
        # Parse request
        if event.get('httpMethod'):
            # API Gateway event
            try:
                body = json.loads(event.get('body', '{}'))
            except json.JSONDecodeError:
                body = {}
            
            # Also check query parameters
            query_params = event.get('queryStringParameters') or {}
            if query_params:
                body.update(query_params)
        else:
            # Direct Lambda invocation
            body = event
        
        # Extract parameters
        filters = body.get('filters', {})
        limit = int(body.get('limit', 100))
        last_evaluated_key = body.get('last_evaluated_key')
        
        # Validate limit
        if limit > 1000:
            limit = 1000  # Cap at 1000
        if limit < 1:
            limit = 100
        
        logger.info(f"Searching awards with filters: {json.dumps(filters, default=str)}, limit: {limit}")
        
        # Search awards
        result = search_awards(filters, limit=limit, last_evaluated_key=last_evaluated_key)
        
        # Log final results
        result_count = result.get('count', 0)
        if result_count > 0:
            logger.info(f"Search completed successfully: {result_count} award(s) returned (method: {result.get('method', 'unknown')}, index: {result.get('index_used', 'none')}, has_more: {result.get('has_more', False)})")
        else:
            logger.info(f"Search completed: No awards found matching the filters")
        
        # Ensure result is fully JSON-serializable (convert any remaining bytes, Decimals, etc.)
        def json_serializer(obj):
            """Custom JSON serializer for types that json.dumps doesn't handle"""
            # Handle DynamoDB Binary type
            try:
                from boto3.dynamodb.types import Binary
                if isinstance(obj, Binary):
                    # Extract bytes and convert
                    bytes_val = obj.value
                    if len(bytes_val) == 1:
                        return bool(bytes_val[0])
                    else:
                        import base64
                        return base64.b64encode(bytes_val).decode('utf-8')
            except ImportError:
                pass
            
            if isinstance(obj, bytes):
                # Convert bytes to base64 string
                import base64
                if len(obj) == 1:
                    return bool(obj[0])
                else:
                    return base64.b64encode(obj).decode('utf-8')
            elif isinstance(obj, Decimal):
                return float(obj)
            elif isinstance(obj, (set, frozenset)):
                return list(obj)
            raise TypeError(f"Type {type(obj)} not serializable")
        
        # If this was from SQS, publish completion notification
        if is_sqs_event and job_id and completion_sns_topic:
            try:
                sns_client = boto3.client('sns')
                completion_message = {
                    'request_id': request_id,
                    'job_id': job_id,
                    'statusCode': 200,
                    'body': result,
                    'status': 'completed'
                }
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps(completion_message, default=json_serializer),
                    Subject=f'USAspending Search Completion: {job_id}',
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': request_id
                        },
                        'job_id': {
                            'DataType': 'String',
                            'StringValue': job_id
                        }
                    }
                )
                logger.info(f"Published completion notification for job {job_id}")
            except Exception as e:
                logger.error(f"Error publishing completion notification: {e}", exc_info=True)
        
        # For SQS events, return simple acknowledgment (results sent via SNS)
        if is_sqs_event:
            return {
                'statusCode': 200,
                'body': json.dumps({'message': 'Processed from SQS', 'job_id': job_id})
            }
        
        # For direct API Gateway calls, return full response
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(result, default=json_serializer)
        }
        
    except Exception as e:
        logger.error(f"Error processing search request: {str(e)}", exc_info=True)
        
        # If this was from SQS, publish failure notification
        if is_sqs_event and job_id and completion_sns_topic:
            try:
                sns_client = boto3.client('sns')
                failure_message = {
                    'request_id': request_id,
                    'job_id': job_id,
                    'statusCode': 500,
                    'body': {'error': 'Internal server error', 'message': str(e)},
                    'status': 'failed'
                }
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps(failure_message),
                    Subject=f'USAspending Search Failure: {job_id}',
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': request_id
                        },
                        'job_id': {
                            'DataType': 'String',
                            'StringValue': job_id
                        }
                    }
                )
                logger.info(f"Published failure notification for job {job_id}")
            except Exception as e2:
                logger.error(f"Error publishing failure notification: {e2}", exc_info=True)
        
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }

