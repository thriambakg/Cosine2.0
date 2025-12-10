"""
USAspending Search Lambda Function
Queries DynamoDB awards table using GSIs and filters to return matching awards
"""

import json
import os
import logging
import boto3
import gzip
from typing import Dict, List, Any, Optional
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr

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
    Recursively convert Decimal values to float for JSON serialization
    """
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {key: convert_decimal_to_float(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimal_to_float(item) for item in obj]
    else:
        return obj


def fetch_award_details_from_s3(s3_key: str) -> Optional[Dict[str, Any]]:
    """
    Fetch award details (transactions and subawards) from S3
    
    Args:
        s3_key: S3 key for the award details file (gzipped JSON)
    
    Returns:
        Dictionary with 'transactions' and 'subawards' keys, or None if error
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
        logger.warning(f"Award details not found in S3: {s3_key}")
        return None
    except Exception as e:
        logger.error(f"Error fetching award details from S3 ({s3_key}): {str(e)}", exc_info=True)
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


def search_awards(filters: Dict[str, Any], limit: int = 100, last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search awards in DynamoDB using filters
    
    Args:
        filters: Dictionary of filter fields
        limit: Maximum number of results to return
        last_evaluated_key: Pagination token from previous request
    
    Returns:
        Dictionary with search results and pagination info
    """
    if not awards_table:
        raise Exception("DynamoDB awards table not initialized")
    
    # Determine query method
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
        # For queries, we can use the limit directly since queries are more efficient
        params = {
            'Limit': limit
        }
    
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
        
        # Add filter expression if we have additional filters
        if filter_expr:
            # Verify that the filter expression doesn't contain the hash key attribute
            # DynamoDB doesn't allow primary key attributes in FilterExpression when querying
            filter_str = str(filter_expr)
            if hash_key_name and hash_key_name in filter_str:
                logger.warning(f"FilterExpression contains hash key attribute {hash_key_name}, this will cause an error. Removing it.")
                # Don't add the filter expression if it contains the hash key
                # This is a safety check - the removal logic above should have prevented this
                filter_expr = None
            
            if filter_expr:
                params['FilterExpression'] = filter_expr
        
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
    
    else:
        # Use table scan
        if filter_expr:
            params['FilterExpression'] = filter_expr
        
        if last_evaluated_key:
            params['ExclusiveStartKey'] = last_evaluated_key
        
        logger.info(f"Scanning awards table with filters")
        response = awards_table.scan(**params)
    
    # Extract results
    items = response.get('Items', [])
    last_eval_key = response.get('LastEvaluatedKey')
    scanned_count = response.get('ScannedCount', 0)
    
    # For scans, if we didn't find enough results and there are more items, continue scanning
    if method == 'scan' and scan_limit is not None and len(items) < limit and last_eval_key and scanned_count > 0:
        # Continue scanning if we haven't found enough results
        # Limit the number of continuation scans to avoid infinite loops
        max_continuation_scans = 10
        continuation_count = 0
        
        while len(items) < limit and last_eval_key and continuation_count < max_continuation_scans:
            continuation_count += 1
            logger.info(f"Continuing scan (iteration {continuation_count}/{max_continuation_scans}), found {len(items)} items so far, scanned {scanned_count} total")
            
            # Continue scan from last evaluated key
            continuation_params = params.copy()
            continuation_params['ExclusiveStartKey'] = last_eval_key
            continuation_params['Limit'] = scan_limit  # Use the same scan limit
            
            continuation_response = awards_table.scan(**continuation_params)
            continuation_items = continuation_response.get('Items', [])
            last_eval_key = continuation_response.get('LastEvaluatedKey')
            scanned_count += continuation_response.get('ScannedCount', 0)
            
            items.extend(continuation_items)
            
            # Stop if we have enough results or no more items
            if len(items) >= limit or not last_eval_key:
                break
        
        logger.info(f"Scan complete: found {len(items)} items after scanning {scanned_count} total items")
    
    # Limit results to requested limit
    items = items[:limit]
    
    # Log initial results found
    if items:
        logger.info(f"Found {len(items)} award(s) in DynamoDB table using {method}" + (f" with index {index_name}" if index_name else ""))
    else:
        logger.info(f"No awards found in DynamoDB table using {method}" + (f" with index {index_name}" if index_name else ""))
    
    # Convert Decimal to float for JSON serialization
    results = [convert_decimal_to_float(item) for item in items]
    
    # Enrich results with S3 award details (transactions and subawards)
    enriched_results = []
    s3_fetch_success_count = 0
    s3_fetch_fail_count = 0
    for award in results:
        # Fetch award details from S3 if s3_key exists
        s3_key = award.get('award_details_s3_key')
        if s3_key:
            award_details = fetch_award_details_from_s3(s3_key)
            if award_details:
                # Add transactions and subawards to the award record
                award['transactions'] = award_details.get('transactions', [])
                award['subawards'] = award_details.get('subawards', [])
                s3_fetch_success_count += 1
            else:
                # If fetch failed, initialize empty arrays
                award['transactions'] = []
                award['subawards'] = []
                s3_fetch_fail_count += 1
        else:
            # No S3 key, initialize empty arrays
            award['transactions'] = []
            award['subawards'] = []
        
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
    """
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
        
        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps(result, default=str)
        }
        
    except Exception as e:
        logger.error(f"Error processing search request: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'headers': get_cors_headers(),
            'body': json.dumps({
                'error': 'Internal server error',
                'message': str(e)
            })
        }

