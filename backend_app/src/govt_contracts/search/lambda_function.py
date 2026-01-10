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
from datetime import datetime
from boto3.dynamodb.conditions import Key, Attr
from boto3.dynamodb.types import TypeDeserializer
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

# Get DynamoDB table
awards_table = dynamodb.Table(AWARDS_TABLE_NAME) if AWARDS_TABLE_NAME else None


def build_cors_headers(origin: str = None):
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        **get_cors_headers(origin),
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
    
    if filters.get('recipient_zip_code'):
        zip_codes = filters['recipient_zip_code'] if isinstance(filters['recipient_zip_code'], list) else [filters['recipient_zip_code']]
        item_zip = item.get('recipient_zip_code')
        if not item_zip or item_zip not in zip_codes:
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
    
    # Simplified date filter: date_year maps to fiscal_year
    # Fiscal year is already handled by GSI queries, so we just verify it matches
    if filters.get('date_year'):
        item_fy = item.get('fiscal_year')
        filter_fy = int(filters['date_year'])  # date_year maps directly to fiscal_year
        if not item_fy or item_fy != filter_fy:
            logger.debug(f"Date filter failed: item fiscal_year='{item_fy}' doesn't match date_year={filter_fy}, award_id={item.get('award_id', 'unknown')}")
            return False
    
    # Legacy date filters (deprecated, but keep for backward compatibility)
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
        # For date_to, we should check period_end_date (when the period ends)
        # This matches the PeriodEndDateIndex GSI which uses period_end_date
        item_date = item.get('period_end_date') or item.get('period_of_performance_end_date', '')
        if not item_date:
            logger.debug(f"Date to filter failed: item has no period_end_date, award_id={item.get('award_id', 'unknown')}")
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
    
    if filters.get('recipient_zip_code'):
        zip_codes = filters['recipient_zip_code'] if isinstance(filters['recipient_zip_code'], list) else [filters['recipient_zip_code']]
        if len(zip_codes) == 1:
            conditions.append(Attr('recipient_zip_code').eq(zip_codes[0]))
        else:
            conditions.append(Attr('recipient_zip_code').is_in(zip_codes))
    
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
    
    # Date filter: date_year maps to fiscal_year (handled by GSI, no Python filter needed)
    
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
    
    # AwardingAgencyNameFiscalYearIndex: hash_key=awarding_agency_name, range_key=fiscal_year
    # Only use this if awarding_agency_code is not provided (code takes precedence)
    if not filters.get('awarding_agency_code') and filters.get('awarding_agency_name'):
        values = filters['awarding_agency_name'] if isinstance(filters['awarding_agency_name'], list) else [filters['awarding_agency_name']]
        # Filter out empty strings
        values = [v for v in values if v and str(v).strip()]
        if values:
            # Use first agency name for hash key (exact match required for GSI hash key)
            agency_name = values[0].strip()
            fiscal_year = None
            if filters.get('fiscal_year'):
                fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                if fiscal_years:
                    fiscal_year = fiscal_years[0]
            
            key_condition = {
                'hash_key': ('awarding_agency_name', agency_name),
                'range_key': ('fiscal_year', fiscal_year) if fiscal_year else None
            }
            return ('query', 'AwardingAgencyNameFiscalYearIndex', key_condition)
    
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
    
    # ZipCodeFiscalYearIndex: hash_key=recipient_zip_code, range_key=fiscal_year
    if filters.get('recipient_zip_code') and filters.get('fiscal_year'):
        zip_code = filters['recipient_zip_code']
        if isinstance(zip_code, list):
            zip_code = zip_code[0]  # Use first zip code for hash key
        fiscal_year = filters['fiscal_year']
        if isinstance(fiscal_year, list):
            fiscal_year = fiscal_year[0]  # Use first fiscal year for range key
        
        key_condition = {
            'hash_key': ('recipient_zip_code', zip_code),
            'range_key': ('fiscal_year', fiscal_year)
        }
        return ('query', 'ZipCodeFiscalYearIndex', key_condition)
    
    # ZipCodeFiscalYearIndex with just zip_code (no fiscal_year filter)
    if filters.get('recipient_zip_code') and not filters.get('fiscal_year'):
        zip_code = filters['recipient_zip_code']
        if isinstance(zip_code, list):
            zip_code = zip_code[0]
        
        key_condition = {
            'hash_key': ('recipient_zip_code', zip_code),
            'range_key': None  # No range key filter
        }
        return ('query', 'ZipCodeFiscalYearIndex', key_condition)
    
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
    
    # Convert date_year to fiscal_year FIRST, before processing other filters
    # This ensures that GSIs with fiscal_year as range key can use it
    if filters.get('date_year') and not filters.get('fiscal_year'):
        try:
            fiscal_year = int(filters['date_year'])
            filters['fiscal_year'] = fiscal_year
            logger.info(f"Converted date_year={filters['date_year']} to fiscal_year={fiscal_year}")
        except (ValueError, TypeError) as e:
            logger.warning(f"Error parsing date_year: {e}")
    
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
    
    # AwardingAgencyNameFiscalYearIndex: hash_key=awarding_agency_name, range_key=fiscal_year
    # Only use this if awarding_agency_code is not provided (code takes precedence)
    if not filters.get('awarding_agency_code') and filters.get('awarding_agency_name'):
        values = filters['awarding_agency_name'] if isinstance(filters['awarding_agency_name'], list) else [filters['awarding_agency_name']]
        values = [v for v in values if v and str(v).strip()]
        if values:
            # Use first agency name for hash key (exact match required for GSI hash key)
            # Note: GSI hash keys require exact match, so partial matches won't work via GSI
            # For partial matches, the scan path will be used
            agency_name = values[0].strip()
            fiscal_year = None
            if filters.get('fiscal_year'):
                fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                if fiscal_years:
                    fiscal_year = fiscal_years[0]
            
            query_configs.append({
                'filter_key': 'awarding_agency_name',
                'index_name': 'AwardingAgencyNameFiscalYearIndex',
                'hash_key': 'awarding_agency_name',
                'hash_value': agency_name,
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
    
    # ZipCodeFiscalYearIndex: hash_key=recipient_zip_code, range_key=fiscal_year
    if filters.get('recipient_zip_code'):
        zip_codes = filters['recipient_zip_code'] if isinstance(filters['recipient_zip_code'], list) else [filters['recipient_zip_code']]
        zip_codes = [z for z in zip_codes if z and str(z).strip()]  # Filter out empty strings
        if zip_codes:
            zip_code = zip_codes[0]  # Use first zip code for hash key (multi-value handled via union in multi-GSI path)
            fiscal_year = None
            if filters.get('fiscal_year'):
                fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
                if fiscal_years:
                    fiscal_year = fiscal_years[0]
            
            query_configs.append({
                'filter_key': 'recipient_zip_code',
                'index_name': 'ZipCodeFiscalYearIndex',
                'hash_key': 'recipient_zip_code',
                'hash_value': zip_code,
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
    
    # FiscalYearObligationIndex: Only use when we have fiscal_year but no other GSI hash keys
    # OR when we have fiscal_year + obligation filters (need obligation range key)
    # If we have other GSIs that can use fiscal_year as range key, they should handle it
    has_other_gsi_hash_keys = any([
        filters.get('awarding_agency_code'),
        filters.get('awarding_agency_name'),
        filters.get('recipient_name'),
        filters.get('recipient_location_state'),
        filters.get('recipient_zip_code'),
        filters.get('award_type'),
    ])
    
    if filters.get('fiscal_year'):
        fiscal_years = filters['fiscal_year'] if isinstance(filters['fiscal_year'], list) else [filters['fiscal_year']]
        if fiscal_years:
            fiscal_year = fiscal_years[0]
            
            # Only create FiscalYearObligationIndex query if:
            # 1. We have obligation filters (need the obligation range key), OR
            # 2. We don't have any other GSI hash keys (simple fiscal year query)
            has_obligation_filter = filters.get('min_obligation') is not None or filters.get('max_obligation') is not None
            
            if has_obligation_filter:
                # Use FiscalYearObligationIndex with obligation range key
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
            elif not has_other_gsi_hash_keys:
                # Simple fiscal year query with no other filters - use FiscalYearObligationIndex
                query_configs.append({
                    'filter_key': 'fiscal_year',
                    'index_name': 'FiscalYearObligationIndex',
                    'hash_key': 'fiscal_year',
                    'hash_value': fiscal_year,
                    'range_key': None,  # No range filter - get all items for this fiscal year
                    'range_value': None,
                    'range_condition': None
                })
    
    return query_configs


def get_single_award(award_id: str) -> Dict[str, Any]:
    """
    Get a single award by award_id (for direct lookups after enrichment)
    
    Args:
        award_id: The award ID to fetch
    
    Returns:
        Dictionary with success, result, count, and error fields
    """
    try:
        logger.info(f"Fetching single award: {award_id}")
        
        # Get award from DynamoDB
        response = awards_table.get_item(Key={'award_id': award_id})
        
        if 'Item' not in response:
            logger.warning(f"Award {award_id} not found in DynamoDB")
            return {
                'success': False,
                'error': f'Award {award_id} not found',
                'count': 0,
                'results': []
            }
        
        award = response['Item']
        
        # Check if this is an oversized award (stored in S3)
        oversize_s3_key = award.get('oversize_s3_key')
        if oversize_s3_key:
            logger.info(f"Fetching full award data from S3 for oversized award {award_id}")
            full_award = fetch_oversized_award_from_s3(oversize_s3_key)
            if full_award:
                # Merge S3 data with DynamoDB GSI fields (S3 data takes precedence)
                full_award.update(award)
                award = full_award
            else:
                logger.warning(f"Failed to fetch from S3 for {award_id}, using DynamoDB data only")
        
        # Convert Decimal and bytes to JSON-serializable types
        award = convert_decimal_to_float(award)
        
        # Check if this is an IDV and fetch child awards
        child_award_ids = award.get('child_awards', [])
        if isinstance(child_award_ids, list) and len(child_award_ids) > 0:
            logger.info(f"Fetching details for {len(child_award_ids)} child awards for IDV {award.get('award_id')}")
            child_awards_details = []
            
            for child_id in child_award_ids:
                try:
                    child_response = awards_table.get_item(Key={'award_id': str(child_id)})
                    if 'Item' in child_response:
                        child_item = child_response['Item']
                        
                        # Check if child award is oversized
                        child_oversize_s3_key = child_item.get('oversize_s3_key')
                        if child_oversize_s3_key:
                            full_child = fetch_oversized_award_from_s3(child_oversize_s3_key)
                            if full_child:
                                full_child.update(child_item)
                                child_item = full_child
                        
                        # Convert to JSON-serializable
                        child_item = convert_decimal_to_float(child_item)
                        
                        child_awards_details.append({
                            'award_id': child_item.get('award_id'),
                            'award_id_piid': child_item.get('award_id_piid'),
                            'description': child_item.get('description'),
                            'total_obligated_amount': child_item.get('total_obligated_amount'),
                            'period_of_performance_start_date': child_item.get('period_of_performance_start_date'),
                            'period_of_performance_current_end_date': child_item.get('period_of_performance_current_end_date'),
                            'award_type': child_item.get('award_type'),
                            'award_type_description': child_item.get('award_type_description'),
                            'transaction_count': child_item.get('transaction_count', 0),
                            'subaward_count': child_item.get('subaward_count', 0),
                        })
                except Exception as e:
                    logger.warning(f"Error fetching child award {child_id}: {str(e)}")
                    continue
            
            if child_awards_details:
                award['child_awards_details'] = child_awards_details
                logger.info(f"Added {len(child_awards_details)} child award details for IDV {award.get('award_id')}")
        
        return {
            'success': True,
            'result': award,
            'count': 1,
            'results': [award]
        }
        
    except Exception as e:
        logger.error(f"Error fetching single award {award_id}: {str(e)}", exc_info=True)
        return {
            'success': False,
            'error': f'Error fetching award: {str(e)}',
            'count': 0,
            'results': []
        }


def search_by_obligation_range(table, filters: Dict[str, Any], max_results: int = 1000) -> List[Dict[str, Any]]:
    """
    Search for awards by obligation range using GSI queries for multiple fiscal years.
    This is more efficient than scanning the entire table.
    
    For obligation-only searches (without fiscal_year), we query multiple fiscal years
    using FiscalYearObligationIndex with the obligation range as the range key condition.
    
    Args:
        table: DynamoDB table resource
        filters: Filters including min_obligation and/or max_obligation
        max_results: Maximum number of results to return
    
    Returns:
        List of deduplicated award records
    """
    all_results = []
    seen_award_ids = set()
    
    min_obligation = filters.get('min_obligation')
    max_obligation = filters.get('max_obligation')
    
    if min_obligation is None and max_obligation is None:
        logger.warning("⚠️ search_by_obligation_range called without obligation filters")
        return []
    
    # Query recent fiscal years (start with most recent 5 years, expand if needed)
    # Query in reverse order (most recent first) since recent years are more likely to have larger obligations
    current_year = datetime.now().year
    # Start with most recent 5 years, we can expand if needed
    fiscal_years_to_query = list(range(current_year, current_year - 5, -1))  # Reverse order: 2025, 2024, ..., 2021
    
    logger.info(f"💰 Querying {len(fiscal_years_to_query)} fiscal years ({fiscal_years_to_query[-1]}-{fiscal_years_to_query[0]}) for obligation range")
    
    # Build range key condition for obligation
    from decimal import Decimal
    
    # Query each fiscal year (stop early if we have enough results)
    for fiscal_year in fiscal_years_to_query:
        # Early exit if we already have enough results
        if len(all_results) >= max_results:
            logger.info(f"🛑 Stopping fiscal year queries - already have {len(all_results)} results")
            break
        try:
            # Build key condition with obligation range
            # Note: FiscalYearObligationIndex uses total_obligated_amount as the range key
            key_condition = Key('fiscal_year').eq(fiscal_year)
            
            if min_obligation is not None and max_obligation is not None:
                key_condition = key_condition & Key('total_obligated_amount').between(
                    Decimal(str(min_obligation)), 
                    Decimal(str(max_obligation))
                )
            elif min_obligation is not None:
                key_condition = key_condition & Key('total_obligated_amount').gte(Decimal(str(min_obligation)))
            elif max_obligation is not None:
                key_condition = key_condition & Key('total_obligated_amount').lte(Decimal(str(max_obligation)))
            
            # Calculate how many more results we need
            remaining_needed = max_results - len(all_results)
            if remaining_needed <= 0:
                break
            
            # Query enough items to get good distribution across the obligation range
            # Since we're querying in descending order, we need to fetch more to get items across the full range
            # For range queries (min and max), fetch more to ensure we get distribution
            if min_obligation is not None and max_obligation is not None:
                # For range queries, fetch more items to get better distribution
                query_limit = min(remaining_needed + 200, 1000)  # Larger buffer for range queries
            else:
                # For single-bound queries, smaller buffer is fine
                query_limit = min(remaining_needed + 50, 500)
            
            query_kwargs = {
                'IndexName': 'FiscalYearObligationIndex',
                'KeyConditionExpression': key_condition,
                'Limit': query_limit,
                'ScanIndexForward': False  # Descending order (largest obligations first)
            }
            
            response = table.query(**query_kwargs)
            gsi_items = response.get('Items', [])
            
            # Extract award_ids from GSI results (GSI may be KEYS_ONLY)
            # Only extract as many as we need (recalculate in case we got more items than needed)
            remaining_needed = max_results - len(all_results)
            if remaining_needed <= 0:
                break
                
            award_ids_batch = []
            for item in gsi_items:
                if len(award_ids_batch) >= remaining_needed:
                    break
                award_id = item.get('award_id')
                if award_id and award_id not in seen_award_ids:
                    seen_award_ids.add(award_id)
                    award_ids_batch.append(award_id)
            
            # Fetch full items using BatchGetItem if we have award_ids
            if award_ids_batch:
                batch_size = 100
                for i in range(0, len(award_ids_batch), batch_size):
                    # Check if we still need more results before fetching this batch
                    if len(all_results) >= max_results:
                        break
                        
                    batch_ids = award_ids_batch[i:i + batch_size]
                    try:
                        dynamodb_client = boto3.client('dynamodb')
                        request_items = {
                            AWARDS_TABLE_NAME: {
                                'Keys': [{'award_id': {'S': str(aid)}} for aid in batch_ids]
                            }
                        }
                        batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                        batch_items = batch_response.get('Responses', {}).get(AWARDS_TABLE_NAME, [])
                        
                        # Convert DynamoDB format to Python dict using TypeDeserializer
                        deserializer = TypeDeserializer()
                        for item in batch_items:
                            converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                            all_results.append(converted_item)
                            
                            # Stop immediately if we've reached max results
                            if len(all_results) >= max_results:
                                logger.info(f"🛑 Reached maximum results limit: {max_results}")
                                break
                    except Exception as e:
                        logger.warning(f"⚠️ Error fetching full items for fiscal year {fiscal_year}: {e}")
                        continue
            
            # Check again after fetching items
            if len(all_results) >= max_results:
                logger.info(f"🛑 Stopping fiscal year queries - have {len(all_results)} results")
                break
                
        except Exception as e:
            logger.warning(f"⚠️ Error querying fiscal year {fiscal_year}: {e}")
            continue
    
    logger.info(f"✅ Obligation range search complete: {len(all_results)} total deduplicated results")
    return all_results


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
        last_evaluated_key: Pagination token from previous request
    
    Returns:
        Dictionary with search results and pagination info
    """
    if not awards_table:
        raise Exception("DynamoDB awards table not initialized")
    
    if last_evaluated_key:
        logger.info(f"search_awards: Received last_evaluated_key: {json.dumps(last_evaluated_key, default=str)}")
    else:
        logger.info(f"search_awards: No last_evaluated_key provided")
    
    # Check if this is an obligation-only search (no fiscal_year, no other GSI hash keys)
    has_obligation_filter = filters.get('min_obligation') is not None or filters.get('max_obligation') is not None
    has_fiscal_year = filters.get('fiscal_year') is not None
    has_other_gsi_hash_keys = any([
        filters.get('awarding_agency_code'),
        filters.get('recipient_location_state'),
        filters.get('recipient_name_normalized'),
        filters.get('naics_code'),
        filters.get('psc_code'),
        filters.get('recipient_zip_code'),  # recipient_zip_code is a GSI hash key (ZipCodeFiscalYearIndex)
    ])
    
    # If we have obligation filter but no fiscal_year and no other GSI hash keys, use efficient obligation range query
    if has_obligation_filter and not has_fiscal_year and not has_other_gsi_hash_keys:
        logger.info("✅ Obligation-only search detected, using efficient GSI fiscal-year-by-fiscal-year query approach")
        
        # Use the obligation range search approach
        # For range queries (both min and max), fetch more items to get better distribution across the range
        # When querying in descending order, limiting too much only returns items near the max
        if filters.get('min_obligation') is not None and filters.get('max_obligation') is not None:
            # Range query - fetch more to get distribution across the range
            fetch_limit = max(limit * 20, 1000)  # Fetch 20x the limit or at least 1000 for range queries
        else:
            # Single-bound query - smaller fetch is fine
            fetch_limit = max(limit * 5, 250)
        all_items = search_by_obligation_range(awards_table, filters, max_results=fetch_limit)
        
        # Sort by total_obligation descending (largest first), then by award_id for stability
        all_items.sort(key=lambda x: (
            float(x.get('total_obligation', 0) or x.get('total_obligated_amount', 0) or 0),
            x.get('award_id', '')
        ), reverse=True)
        
        # Apply cursor-based pagination if cursor provided
        if last_evaluated_key:
            # Find the position in the sorted list based on the cursor
            cursor_obligation = float(last_evaluated_key.get('total_obligation', 0) or 0)
            cursor_award_id = last_evaluated_key.get('award_id', '')
            
            # Find the index to start from
            start_index = 0
            for idx, item in enumerate(all_items):
                item_obligation = float(item.get('total_obligation', 0) or item.get('total_obligated_amount', 0) or 0)
                item_award_id = item.get('award_id', '')
                
                if item_obligation < cursor_obligation or (item_obligation == cursor_obligation and item_award_id <= cursor_award_id):
                    start_index = idx + 1
                    break
            
            all_items = all_items[start_index:]
        
        # Apply other filters (date ranges, etc.) in Python
        if all_items:
            other_filters = {k: v for k, v in filters.items() if k not in ['min_obligation', 'max_obligation']}
            if other_filters:
                filtered_items = [item for item in all_items if apply_python_filter(item, other_filters)]
                all_items = filtered_items
        
        # Limit results
        items = all_items[:limit]
        
        # Simplified pagination logic: Always allow pagination to continue if we have items to return.
        # The frontend will detect when there are no more results by seeing 0 items or the count stop increasing.
        has_more = len(items) > 0  # If we have items, allow frontend to continue paginating
        
        # Create a pagination key from the last item if we have items
        last_eval_key = None
        if items:
            last_item = items[-1]
            last_eval_key = {
                'award_id': last_item.get('award_id'),
                'total_obligation': last_item.get('total_obligation') or last_item.get('total_obligated_amount', 0)
            }
        
        # Convert Decimal to float and bytes for JSON serialization
        results = [convert_decimal_to_float(item) for item in items]
        
        # Enrich results - reuse the same enrichment logic from the normal flow below
        # For now, just return the results (enrichment will be handled in the normal flow if needed)
        # The items from GSI query are already full items (not KEYS_ONLY), so we can use them directly
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': has_more,
            'last_evaluated_key': convert_decimal_to_float(last_eval_key) if last_eval_key else None,
            'method': 'obligation_range_query',
            'index_used': 'FiscalYearObligationIndex'
        }
    
    # Identify which filters can use GSIs
    query_configs = identify_queryable_filters(filters)
    
    # Special case: If recipient_name has multiple values, always use multi-GSI intersection path
    # to handle union of all recipient names
    recipient_names = filters.get('recipient_name', [])
    has_multiple_recipient_names = isinstance(recipient_names, list) and len(recipient_names) > 1
    
    if has_multiple_recipient_names and len(query_configs) == 1 and query_configs[0]['filter_key'] == 'recipient_name':
        # Force multi-GSI intersection path by treating it as if there are multiple filters
        # The multi-value recipient_name handling will query each name and union results
        logger.info(f"Multiple recipient names detected ({len(recipient_names)}), using multi-GSI union approach")
        # The query_configs already has recipient_name, and the multi-value handling will process all names
    
    # If we have multiple queryable filters OR multiple recipient names, use intersection/union approach
    if len(query_configs) > 1 or (has_multiple_recipient_names and len(query_configs) == 1):
        logger.info(f"Using multi-GSI intersection approach with {len(query_configs)} GSIs")
        
        # Query each GSI to get initial batch of award_ids (to determine shortest list)
        gsi_results = {}
        
        # Process each query config
        for config in query_configs:
            # Special handling for recipient_name with multiple values - query each and union results
            if config['filter_key'] == 'recipient_name' and filters.get('recipient_name'):
                recipient_names = filters['recipient_name'] if isinstance(filters['recipient_name'], list) else [filters['recipient_name']]
                recipient_names = [n for n in recipient_names if n and str(n).strip()]
                
                if len(recipient_names) > 1:
                    logger.info(f"Querying {config['index_name']} for {len(recipient_names)} recipient names (union)")
                    all_award_ids = set()
                    all_configs = []
                    
                    # Query each recipient name separately and union the results
                    for recipient_name in recipient_names:
                        normalized_name = recipient_name.lower().strip()
                        logger.info(f"Querying {config['index_name']} for recipient_name={normalized_name}")
                        award_ids, _ = query_gsi_for_award_ids(
                            index_name=config['index_name'],
                            hash_key_name=config['hash_key'],
                            hash_key_value=normalized_name,
                            range_key_name=config.get('range_key'),
                            range_key_value=config.get('range_value'),
                            range_key_condition=config.get('range_condition'),
                            limit=1000,  # Get first batch
                            get_all=False
                        )
                        all_award_ids.update(award_ids)
                        # Store config for each recipient name for pagination
                        all_configs.append({
                            'config': {**config, 'hash_value': normalized_name},
                            'last_eval_key': None
                        })
                        logger.info(f"Found {len(award_ids)} award_ids for recipient_name={normalized_name}")
                    
                    logger.info(f"Union of all recipient names: {len(all_award_ids)} total unique award_ids")
                    gsi_results[config['filter_key']] = {
                        'award_ids': all_award_ids,
                        'config': config,  # Use original config as template
                        'all_configs': all_configs,  # Store individual configs for pagination
                        'total_count': len(all_award_ids),
                        'last_eval_key': None,
                        'is_multi_value': True  # Flag to indicate this needs special pagination handling
                    }
                    continue
            
            # Special handling for recipient_zip_code with multiple values - query each and union results
            if config['filter_key'] == 'recipient_zip_code' and filters.get('recipient_zip_code'):
                zip_codes = filters['recipient_zip_code'] if isinstance(filters['recipient_zip_code'], list) else [filters['recipient_zip_code']]
                zip_codes = [z for z in zip_codes if z and str(z).strip()]
                
                if len(zip_codes) > 1:
                    logger.info(f"Querying {config['index_name']} for {len(zip_codes)} zip codes (union)")
                    all_award_ids = set()
                    all_configs = []
                    
                    # Query each zip code separately and union the results
                    for zip_code in zip_codes:
                        zip_code_str = str(zip_code).strip()
                        logger.info(f"Querying {config['index_name']} for recipient_zip_code={zip_code_str}")
                        award_ids, _ = query_gsi_for_award_ids(
                            index_name=config['index_name'],
                            hash_key_name=config['hash_key'],
                            hash_key_value=zip_code_str,
                            range_key_name=config.get('range_key'),
                            range_key_value=config.get('range_value'),
                            range_key_condition=config.get('range_condition'),
                            limit=1000,  # Get first batch
                            get_all=False
                        )
                        all_award_ids.update(award_ids)
                        # Store config for each zip code for pagination
                        all_configs.append({
                            'config': {**config, 'hash_value': zip_code_str},
                            'last_eval_key': None
                        })
                        logger.info(f"Found {len(award_ids)} award_ids for recipient_zip_code={zip_code_str}")
                    
                    logger.info(f"Union of all zip codes: {len(all_award_ids)} total unique award_ids")
                    gsi_results[config['filter_key']] = {
                        'award_ids': all_award_ids,
                        'config': config,  # Use original config as template
                        'all_configs': all_configs,  # Store individual configs for pagination
                        'total_count': len(all_award_ids),
                        'last_eval_key': None,
                        'is_multi_value': True  # Flag to indicate this needs special pagination handling
                    }
                    continue
            
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
                'last_eval_key': None,  # Will be set during pagination
                'is_multi_value': False
            }
            logger.info(f"Found {len(award_ids)} award_ids from {config['index_name']} (first batch)")
        
        # Intersect all GSI results to get the final set of matching award_ids
        # This ensures we only fetch items that match ALL GSI filters
        all_gsi_keys = list(gsi_results.keys())
        if len(all_gsi_keys) > 1:
            # Start with the first GSI result
            intersection_ids = gsi_results[all_gsi_keys[0]]['award_ids'].copy()
            logger.info(f"Starting intersection with {all_gsi_keys[0]}: {len(intersection_ids)} award_ids")
            
            # Intersect with all other GSI results
            for key in all_gsi_keys[1:]:
                other_ids = gsi_results[key]['award_ids']
                intersection_ids = intersection_ids & other_ids
                logger.info(f"After intersecting with {key} ({len(other_ids)} IDs): {len(intersection_ids)} award_ids remain")
            
            # If intersection is empty, no items match all GSI filters - return early
            if len(intersection_ids) == 0:
                logger.info("Intersection of all GSI filters is empty - no items match all filters")
                return {
                    'awards': [],
                    'count': 0,
                    'has_more': False,
                    'last_evaluated_key': None,
                    'method': 'multi_gsi_intersection',
                    'index_used': f"{len(all_gsi_keys)}_GSIs"
                }
            
            # Use the shortest list as the source for pagination (most efficient)
            shortest_key = min(gsi_results.keys(), key=lambda k: len(gsi_results[k]['award_ids']))
            source_config = gsi_results[shortest_key]['config']
            source_award_ids = list(intersection_ids)  # Use the intersected set
            logger.info(f"Intersection complete: {len(source_award_ids)} award_ids match all GSI filters. Using {shortest_key} as source for pagination.")
        else:
            # Only one GSI result, use it directly
            shortest_key = all_gsi_keys[0]
            source_award_ids = list(gsi_results[shortest_key]['award_ids'])
            source_config = gsi_results[shortest_key]['config']
            logger.info(f"Using {shortest_key} as source of truth ({len(source_award_ids)} award_ids)")
        
        # Remove ALL GSI filters from remaining_filters since we've already applied them via GSI intersection
        # Keep only non-GSI filters (like obligation ranges) to apply in Python
        remaining_filters = filters.copy()
        
        # Remove all GSI-queryable filters that were used
        for gsi_key in gsi_results.keys():
            if gsi_key == 'awarding_agency_code':
                if 'awarding_agency_code' in remaining_filters:
                    del remaining_filters['awarding_agency_code']
                # Also remove awarding_agency_name if present (code takes precedence when using GSI)
                if 'awarding_agency_name' in remaining_filters:
                    del remaining_filters['awarding_agency_name']
            elif gsi_key == 'awarding_agency_name':
                if 'awarding_agency_name' in remaining_filters:
                    del remaining_filters['awarding_agency_name']
                # Also remove awarding_agency_code if present (name takes precedence in this case)
                if 'awarding_agency_code' in remaining_filters:
                    del remaining_filters['awarding_agency_code']
            elif gsi_key == 'recipient_name':
                if 'recipient_name' in remaining_filters:
                    del remaining_filters['recipient_name']
            elif gsi_key == 'recipient_location_state':
                if 'recipient_location_state' in remaining_filters:
                    del remaining_filters['recipient_location_state']
            elif gsi_key == 'recipient_zip_code':
                if 'recipient_zip_code' in remaining_filters:
                    del remaining_filters['recipient_zip_code']
            elif gsi_key == 'award_type':
                if 'award_type' in remaining_filters:
                    del remaining_filters['award_type']
            elif gsi_key == 'fiscal_year_obligation':
                if 'fiscal_year' in remaining_filters:
                    del remaining_filters['fiscal_year']
                if 'min_obligation' in remaining_filters:
                    del remaining_filters['min_obligation']
                if 'max_obligation' in remaining_filters:
                    del remaining_filters['max_obligation']
            elif gsi_key == 'fiscal_year_obligation':
                if 'fiscal_year' in remaining_filters:
                    del remaining_filters['fiscal_year']
                if 'min_obligation' in remaining_filters:
                    del remaining_filters['min_obligation']
                if 'max_obligation' in remaining_filters:
                    del remaining_filters['max_obligation']
        
        # Remove fiscal_year if it was set from date_year (not explicitly provided)
        if 'fiscal_year' in remaining_filters and filters.get('date_year') and not filters.get('fiscal_year'):
            # Fiscal year was set from date_year, remove it from remaining_filters since it's used in GSI
            del remaining_filters['fiscal_year']
        
        logger.info(f"Remaining filters to apply in Python: {list(remaining_filters.keys())}")
        
        # Paginate through source GSI until we have enough results or it runs out
        all_matching_items = []  # Store full items that match all filters
        source_last_eval_key = None
        max_pagination_rounds = 50  # Limit to avoid infinite loops
        pagination_round = 0
        
        # Special handling for multi-value recipient_name and recipient_zip_code queries
        source_result = gsi_results[shortest_key]
        is_multi_recipient = source_result.get('is_multi_value', False) and shortest_key == 'recipient_name'
        is_multi_zip = source_result.get('is_multi_value', False) and shortest_key == 'recipient_zip_code'
        
        if is_multi_recipient or is_multi_zip:
            # For multiple recipient names, zip codes, or date_to fiscal years, paginate through each one
            all_configs = source_result.get('all_configs', [])
            config_index = 0
            item_type = 'recipient' if is_multi_recipient else 'zip code'
            
            while len(all_matching_items) < limit and pagination_round < max_pagination_rounds:
                pagination_round += 1
                
                # Cycle through configs if we've exhausted one
                if config_index >= len(all_configs):
                    break  # All configs exhausted
                
                current_item_config = all_configs[config_index]
                current_config = current_item_config['config']
                current_last_eval_key = current_item_config.get('last_eval_key')
                
                # Query this item with pagination
                source_award_ids_batch, new_last_eval_key = query_gsi_for_award_ids(
                    index_name=current_config['index_name'],
                    hash_key_name=current_config['hash_key'],
                    hash_key_value=current_config['hash_value'],
                    range_key_name=current_config.get('range_key'),
                    range_key_value=current_config.get('range_value'),
                    range_key_condition=current_config.get('range_condition'),
                    limit=1000,
                    exclusive_start_key=current_last_eval_key,
                    get_all=False
                )
                
                # Update last eval key for this config
                current_item_config['last_eval_key'] = new_last_eval_key
                
                # If no more results for this config, move to next
                if not source_award_ids_batch:
                    config_index += 1
                    continue
                
                logger.info(f"Pagination round {pagination_round} ({item_type} {config_index + 1}/{len(all_configs)}): Got {len(source_award_ids_batch)} award_ids from source GSI")
                
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
                
                logger.info(f"Pagination round {pagination_round}: {len(all_matching_items)} items matched all filters (out of {len(items_batch)} fetched)")
                
                # Move to next config if this one is exhausted
                if not new_last_eval_key:
                    config_index += 1
                
                # Stop if we have enough results
                if len(all_matching_items) >= limit:
                    break
        else:
            # Normal single-value pagination
            # If we have multiple GSIs, we need to continue intersecting during pagination
            # Otherwise, we can just use the source GSI directly
            if len(all_gsi_keys) > 1:
                # Multiple GSIs: continue intersecting during pagination
                # First, use the intersection we already computed
                if source_award_ids:
                    # Use the first batch from the intersection
                    source_award_ids_batch = source_award_ids[:limit]
                    source_award_ids = source_award_ids[limit:]  # Keep remaining for next iteration
                    
                    logger.info(f"Pagination round 1: Using {len(source_award_ids_batch)} award_ids from intersection")
                    
                    # Fetch full items for this batch
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
                            all_matching_items.append(item)
                    
                    logger.info(f"Pagination round 1: {len(all_matching_items)} items matched all filters (out of {len(items_batch)} fetched)")
                
                # For subsequent batches, we'd need to continue querying both GSIs and intersecting
                # This is complex and may not be necessary if the first batch is sufficient
                # For now, we'll only use the first batch from the intersection
                # TODO: Implement full pagination for multi-GSI intersections
            else:
                # Single GSI: normal pagination
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
                    
                    # Fetch full items for this batch
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
        
        # Simplified pagination logic: Always allow pagination to continue if we have items to return.
        # The frontend will detect when there are no more results by seeing 0 items or the count stop increasing.
        has_more = len(enriched_results) > 0  # If we have items, allow frontend to continue paginating
        
        # Try to get a pagination key from the source GSI if available
        # This helps maintain proper pagination state across requests
        last_eval_key = None
        if is_multi_recipient or is_multi_zip:
            # For multi-value queries, check if any config still has more items
            all_configs = source_result.get('all_configs', [])
            for config_item in all_configs:
                if config_item.get('last_eval_key'):
                    # Use the last eval key from the current config being paginated
                    # For simplicity, use the first non-null last_eval_key
                    if not last_eval_key:
                        last_eval_key = config_item.get('last_eval_key')
                    break
        else:
            # For single-value queries, use source GSI's last eval key if available
            if source_last_eval_key:
                last_eval_key = source_last_eval_key
        
        # Convert last_eval_key to serializable format
        serializable_last_key = None
        if last_eval_key:
            try:
                serializable_last_key = convert_decimal_to_float(last_eval_key)
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key to serializable format: {e}")
                serializable_last_key = None
        
        # Return results for multi-GSI intersection
        return {
            'success': True,
            'results': enriched_results,
            'count': len(enriched_results),
            'has_more': has_more,
            'last_evaluated_key': serializable_last_key,
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
        if hash_key_name == 'awarding_agency_code':
            # Remove awarding_agency_code from filters since we're using it as hash key
            # Note: We can't filter for multiple agency codes/names when using GSI query
            # The first one is used for the hash key, others would need to be filtered client-side
            if 'awarding_agency_code' in filter_filters:
                del filter_filters['awarding_agency_code']
            # Also remove awarding_agency_name if present (code takes precedence)
            if 'awarding_agency_name' in filter_filters:
                del filter_filters['awarding_agency_name']
        elif hash_key_name == 'awarding_agency_name':
            # Remove awarding_agency_name from filters since we're using it as hash key
            if 'awarding_agency_name' in filter_filters:
                del filter_filters['awarding_agency_name']
            # Also remove awarding_agency_code if present (name takes precedence in this case)
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
        elif hash_key_name == 'recipient_zip_code':
            # Remove recipient_zip_code from filters since we're using it as hash key
            if 'recipient_zip_code' in filter_filters:
                del filter_filters['recipient_zip_code']
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
    
    # Initialize pagination variables
    initial_last_eval_key = None
    last_eval_key = None
    
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
        logger.info(f"Checking last_evaluated_key for pagination: {last_evaluated_key is not None}, hash_key_name: {hash_key_name}, index_name: {index_name}")
        if last_evaluated_key:
            # Ensure fiscal_year is an integer if present (DynamoDB expects integer for year range keys)
            if isinstance(last_evaluated_key, dict) and 'fiscal_year' in last_evaluated_key:
                fiscal_year_val = last_evaluated_key['fiscal_year']
                original_type = type(fiscal_year_val).__name__
                if isinstance(fiscal_year_val, float):
                    last_evaluated_key['fiscal_year'] = int(fiscal_year_val)
                    logger.info(f"Converted fiscal_year from float to int in pagination key: {fiscal_year_val} -> {last_evaluated_key['fiscal_year']}")
                elif isinstance(fiscal_year_val, str):
                    try:
                        last_evaluated_key['fiscal_year'] = int(float(fiscal_year_val))
                        logger.info(f"Converted fiscal_year from string to int in pagination key: {fiscal_year_val} -> {last_evaluated_key['fiscal_year']}")
                    except (ValueError, TypeError):
                        logger.warning(f"Could not convert fiscal_year from string to int: {fiscal_year_val}")
            try:
                # Validate that the last_evaluated_key has the correct structure for this GSI
                if isinstance(last_evaluated_key, dict):
                    # Check if the key has the required hash key for this GSI
                    # For GSI queries, LastEvaluatedKey should have the GSI's key structure
                    # It should include the hash_key_name and optionally the range_key_name
                    has_hash_key = hash_key_name in last_evaluated_key
                    
                    if key_condition.get('range_key'):
                        # We're using a range key in the query, so last_evaluated_key should have both
                        range_key_name = key_condition['range_key'][0]
                        has_range_key = range_key_name in last_evaluated_key
                        if has_hash_key and has_range_key:
                            params['ExclusiveStartKey'] = last_evaluated_key
                            logger.info(f"Using last_evaluated_key for pagination (with range key {range_key_name})")
                        else:
                            logger.warning(f"last_evaluated_key structure doesn't match GSI {index_name} (hash_key={hash_key_name}, range_key={range_key_name}), ignoring pagination. Key has: {list(last_evaluated_key.keys())}")
                    else:
                        # No range key in query condition, but GSI might still have a range key
                        # For GSIs with range keys, DynamoDB requires the range key in ExclusiveStartKey
                        # Check if this GSI has a range key by index name
                        gsi_has_range_key = False
                        gsi_range_key_name = None
                        if index_name == 'ZipCodeFiscalYearIndex':
                            gsi_has_range_key = True
                            gsi_range_key_name = 'fiscal_year'
                        elif index_name == 'RecipientNameFiscalYearIndex':
                            gsi_has_range_key = True
                            gsi_range_key_name = 'fiscal_year'
                        elif index_name == 'AgencyFiscalYearIndex':
                            gsi_has_range_key = True
                            gsi_range_key_name = 'fiscal_year'
                        elif index_name == 'AwardingAgencyNameFiscalYearIndex':
                            gsi_has_range_key = True
                            gsi_range_key_name = 'fiscal_year'
                        elif index_name == 'AwardingAgencyCodeFiscalYearIndex':
                            gsi_has_range_key = True
                            gsi_range_key_name = 'fiscal_year'
                        elif index_name == 'StateFiscalYearIndex':
                            gsi_has_range_key = True
                            gsi_range_key_name = 'fiscal_year'
                        elif index_name == 'AwardTypeFiscalYearIndex':
                            gsi_has_range_key = True
                            gsi_range_key_name = 'fiscal_year'
                        elif index_name == 'FiscalYearObligationIndex':
                            gsi_has_range_key = True
                            gsi_range_key_name = 'fiscal_year'
                        
                        if gsi_has_range_key:
                            # GSI has a range key, so last_evaluated_key must include it
                            has_range_key = gsi_range_key_name in last_evaluated_key
                            if has_hash_key and has_range_key:
                                params['ExclusiveStartKey'] = last_evaluated_key
                                logger.info(f"Using last_evaluated_key for pagination (GSI has range key {gsi_range_key_name})")
                            else:
                                logger.warning(f"last_evaluated_key missing required range key {gsi_range_key_name} for GSI {index_name}, ignoring pagination. Key has: {list(last_evaluated_key.keys())}")
                        else:
                            # No range key in GSI, just need hash key
                            if has_hash_key:
                                params['ExclusiveStartKey'] = last_evaluated_key
                                logger.info(f"Using last_evaluated_key for pagination (hash key only: {hash_key_name})")
                            else:
                                logger.warning(f"last_evaluated_key missing hash key {hash_key_name} for GSI {index_name}, ignoring pagination. Key has: {list(last_evaluated_key.keys())}")
                else:
                    logger.warning(f"last_evaluated_key is not a dict (type: {type(last_evaluated_key)}), ignoring pagination")
            except Exception as e:
                logger.warning(f"Error validating last_evaluated_key: {e}, ignoring pagination", exc_info=True)
        
        logger.info(f"Querying {index_name} with hash_key={hash_key_name}={hash_key_value}, Limit={params.get('Limit', 'default')}, ExclusiveStartKey: {params.get('ExclusiveStartKey') is not None}")
        response = awards_table.query(**params)
        
        # Store last_evaluated_key for potential pagination
        last_eval_key = response.get('LastEvaluatedKey')
        initial_last_eval_key = last_eval_key  # Store for pagination
        logger.info(f"Initial query returned {len(response.get('Items', []))} items, LastEvaluatedKey: {last_eval_key is not None}")
        if params.get('ExclusiveStartKey'):
            logger.info(f"Query used ExclusiveStartKey for pagination (continuing from previous page)")
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
    
    # For scans, we need to continue scanning until we have enough FILTERED results
    # This is different from queries - we need to fetch, filter, and check filtered count
    if method == 'scan' and scan_limit is not None:
        # For scans, we need to fetch items, apply filters, and continue until we have enough filtered results
        # This requires a different approach: scan -> fetch -> filter -> check -> repeat if needed
        max_continuation_scans = 20  # Increased limit for scans since filtering may reduce results significantly
        continuation_count = 0
        all_scanned_items = list(gsi_items)  # Keep track of all scanned items
        filtered_items_so_far = []  # Track filtered items across batches
        
        # First, fetch and filter the initial batch
        if gsi_items:
            # Extract award_ids from initial batch
            initial_award_ids = [item.get('award_id') for item in gsi_items if item.get('award_id')]
            
            # Fetch full items for initial batch
            if initial_award_ids:
                batch_size = 100
                initial_items = []
                for i in range(0, len(initial_award_ids), batch_size):
                    batch_ids = initial_award_ids[i:i + batch_size]
                    try:
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
                            initial_items.append(converted_item)
                    except Exception as e:
                        logger.error(f"Error fetching initial batch: {str(e)}", exc_info=True)
                        continue
                
                # Apply filters to initial batch
                if initial_items and filter_filters:
                    for item in initial_items:
                        if apply_python_filter(item, filter_filters):
                            filtered_items_so_far.append(item)
                elif initial_items:
                    # No filters, all items pass
                    filtered_items_so_far.extend(initial_items)
        
        # Continue scanning until we have enough filtered results
        while len(filtered_items_so_far) < limit and last_eval_key and continuation_count < max_continuation_scans:
            continuation_count += 1
            logger.info(f"Continuing scan (iteration {continuation_count}/{max_continuation_scans}), found {len(filtered_items_so_far)} filtered items so far (need {limit}), scanned {scanned_count} total items")
            
            # Continue scan from last evaluated key
            continuation_params = params.copy()
            continuation_params['ExclusiveStartKey'] = last_eval_key
            continuation_params['Limit'] = scan_limit
            
            continuation_response = awards_table.scan(**continuation_params)
            continuation_items = continuation_response.get('Items', [])
            last_eval_key = continuation_response.get('LastEvaluatedKey')
            scanned_count += continuation_response.get('ScannedCount', 0)
            
            all_scanned_items.extend(continuation_items)
            
            if not continuation_items:
                logger.info("No more items in scan, stopping")
                break
            
            # Fetch full items for this batch
            continuation_award_ids = [item.get('award_id') for item in continuation_items if item.get('award_id')]
            if continuation_award_ids:
                batch_size = 100
                continuation_full_items = []
                for i in range(0, len(continuation_award_ids), batch_size):
                    batch_ids = continuation_award_ids[i:i + batch_size]
                    try:
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
                            continuation_full_items.append(converted_item)
                    except Exception as e:
                        logger.error(f"Error fetching continuation batch: {str(e)}", exc_info=True)
                        continue
                
                # Apply filters to continuation batch
                if continuation_full_items and filter_filters:
                    for item in continuation_full_items:
                        if apply_python_filter(item, filter_filters):
                            filtered_items_so_far.append(item)
                            if len(filtered_items_so_far) >= limit:
                                break
                elif continuation_full_items:
                    # No filters, all items pass
                    filtered_items_so_far.extend(continuation_full_items)
            
            # Stop if we have enough filtered results or no more items
            if len(filtered_items_so_far) >= limit or not last_eval_key:
                break
        
        logger.info(f"Scan complete: found {len(filtered_items_so_far)} filtered items after scanning {scanned_count} total items")
        # Use filtered items directly, skip the normal fetch/filter flow
        items = filtered_items_so_far[:limit]  # Set items directly, will be used later
        # Preserve last_eval_key for pagination (from the last scan operation)
        # This will be used to determine has_more at the end
        # Skip the normal fetch/filter flow for scans since we already have filtered items
        skip_normal_fetch = True
        # Note: last_eval_key is already set from the last scan operation above
    else:
        # For queries, use normal flow
        skip_normal_fetch = False
    
    # Extract award_ids from GSI results (KEYS_ONLY projection only returns keys)
    # Also create a mapping from award_id to GSI item for pagination key creation
    award_ids = []
    gsi_item_map = {}  # Map award_id to GSI item (for pagination key creation)
    last_gsi_item = None  # Track last GSI item processed (in GSI order)
    for item in gsi_items:
        award_id = item.get('award_id')
        if award_id:
            award_ids.append(award_id)
            gsi_item_map[award_id] = item  # Store mapping for later use
            last_gsi_item = item  # Keep updating to last item in GSI order
    
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
    # Skip this for scans since we already have filtered items
    if not skip_normal_fetch:
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
    # Skip filtering for scans since items are already filtered
    if not skip_normal_fetch and items and filter_filters:
        if method == 'query':
            logger.info(f"Applying filters in Python to {len(items)} items (KEYS_ONLY GSI doesn't support FilterExpression)")
        elif method == 'scan':
            logger.info(f"Applying filters in Python to {len(items)} items from scan (some filters like awarding_agency_name not in FilterExpression)")
        logger.debug(f"Filter criteria: {json.dumps(filter_filters, default=str)}")
        filtered_items = []
        filter_failures = {}
        # Create a mapping from award_id to its position in award_ids (GSI order)
        # This allows us to sort filtered items by their GSI position
        award_id_to_gsi_position = {}
        if 'award_ids' in locals() and award_ids:
            for gsi_pos, award_id in enumerate(award_ids):
                award_id_to_gsi_position[award_id] = gsi_pos
        
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
        
        # Continue querying with pagination if we have more items in the GSI
        # This is important for KEYS_ONLY GSIs where we need to fetch and filter more items
        # Continue pagination if:
        # 1. We have a last_eval_key (meaning there might be more items in GSI), AND
        # 2. Either:
        #    a. We have fewer filtered items than the limit (need more to fill the page), OR
        #    b. We got exactly query_limit items from the first query (suggesting there might be more)
        # Note: We check both initial_last_eval_key (first request) and last_eval_key (subsequent requests)
        # to ensure we continue querying on all requests until we have enough items or the GSI is exhausted
        # Use initial_last_eval_key if available (from first query), otherwise use last_eval_key (from current query response)
        # CRITICAL: When using a custom pagination key from a previous request, if DynamoDB returns
        # LastEvaluatedKey: False but we have fewer filtered items than the limit, we should create
        # a pagination key from the last GSI item we processed and continue in the next request.
        # However, within the same request, if DynamoDB says there are no more items, we can't continue.
        # The issue is that we need to ensure has_more is set correctly so the frontend can continue.
        current_last_eval_key = initial_last_eval_key if initial_last_eval_key is not None else (last_eval_key if last_eval_key is not None else None)
        should_continue_pagination = (
            method == 'query' and 
            index_name and 
            current_last_eval_key is not None and
            len(filtered_items) < limit  # Only continue if we don't have enough filtered items yet
        )
        
        if should_continue_pagination:
            logger.info(f"Found {len(filtered_items)} filtered items (need {limit}), continuing query with pagination to fetch all items from GSI... (current_last_eval_key: {current_last_eval_key is not None})")
            max_pagination_rounds = 50  # Increased limit for queries that might have many results (like zip codes)
            pagination_round = 0
            # current_last_eval_key is already set above (from initial_last_eval_key or last_eval_key)
            
            # Continue until we have enough filtered items OR we've exhausted the GSI
            # CRITICAL: We need to continue querying if:
            # 1. We don't have enough filtered items yet (len(filtered_items) < limit), OR
            # 2. We got exactly query_limit items from the first query (suggesting there might be more in GSI)
            # The while loop should continue as long as we have a last_eval_key AND we haven't exhausted the GSI
            # We'll break early inside the loop when we have enough filtered items
            while current_last_eval_key is not None and pagination_round < max_pagination_rounds:
                pagination_round += 1
                
                # If we don't have a last_eval_key from previous round, we can't continue
                if current_last_eval_key is None:
                    logger.info(f"No LastEvaluatedKey from previous query, stopping pagination")
                    break
                
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
                    
                    # Extract award_ids and update gsi_item_map and last_gsi_item (track last item in GSI order)
                    # Also update award_ids and award_id_to_gsi_position for sorting
                    continuation_award_ids = []
                    # Calculate the starting position for this continuation batch
                    # This should be the current length of award_ids BEFORE we add the continuation items
                    continuation_gsi_start_position = len(award_ids) if 'award_ids' in locals() and award_ids else 0
                    for idx, item in enumerate(continuation_gsi_items):
                        award_id = item.get('award_id')
                        if award_id:
                            continuation_award_ids.append(award_id)
                            # Update award_ids list to maintain GSI order
                            if 'award_ids' not in locals():
                                award_ids = []
                            award_ids.append(award_id)
                            # Update award_id_to_gsi_position mapping
                            # Use the index in the continuation batch, not len(continuation_award_ids)
                            # This ensures correct position calculation
                            if 'award_id_to_gsi_position' not in locals():
                                award_id_to_gsi_position = {}
                            award_id_to_gsi_position[award_id] = continuation_gsi_start_position + idx
                            # Update gsi_item_map
                            if 'gsi_item_map' not in locals():
                                gsi_item_map = {}
                            gsi_item_map[award_id] = item  # Store mapping for later use
                            last_gsi_item = item  # Update to last item in GSI order
                    
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
                    # Don't break early - we need to process all items to ensure we don't miss any
                    # The limit will be applied later when we return results
                    for item in continuation_items:
                        if apply_python_filter(item, filter_filters):
                            filtered_items.append(item)
                    
                    logger.info(f"Pagination round {pagination_round}: Found {len(filtered_items)} total matching items so far")
                    
                    # CRITICAL: Stop as soon as we have enough filtered items for the current page
                    # We don't want to process all items - just enough to fill the page
                    # This ensures pagination works correctly across multiple requests
                    if len(filtered_items) >= limit:
                        logger.info(f"Have enough filtered items ({len(filtered_items)} >= {limit}), stopping pagination to allow proper pagination across requests")
                        break
                    
                    # Check if GSI is exhausted
                    if not current_last_eval_key:
                        logger.info(f"No more items in GSI, stopping pagination. Found {len(filtered_items)} filtered items total")
                        break
                    
                    # Update last_gsi_item to the last item from this continuation query
                    if continuation_gsi_items:
                        last_gsi_item = continuation_gsi_items[-1]
                        
                except Exception as e:
                    logger.error(f"Error in pagination round {pagination_round}: {str(e)}", exc_info=True)
                    break
        
        # Only set items from filtered_items if we didn't already set them (for scans, items are already set)
        if not skip_normal_fetch:
            # Sort filtered_items by their GSI position to maintain GSI order
            # This is critical because BatchGetItem doesn't preserve order
            # We need to ensure items are in GSI order for correct pagination
            if 'award_id_to_gsi_position' in locals() and award_id_to_gsi_position:
                filtered_items.sort(key=lambda item: award_id_to_gsi_position.get(item.get('award_id'), float('inf')))
                logger.info(f"Sorted {len(filtered_items)} filtered items by GSI position")
            items = filtered_items
            logger.info(f"Filtered to {len(items)} items matching all criteria")
    
    # Check if we have more items than the limit before limiting
    has_more_filtered_items = len(items) > limit
    
    # Store the last item we're RETURNING (the limit-th item, or the last item if fewer than limit)
    # This is the item we should use for pagination key creation
    # We need to use the item at position (limit - 1) because that's the last item we're returning
    # If we have fewer items than the limit, use the last item
    last_item_before_limit = items[limit - 1] if len(items) > limit else (items[-1] if items else None)
    if last_item_before_limit and 'award_id_to_gsi_position' in locals() and award_id_to_gsi_position:
        gsi_pos = award_id_to_gsi_position.get(last_item_before_limit.get('award_id'), 'unknown')
        logger.info(f"Selected item at position {limit - 1} (GSI position {gsi_pos}) for pagination key: award_id={last_item_before_limit.get('award_id')}, fiscal_year={last_item_before_limit.get('fiscal_year')}")
    
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
    # NOTE: We'll create our own pagination key from the last returned item, so we don't need
    # to use DynamoDB's LastEvaluatedKey. DynamoDB's key points to after the last item we
    # QUERIED, not after the last item we RETURNED, which would cause items to be skipped.
    dynamodb_last_key = None
    if last_eval_key:
        try:
            dynamodb_last_key = convert_decimal_to_float(last_eval_key)
            logger.info(f"DynamoDB provided LastEvaluatedKey (pointing to after last QUERIED item): {json.dumps(dynamodb_last_key, default=str)}")
            logger.info(f"Will create custom pagination key from last RETURNED item instead to avoid skipping items")
        except Exception as e:
            logger.warning(f"Error converting last_evaluated_key to serializable format: {e}")
            dynamodb_last_key = None
    
    # We'll set serializable_last_key to our custom key below
    serializable_last_key = None
    
    # Simplified pagination logic: Always allow pagination to continue if we have items to return.
    # The frontend will detect when there are no more results by:
    # 1. Seeing that the result count stops increasing
    # 2. Receiving 0 items in a response
    # This approach is more reliable than trying to determine has_more on the backend, especially
    # when using custom pagination keys or when DynamoDB's LastEvaluatedKey might not perfectly
    # align with our filtered results.
    # 
    # Only set has_more to False when we return 0 items (definitely no more results).
    # Otherwise, always set has_more to True if we have items, allowing the frontend to continue.
    has_more_results = len(items) > 0  # If we have items, allow frontend to continue paginating
    
    # Always create a pagination key from the last RETURNED item if we have items to return.
    # CRITICAL: We MUST create our own pagination key from the last returned item, even if
    # DynamoDB gave us a LastEvaluatedKey. DynamoDB's LastEvaluatedKey points to after the
    # last item we QUERIED (e.g., the 125th item), not after the last item we RETURNED (e.g., the 25th item).
    # Using DynamoDB's key would cause us to skip items between the last returned item and
    # the last queried item.
    #
    # We use the last item we're RETURNING (not the last item we processed) to create the key,
    # ensuring we continue from exactly where we left off. We must use the GSI item that corresponds
    # to the last returned item to get the correct GSI key structure (fiscal_year, etc.).
    should_create_pagination_key = (
        len(items) > 0 and  # Only create key if we have items to return
        method == 'query' and 
        index_name
        # Always create our own key, even if DynamoDB gave us one
    )
    if should_create_pagination_key:
        # CRITICAL: Always use the last RETURNED item's GSI item for the pagination key.
        # This ensures we continue from exactly where we left off, not from a later position.
        # The last returned item is the item at position (limit - 1), which is the last item
        # we're actually returning to the user. We must use its corresponding GSI item to get
        # the correct fiscal_year and award_id combination that DynamoDB expects.
        #
        # Using last_gsi_item (the last item in the GSI batch) would cause us to skip items
        # because it might be from a much later fiscal_year than the last item we returned.
        source_item = None
        
        # Always use the last returned item's corresponding GSI item
        # CRITICAL: We MUST use the fiscal_year and award_id from the last returned item
        # to ensure we continue from exactly where we left off, not from a later position.
        if last_item_before_limit and 'award_id' in last_item_before_limit:
            award_id = last_item_before_limit.get('award_id')
            fiscal_year = last_item_before_limit.get('fiscal_year')
            recipient_zip_code = last_item_before_limit.get('recipient_zip_code')
            
            logger.info(f"Creating pagination key from last returned item: award_id={award_id}, fiscal_year={fiscal_year}, recipient_zip_code={recipient_zip_code}")
            
            # Try to find the GSI item for this award_id in the map
            # But verify it has the same fiscal_year to ensure it's the correct item
            if 'gsi_item_map' in locals() and gsi_item_map:
                gsi_item = gsi_item_map.get(award_id)
                if gsi_item:
                    # Verify the GSI item has the same fiscal_year as the last returned item
                    gsi_fiscal_year = gsi_item.get('fiscal_year')
                    if str(gsi_fiscal_year) == str(fiscal_year):
                        source_item = gsi_item
                        logger.info(f"Using GSI item from map for pagination key (verified fiscal_year matches): {json.dumps({k: source_item.get(k) for k in ['recipient_zip_code', 'fiscal_year', 'award_id'] if k in source_item}, default=str)}")
                    else:
                        logger.warning(f"GSI item in map has different fiscal_year ({gsi_fiscal_year} vs {fiscal_year}), constructing from last returned item instead")
            
            # If GSI item not found in map or has wrong fiscal_year, construct it from the last returned item
            # This ensures we have the correct fiscal_year and award_id combination
            if source_item is None:
                # Build GSI item structure from the last returned item
                # CRITICAL: Use the exact fiscal_year and award_id from the last returned item
                source_item = {
                    'recipient_zip_code': recipient_zip_code,
                    'fiscal_year': fiscal_year,
                    'award_id': award_id
                }
                logger.info(f"Constructed GSI item for pagination key from last returned item (ensures correct fiscal_year={fiscal_year}, award_id={award_id}): {json.dumps({k: source_item.get(k) for k in ['recipient_zip_code', 'fiscal_year', 'award_id'] if k in source_item}, default=str)}")
        
        # Fallback: use the last returned item from results
        if source_item is None:
            source_item = results[-1] if results else None
            if source_item:
                # Build GSI item structure
                source_item = {
                    'recipient_zip_code': source_item.get('recipient_zip_code'),
                    'fiscal_year': source_item.get('fiscal_year'),
                    'award_id': source_item.get('award_id')
                }
                logger.warning(f"Using last result item for pagination key (fallback): {json.dumps({k: source_item.get(k) for k in ['recipient_zip_code', 'fiscal_year', 'award_id'] if k in source_item}, default=str)}")
            else:
                logger.warning("No source item available for pagination key creation")
        
        if source_item:
            hash_key_name = key_condition.get('hash_key', [None])[0] if key_condition.get('hash_key') else None
            range_key_name = key_condition.get('range_key', [None])[0] if key_condition.get('range_key') else None
            
            # Check if the GSI has a range key (even if we're not filtering by it)
            # For GSIs with range keys, DynamoDB requires the range key in ExclusiveStartKey
            gsi_has_range_key = False
            gsi_range_key_name = None
            if index_name == 'ZipCodeFiscalYearIndex':
                gsi_has_range_key = True
                gsi_range_key_name = 'fiscal_year'
            elif index_name == 'RecipientNameFiscalYearIndex':
                gsi_has_range_key = True
                gsi_range_key_name = 'fiscal_year'
            elif index_name == 'AgencyFiscalYearIndex':
                gsi_has_range_key = True
                gsi_range_key_name = 'fiscal_year'
            elif index_name == 'AwardingAgencyNameFiscalYearIndex':
                gsi_has_range_key = True
                gsi_range_key_name = 'fiscal_year'
            elif index_name == 'AwardingAgencyCodeFiscalYearIndex':
                gsi_has_range_key = True
                gsi_range_key_name = 'fiscal_year'
            elif index_name == 'StateFiscalYearIndex':
                gsi_has_range_key = True
                gsi_range_key_name = 'fiscal_year'
            elif index_name == 'AwardTypeFiscalYearIndex':
                gsi_has_range_key = True
                gsi_range_key_name = 'fiscal_year'
            elif index_name == 'FiscalYearObligationIndex':
                gsi_has_range_key = True
                gsi_range_key_name = 'fiscal_year'
            
            # Use GSI range key if available, otherwise use query range key
            effective_range_key_name = gsi_range_key_name if gsi_has_range_key else range_key_name
            
            # Build pagination key based on GSI structure
            # CRITICAL: Use the EXACT format from the GSI item to ensure DynamoDB matches correctly
            # DynamoDB's ExclusiveStartKey must match the exact key structure and types stored in the GSI
            pagination_key = {}
            if hash_key_name and hash_key_name in source_item:
                pagination_key[hash_key_name] = source_item[hash_key_name]
            if effective_range_key_name and effective_range_key_name in source_item:
                range_value = source_item[effective_range_key_name]
                # For fiscal_year, DynamoDB stores it as an integer (N type) in the GSI
                # But boto3 might return it as Decimal, string, or int depending on how it was stored
                # We need to ensure it's an integer for proper matching, but preserve the original if it's already correct
                if effective_range_key_name == 'fiscal_year':
                    # Import Decimal here to avoid scoping issues
                    from decimal import Decimal as DecimalType
                    # Convert to int if it's a float or Decimal (common boto3 return types)
                    if isinstance(range_value, float):
                        range_value = int(range_value)
                    elif isinstance(range_value, DecimalType):
                        range_value = int(range_value)
                    elif isinstance(range_value, str):
                        # If it's a string, try to convert to int (DynamoDB stores years as integers)
                        try:
                            range_value = int(float(range_value))
                        except (ValueError, TypeError):
                            # If conversion fails, keep as-is (shouldn't happen, but be safe)
                            logger.warning(f"Could not convert fiscal_year from string to int: {range_value}, keeping as-is")
                pagination_key[effective_range_key_name] = range_value
            # Always include award_id for uniqueness
            if 'award_id' in source_item:
                pagination_key['award_id'] = source_item['award_id']
            
            if pagination_key:
                try:
                    # Log the pagination key before conversion to see its structure
                    logger.info(f"Pagination key before conversion: {json.dumps(pagination_key, default=str)}")
                    # Convert to JSON-serializable format, but preserve integer types for fiscal_year
                    serializable_last_key = convert_decimal_to_float(pagination_key)
                    # Ensure fiscal_year remains an integer (not float) after conversion
                    if 'fiscal_year' in serializable_last_key:
                        if isinstance(serializable_last_key['fiscal_year'], float):
                            serializable_last_key['fiscal_year'] = int(serializable_last_key['fiscal_year'])
                        elif isinstance(serializable_last_key['fiscal_year'], str):
                            try:
                                serializable_last_key['fiscal_year'] = int(float(serializable_last_key['fiscal_year']))
                            except (ValueError, TypeError):
                                pass
                    logger.info(f"Created pagination key from last item (items_count={len(items)}, allowing frontend to continue pagination): {json.dumps(serializable_last_key, default=str)}")
                except Exception as e:
                    logger.warning(f"Error converting pagination key to serializable format: {e}")
                    serializable_last_key = None
    
    # Fallback to DynamoDB's key if we couldn't create our own (shouldn't happen, but be safe)
    if serializable_last_key is None and dynamodb_last_key is not None:
        logger.warning(f"Could not create custom pagination key, falling back to DynamoDB's LastEvaluatedKey (may cause items to be skipped)")
        serializable_last_key = dynamodb_last_key
    
    return {
        'success': True,
        'results': enriched_results,
        'count': len(enriched_results),
        'has_more': has_more_results,
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
    origin = None
    
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
        # Extract origin from request headers for CORS validation
        request_headers = event.get('headers', {})
        origin = request_headers.get('Origin') or request_headers.get('origin')
        
        headers = build_cors_headers(origin)
        
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
        
        # Check if this is a direct award_id lookup (for getAward API)
        # Only do direct lookup if award_id is provided AND filters is not provided (or is empty)
        award_id = body.get('award_id')
        filters = body.get('filters', {})
        if award_id and (not filters or (isinstance(filters, dict) and len(filters) == 0)):
            # Direct award lookup - fetch single award
            logger.info(f"Direct award lookup requested for award_id: {award_id}")
            result = get_single_award(award_id)
        else:
            # Regular search
            # Extract parameters (filters already extracted above)
            limit = int(body.get('limit', 100))
            last_evaluated_key = body.get('last_evaluated_key')
            
            # Validate limit
            if limit > 1000:
                limit = 1000  # Cap at 1000
            if limit < 1:
                limit = 100
            
            if last_evaluated_key:
                logger.info(f"Received last_evaluated_key for pagination: {json.dumps(last_evaluated_key, default=str)}")
            else:
                logger.info(f"No last_evaluated_key provided - starting from beginning")
            
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
            'headers': build_cors_headers(origin),
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }



