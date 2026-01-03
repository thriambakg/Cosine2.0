"""
LDA Search Lambda Function
Queries DynamoDB LDA filings table using GSIs and filters to return matching filings
"""

import json
import os
import logging
import boto3
from typing import Dict, List, Any, Optional
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr
from boto3.dynamodb.types import TypeDeserializer

# Configure logging
logger = logging.getLogger()
logger.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())

# AWS clients
dynamodb = boto3.resource('dynamodb')

# Environment variables
FILINGS_TABLE_NAME = os.environ.get('FILINGS_TABLE_NAME', 'lda-filings')

# Global constants
GSI_QUERY_BATCH_SIZE = 125  # Limit all GSI queries to 125 items per batch

# Get DynamoDB table
filings_table = dynamodb.Table(FILINGS_TABLE_NAME) if FILINGS_TABLE_NAME else None


def get_cors_headers():
    """Get CORS headers for API responses"""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
    }


def convert_decimal_to_float(obj: Any) -> Any:
    """Recursively convert Decimal values to float for JSON serialization"""
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {key: convert_decimal_to_float(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimal_to_float(item) for item in obj]
    else:
        return obj


def apply_python_filter(item: Dict[str, Any], filters: Dict[str, Any]) -> bool:
    """
    Apply filters to an item in Python (for post-BatchGetItem filtering with KEYS_ONLY GSIs)
    
    Args:
        item: Filing item to filter
        filters: Dictionary of filter fields
    
    Returns:
        True if item matches all filters, False otherwise
    """
    # Skip filtering if filters dict is empty or only contains empty/false values
    if not filters:
        return True
    
    # Check if filters only contain empty arrays, false values, or 0 values (which mean "no filter")
    # Skip early return - we need to check each filter individually
    # Empty arrays, False values, and 0 for amount_max/amount_min mean "no filter"
    # General text search fields (new format - arrays in general_text_search_fields)
    general_text_search_fields = filters.get('general_text_search_fields', {})
    if general_text_search_fields:
        # Check registrant field
        if general_text_search_fields.get('registrant'):
            registrant_terms = general_text_search_fields['registrant']
            if isinstance(registrant_terms, list) and registrant_terms:
                registrant_terms = [t for t in registrant_terms if t and str(t).strip()]
                if registrant_terms:
                    item_name = str(item.get('registrant_name') or '').lower()
                    matches = False
                    for term in registrant_terms:
                        term_lower = str(term).strip().lower()
                        if term_lower in item_name:
                            matches = True
                            break
                    if not matches:
                        return False
        
        # Check client field
        if general_text_search_fields.get('client'):
            client_terms = general_text_search_fields['client']
            if isinstance(client_terms, list) and client_terms:
                client_terms = [t for t in client_terms if t and str(t).strip()]
                if client_terms:
                    item_name = str(item.get('client_name') or '').lower()
                    matches = False
                    for term in client_terms:
                        term_lower = str(term).strip().lower()
                        if term_lower in item_name:
                            matches = True
                            break
                    if not matches:
                        return False
        
        # Check lobbyist field - now uses parameter-filing mappings, so this is just a safety check
        # The actual filtering happens via parameter-filing mapping queries
        if general_text_search_fields.get('lobbyist'):
            lobbyist_terms = general_text_search_fields['lobbyist']
            if isinstance(lobbyist_terms, list) and lobbyist_terms:
                lobbyist_terms = [t for t in lobbyist_terms if t and str(t).strip()]
                if lobbyist_terms:
                    # Check all_lobbyist_names array if present
                    all_lobbyist_names = item.get('all_lobbyist_names', [])
                    if not isinstance(all_lobbyist_names, list):
                        all_lobbyist_names = []
                    
                    matches = False
                    for term in lobbyist_terms:
                        term_lower = str(term).strip().lower()
                        for lobbyist_name in all_lobbyist_names:
                            if isinstance(lobbyist_name, str) and term_lower in lobbyist_name.lower():
                                matches = True
                                break
                        if matches:
                            break
                    if not matches:
                        return False
        
        # Check PAC field - PAC names are typically in client_name when pac=true
        if general_text_search_fields.get('pac'):
            pac_terms = general_text_search_fields['pac']
            if isinstance(pac_terms, list) and pac_terms:
                pac_terms = [t for t in pac_terms if t and str(t).strip()]
                if pac_terms:
                    # PAC names are stored in client_name when it's a PAC
                    item_name = str(item.get('client_name') or '').lower()
                    item_pac = bool(item.get('pac', 0))
                    logger.info(f"PAC filter check - item client_name: '{item.get('client_name')}', item pac flag: {item_pac}, searching for: {pac_terms}")
                    matches = False
                    for term in pac_terms:
                        term_lower = str(term).strip().lower()
                        if term_lower in item_name:
                            matches = True
                            logger.info(f"PAC name match found: '{term_lower}' in '{item_name}'")
                            break
                    if not matches:
                        logger.info(f"PAC name not matched: '{pac_terms}' not found in '{item.get('client_name')}'")
                        return False
                    # Also ensure this is actually a PAC filing
                    if not item_pac:
                        logger.info(f"Item has matching PAC name but pac flag is False: {item.get('client_name')}")
                        return False
                    logger.info(f"PAC filter passed for item: {item.get('client_name')}")
    
    # General text search (legacy format - searches across multiple fields)
    if filters.get('general_text_search'):
        search_terms = filters['general_text_search'] if isinstance(filters['general_text_search'], list) else [filters['general_text_search']]
        search_terms = [t for t in search_terms if t and str(t).strip()]
        if search_terms:
            matches = False
            for term in search_terms:
                term_lower = str(term).strip().lower()
                # Search across registrant_name, client_name, lobbyist_name
                registrant = str(item.get('registrant_name') or '').lower()
                client = str(item.get('client_name') or '').lower()
                lobbyist = str(item.get('lobbyist_name') or '').lower()
                if term_lower in registrant or term_lower in client or term_lower in lobbyist:
                    matches = True
                    break
            if not matches:
                return False
    
    # Registrant name filter (OR logic within field)
    if filters.get('registrant_name'):
        registrant_names = filters['registrant_name'] if isinstance(filters['registrant_name'], list) else [filters['registrant_name']]
        registrant_names = [n for n in registrant_names if n and str(n).strip()]
        if registrant_names:
            item_name = str(item.get('registrant_name') or '').strip()
            matches = False
            for name in registrant_names:
                name_str = str(name).strip()
                if item_name and name_str.lower() in item_name.lower():
                    matches = True
                    break
            if not matches:
                return False
    
    # Client name filter (OR logic within field)
    if filters.get('client_name'):
        client_names = filters['client_name'] if isinstance(filters['client_name'], list) else [filters['client_name']]
        client_names = [n for n in client_names if n and str(n).strip()]
        if client_names:
            item_name = str(item.get('client_name') or '').strip()
            matches = False
            for name in client_names:
                name_str = str(name).strip()
                if item_name and name_str.lower() in item_name.lower():
                    matches = True
                    break
            if not matches:
                return False
    
    # Lobbyist name filter (OR logic within field)
    if filters.get('lobbyist_name'):
        lobbyist_names = filters['lobbyist_name'] if isinstance(filters['lobbyist_name'], list) else [filters['lobbyist_name']]
        lobbyist_names = [n for n in lobbyist_names if n and str(n).strip()]
        if lobbyist_names:
            item_name = str(item.get('lobbyist_name') or '').strip()
            matches = False
            for name in lobbyist_names:
                name_str = str(name).strip()
                if item_name and name_str.lower() in item_name.lower():
                    matches = True
                    break
            if not matches:
                return False
    
    # Foreign entity name filter (OR logic within field)
    if filters.get('foreign_entity_name'):
        foreign_names = filters['foreign_entity_name'] if isinstance(filters['foreign_entity_name'], list) else [filters['foreign_entity_name']]
        foreign_names = [n for n in foreign_names if n and str(n).strip()]
        if foreign_names:
            # Check if item has foreign entity information
            is_foreign = item.get('is_foreign', 0)
            if not is_foreign:
                return False
            # Additional name matching could be added here if foreign_entity_name field exists
    
    # Amount range filter
    # Only apply if amount_min is provided and > 0 (0 means no minimum)
    if filters.get('amount_min') is not None:
        amount_min = float(filters['amount_min'])
        if amount_min > 0:  # Only apply filter if amount_min > 0
            item_amount = float(item.get('amount_reported', 0) or 0)
            if item_amount < amount_min:
                return False
    
    # Only apply if amount_max is provided and > 0 (0 means no maximum)
    if filters.get('amount_max') is not None:
        amount_max = float(filters['amount_max'])
        if amount_max > 0:  # Only apply filter if amount_max > 0
            item_amount = float(item.get('amount_reported', 0) or 0)
            if item_amount > amount_max:
                return False
    
    # General issue code filter (OR logic within field) - now uses parameter-filing mappings
    # This is just a safety check, actual filtering happens via parameter-filing mapping queries
    if filters.get('general_issue_code'):
        issue_names = filters['general_issue_code'] if isinstance(filters['general_issue_code'], list) else [filters['general_issue_code']]
        issue_names = [n for n in issue_names if n and str(n).strip()]
        if issue_names:
            # Check all_general_issue_codes array if present (though this shouldn't be in items anymore)
            # Parameter-filing mappings should have already filtered these
            all_issue_codes = item.get('all_general_issue_codes', [])
            if not isinstance(all_issue_codes, list):
                all_issue_codes = []
            
            # For now, if we have parameter-filing mappings, we trust them
            # This is a fallback check only
            pass  # Parameter-filing mappings handle the filtering
    
    # State filter (OR logic within field)
    if filters.get('state'):
        states = filters['state'] if isinstance(filters['state'], list) else [filters['state']]
        states = [s for s in states if s and str(s).strip()]
        if states:
            item_state = str(item.get('state') or '').strip()
            if item_state not in states:
                return False
    
    # Foreign entity boolean filter
    if filters.get('is_foreign') is not None:
        is_foreign = bool(filters['is_foreign'])
        item_foreign = bool(item.get('is_foreign', 0))
        if item_foreign != is_foreign:
            return False
    
    # PAC boolean filter
    if filters.get('pac') is not None:
        pac = bool(filters['pac'])
        item_pac = bool(item.get('pac', 0))
        if item_pac != pac:
            return False
    
    # Filer type filter (OR logic within field)
    if filters.get('filer_type'):
        filer_types = filters['filer_type'] if isinstance(filters['filer_type'], list) else [filters['filer_type']]
        filer_types = [t for t in filer_types if t and str(t).strip()]
        if filer_types:
            item_type = str(item.get('filer_type') or '').strip()
            if item_type not in filer_types:
                return False
    
    # Item type filter (FILING or CONTRIBUTION) - filters by item_type field or PK prefix
    if filters.get('item_type'):
        item_types = filters['item_type'] if isinstance(filters['item_type'], list) else [filters['item_type']]
        item_types = [t.upper() for t in item_types if t and str(t).strip()]
        if item_types:
            # First check item_type field (preferred, set by indexer)
            item_type_value = str(item.get('item_type') or '').strip().upper()
            if item_type_value:
                if item_type_value not in item_types:
                    return False
            else:
                # Fallback: check PK prefix if item_type field is not available
                item_pk = str(item.get('PK') or '').strip()
                if not item_pk:
                    # If no PK, try to determine from other fields
                    if item.get('filing_uuid') and not item.get('contribution_uuid'):
                        item_pk = f'FILING#{item.get("filing_uuid")}'
                    elif item.get('contribution_uuid'):
                        item_pk = f'CONTRIBUTION#{item.get("contribution_uuid")}'
                    else:
                        # Fallback: check if it looks like a filing or contribution based on structure
                        if item.get('report_type') or item.get('filing_type'):
                            item_pk = 'FILING#'
                        elif item.get('pacs') or item.get('contribution_items'):
                            item_pk = 'CONTRIBUTION#'
                        else:
                            item_pk = 'FILING#'
                
                # Check if PK starts with any of the requested prefixes
                matches = False
                for item_type in item_types:
                    if item_pk.startswith(f'{item_type}#'):
                        matches = True
                        break
                if not matches:
                    return False
    
    return True


def identify_queryable_filters(filters: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Identify which filters can use GSIs for efficient querying
    
    Returns:
        List of query configurations for each filter that can use a GSI
    """
    query_configs = []
    
    # Date range filter - use YearPostedDateIndex or PeriodPostedDateIndex
    date_from = filters.get('date_from')
    date_to = filters.get('date_to')
    
    # Item type filter - use ItemTypePostedDateIndex
    has_item_type_with_date = False
    if filters.get('item_type'):
        item_types = filters['item_type'] if isinstance(filters['item_type'], list) else [filters['item_type']]
        item_types = [t.upper() for t in item_types if t and str(t).strip()]
        if item_types:
            # Use first item type for GSI query (if multiple, we'll filter in Python)
            query_configs.append({
                'filter_key': 'item_type',
                'index_name': 'ItemTypePostedDateIndex',
                'hash_key': 'item_type',
                'hash_value': item_types[0],
                'range_key': 'dt_posted',
                'range_value': date_from if date_from else None,
                'range_condition': 'gte' if date_from else None
            })
            # Mark that we have item_type with date filtering
            if date_from or date_to:
                has_item_type_with_date = True
    
    # Only use YearPostedDateIndex if we don't already have ItemTypePostedDateIndex with date filtering
    # ItemTypePostedDateIndex already handles date filtering via its range key, so YearPostedDateIndex
    # would create an unnecessary intersection that could exclude valid results (e.g., if date_from=2007
    # but earliest data is 2008, YearPostedDateIndex for 2007 would return 0 results)
    if (date_from or date_to) and not has_item_type_with_date:
        # Query all years in the date range (similar to amount bucket queries)
        try:
            from datetime import datetime
            
            # Determine year range
            if date_from and date_to:
                year_from = int(date_from.split('-')[0])
                year_to = int(date_to.split('-')[0])
                years_to_query = list(range(year_from, year_to + 1))
            elif date_from:
                year_from = int(date_from.split('-')[0])
                years_to_query = [year_from]
            elif date_to:
                year_to = int(date_to.split('-')[0])
                years_to_query = [year_to]
            else:
                years_to_query = []
            
            # Create a query config for each year in the range
            for year in years_to_query:
                # For each year, determine the range key condition
                # If this is the first year and we have date_from, use >= date_from
                # If this is the last year and we have date_to, use <= date_to
                # Otherwise, query the entire year
                range_value = None
                range_condition = None
                
                if len(years_to_query) == 1:
                    # Single year - apply both date_from and date_to if available
                    if date_from and date_to:
                        # Will be handled as 'between' in query_gsi_for_filing_ids
                        range_value = (date_from, date_to)
                        range_condition = 'between'
                    elif date_from:
                        range_value = date_from
                        range_condition = 'gte'
                    elif date_to:
                        range_value = date_to
                        range_condition = 'lte'
                else:
                    # Multiple years - apply date_from on first year, date_to on last year
                    if year == years_to_query[0] and date_from:
                        range_value = date_from
                        range_condition = 'gte'
                    elif year == years_to_query[-1] and date_to:
                        range_value = date_to
                        range_condition = 'lte'
                    # For middle years, no range condition (query entire year)
                
                query_configs.append({
                    'filter_key': 'date_range',
                    'index_name': 'YearPostedDateIndex',
                    'hash_key': 'filing_year',
                    'hash_value': year,
                    'range_key': 'dt_posted' if range_value else None,
                    'range_value': range_value,
                    'range_condition': range_condition,
                    'date_from': date_from,  # Store for reference
                    'date_to': date_to  # Store for reference
                })
        except (ValueError, IndexError) as e:
            logger.warning(f"Error parsing date range: {e}")
            pass
    
    # Check for general_text_search_fields structure (new format)
    general_text_search_fields = filters.get('general_text_search_fields', {})
    if general_text_search_fields:
        # Registrant name from general_text_search_fields
        # Create a query config for each registrant name (OR logic - union all)
        if general_text_search_fields.get('registrant'):
            registrant_terms = general_text_search_fields['registrant']
            if isinstance(registrant_terms, list) and registrant_terms:
                for registrant_term in registrant_terms:
                    # Normalize registrant name: strip whitespace and clean quotes for exact GSI match
                    normalized_registrant = clean_quotes(str(registrant_term).strip()) if registrant_term else None
                    if normalized_registrant:
                        query_configs.append({
                            'filter_key': 'registrant_name',
                            'index_name': 'RegistrantPostedDateIndex',
                            'hash_key': 'registrant_name',
                            'hash_value': normalized_registrant,
                            'range_key': 'dt_posted',
                            'range_value': date_from if date_from else None,
                            'range_condition': 'gte' if date_from else None,
                            'from_general_text_search': True,  # Mark as coming from general_text_search_fields
                            'category': 'registrant'  # Group by category for union
                        })
        
        # Client name from general_text_search_fields
        # Create a query config for each client name (OR logic - union all)
        if general_text_search_fields.get('client'):
            client_terms = general_text_search_fields['client']
            if isinstance(client_terms, list) and client_terms:
                for client_term in client_terms:
                    # Normalize client name: strip whitespace and clean quotes for exact GSI match
                    normalized_client = clean_quotes(str(client_term).strip()) if client_term else None
                    if normalized_client:
                        query_configs.append({
                            'filter_key': 'client_name',
                            'index_name': 'ClientPostedDateIndex',
                            'hash_key': 'client_name',
                            'hash_value': normalized_client,
                            'range_key': 'dt_posted',
                            'range_value': date_from if date_from else None,
                            'range_condition': 'gte' if date_from else None,
                            'from_general_text_search': True,  # Mark as coming from general_text_search_fields
                            'category': 'client'  # Group by category for union
                        })
        
        # Lobbyist name from general_text_search_fields - use search index
        # Create a query config for each lobbyist name (OR logic - union all)
        if general_text_search_fields.get('lobbyist'):
            lobbyist_terms = general_text_search_fields['lobbyist']
            if isinstance(lobbyist_terms, list) and lobbyist_terms:
                for lobbyist_term in lobbyist_terms:
                    query_configs.append({
                        'filter_key': 'lobbyist',
                        'query_type': 'search_index',
                        'search_type': 'LOBBYIST',
                        'search_values': [lobbyist_term],  # Single value per query config
                        'from_general_text_search': True,  # Mark as coming from general_text_search_fields
                        'category': 'lobbyist'  # Group by category for union
                    })
        
        # PAC names from general_text_search_fields - use search index
        # Create a query config for each PAC name (OR logic - union all)
        if general_text_search_fields.get('pac'):
            pac_terms = general_text_search_fields['pac']
            if isinstance(pac_terms, list) and pac_terms:
                for pac_term in pac_terms:
                    query_configs.append({
                        'filter_key': 'pac',
                        'query_type': 'search_index',
                        'search_type': 'PAC',
                        'search_values': [pac_term],  # Single value per query config
                        'from_general_text_search': True,  # Mark as coming from general_text_search_fields
                        'category': 'pac'  # Group by category for union
                    })
    
    # Registrant name filter - use RegistrantPostedDateIndex (advanced search - AND across categories, OR within)
    if filters.get('registrant_name'):
        registrant_names = filters['registrant_name'] if isinstance(filters['registrant_name'], list) else [filters['registrant_name']]
        if registrant_names:
            # Create a query config for each registrant name (OR within category)
            # They will be unioned together, then intersected with other advanced search fields
            for registrant_name in registrant_names:
                # Normalize registrant name: strip whitespace and clean quotes for exact GSI match
                normalized_registrant = clean_quotes(str(registrant_name).strip()) if registrant_name else None
                if normalized_registrant:
                    query_configs.append({
                        'filter_key': 'registrant_name',
                        'index_name': 'RegistrantPostedDateIndex',
                        'hash_key': 'registrant_name',
                        'hash_value': normalized_registrant,
                        'range_key': 'dt_posted',
                        'range_value': date_from if date_from else None,
                        'range_condition': 'gte' if date_from else None,
                        'is_advanced_search': True,  # Mark as advanced search field
                        'category': 'registrant_name'  # Group by category for OR logic
                    })
    
    # Client name filter - use ClientPostedDateIndex (advanced search - AND across categories, OR within)
    if filters.get('client_name'):
        client_names = filters['client_name'] if isinstance(filters['client_name'], list) else [filters['client_name']]
        if client_names:
            # Create a query config for each client name (OR within category)
            for client_name in client_names:
                # Normalize client name: strip whitespace and clean quotes for exact GSI match
                normalized_client = clean_quotes(str(client_name).strip()) if client_name else None
                if normalized_client:
                    query_configs.append({
                        'filter_key': 'client_name',
                        'index_name': 'ClientPostedDateIndex',
                        'hash_key': 'client_name',
                        'hash_value': normalized_client,
                        'range_key': 'dt_posted',
                        'range_value': date_from if date_from else None,
                        'range_condition': 'gte' if date_from else None,
                        'is_advanced_search': True,  # Mark as advanced search field
                        'category': 'client_name'  # Group by category for OR logic
                    })
    
    # Lobbyist name filter - use search index (advanced search - AND across categories, OR within)
    if filters.get('lobbyist_name'):
        lobbyist_names = filters['lobbyist_name'] if isinstance(filters['lobbyist_name'], list) else [filters['lobbyist_name']]
        if lobbyist_names:
            # Create a query config for each lobbyist name (OR within category)
            for lobbyist_name in lobbyist_names:
                query_configs.append({
                    'filter_key': 'lobbyist_name',
                    'query_type': 'search_index',
                    'search_type': 'LOBBYIST',
                    'search_values': [lobbyist_name],
                    'is_advanced_search': True,  # Mark as advanced search field
                    'category': 'lobbyist_name'  # Group by category for OR logic
                })
    
    # Foreign entity name filter - use search index (advanced search - AND across categories, OR within)
    if filters.get('foreign_entity_name'):
        foreign_names = filters['foreign_entity_name'] if isinstance(filters['foreign_entity_name'], list) else [filters['foreign_entity_name']]
        if foreign_names:
            # Create a query config for each foreign entity name (OR within category)
            for foreign_name in foreign_names:
                query_configs.append({
                    'filter_key': 'foreign_entity_name',
                    'query_type': 'search_index',
                    'search_type': 'FOREIGN_COUNTRY',
                    'search_values': [foreign_name],
                    'is_advanced_search': True,  # Mark as advanced search field
                    'category': 'foreign_entity_name'  # Group by category for OR logic
                })
    
    # State filter - use StatePostedDateIndex
    if filters.get('state'):
        states = filters['state'] if isinstance(filters['state'], list) else [filters['state']]
        if states:
            query_configs.append({
                'filter_key': 'state',
                'index_name': 'StatePostedDateIndex',
                'hash_key': 'state',
                'hash_value': states[0],
                'range_key': 'dt_posted',
                'range_value': date_from if date_from else None,
                'range_condition': 'gte' if date_from else None
            })
    
    # General issue code filter - use search index (now stores full names, not codes)
    if filters.get('general_issue_code'):
        issue_names = filters['general_issue_code'] if isinstance(filters['general_issue_code'], list) else [filters['general_issue_code']]
        if issue_names:
            # Clean quotes from issue names before querying
            cleaned_issue_names = [clean_quotes(name) for name in issue_names if clean_quotes(name)]
            if cleaned_issue_names:
                # Create a query config for each issue name (OR within category)
                for issue_name in cleaned_issue_names:
                    query_configs.append({
                        'filter_key': 'general_issue_code',
                        'query_type': 'search_index',
                        'search_type': 'GENERAL_ISSUE',
                        'search_values': [issue_name],
                        'is_advanced_search': True,
                        'category': 'general_issue_code'
                    })
    
    # Foreign entity filter - use ForeignEntityPostedDateIndex
    if filters.get('is_foreign') is not None:
        is_foreign = bool(filters['is_foreign'])
        query_configs.append({
            'filter_key': 'is_foreign',
            'index_name': 'ForeignEntityPostedDateIndex',
            'hash_key': 'is_foreign',
            'hash_value': 1 if is_foreign else 0,
            'range_key': 'dt_posted',
            'range_value': date_from if date_from else None,
            'range_condition': 'gte' if date_from else None
        })
    
    # PAC filter - use PACPostedDateIndex
    if filters.get('pac') is not None:
        pac = bool(filters['pac'])
        query_configs.append({
            'filter_key': 'pac',
            'index_name': 'PACPostedDateIndex',
            'hash_key': 'pac',
            'hash_value': 1 if pac else 0,
            'range_key': 'dt_posted',
            'range_value': date_from if date_from else None,
            'range_condition': 'gte' if date_from else None
        })
    
    # Government entity filter - use search index
    if filters.get('government_entity'):
        entity_names = filters['government_entity'] if isinstance(filters['government_entity'], list) else [filters['government_entity']]
        if entity_names:
            # Clean quotes from entity names before querying
            cleaned_entity_names = [clean_quotes(name) for name in entity_names if clean_quotes(name)]
            if cleaned_entity_names:
                # Create a query config for each entity name (OR within category)
                for entity_name in cleaned_entity_names:
                    query_configs.append({
                        'filter_key': 'government_entity',
                        'query_type': 'search_index',
                        'search_type': 'GOVERNMENT_ENTITY',
                        'search_values': [entity_name],
                        'is_advanced_search': True,
                        'category': 'government_entity'
                    })
    
    # Amount filter - use AmountReportedIndex
    # amount_min and amount_max are handled specially - we query buckets incrementally
    amount_min = filters.get('amount_min')
    amount_max = filters.get('amount_max')
    if amount_min is not None and amount_min > 0:
        # Convert to int for bucket value (buckets are integers)
        amount_bucket = int(amount_min)
        query_configs.append({
            'filter_key': 'amount',
            'index_name': 'AmountReportedIndex',
            'hash_key': 'amount_bucket',
            'hash_value': amount_bucket,
            'range_key': None,  # No range key condition - bucket already narrows results
            'range_value': None,
            'range_condition': None,
            'amount_min': amount_min,  # Store original min for Python filtering
            'amount_max': amount_max if amount_max and amount_max > 0 else None  # Store max for Python filtering
        })
    
    return query_configs


def clean_quotes(value: str) -> str:
    """Remove surrounding double quotes from a string value"""
    if not value:
        return value
    return str(value).strip().strip('"').strip()


def query_search_index(
    search_type: str,
    search_values: List[str],
    limit: int = GSI_QUERY_BATCH_SIZE,
    exclusive_start_key: Optional[Dict] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None
) -> tuple[List[str], Optional[Dict]]:
    """
    Query materialized search index items to get entity PKs (FILING#uuid or CONTRIBUTION#uuid)
    Supports native DynamoDB pagination via LastEvaluatedKey
    
    Structure:
    - PK = "SEARCH#<search_type>#<value>"
    - SK = "DT_POSTED#<date>#<entityPK>"
    
    Args:
        search_type: Type of search (e.g., "REGISTRANT", "CLIENT", "LOBBYIST", "PAC", "GENERAL_ISSUE", "GOVERNMENT_ENTITY", "FOREIGN_COUNTRY")
        search_values: List of search values (e.g., ["APPLE INC.", "MICROSOFT"])
        limit: Maximum number of entity PKs to return
        exclusive_start_key: Pagination token from previous query
        date_from: Optional date filter (YYYY-MM-DD)
        date_to: Optional date filter (YYYY-MM-DD)
    
    Returns:
        Tuple of (list of entity PKs like "FILING#uuid" or "CONTRIBUTION#uuid", last_evaluated_key for pagination)
    """
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    all_entity_pks = []
    last_eval_key = exclusive_start_key
    
    try:
        # For now, query the first search value (can be extended for multiple values with union)
        if not search_values:
            return [], None
        
        search_value = search_values[0]
        if not search_value or not str(search_value).strip():
            return [], None
        
        # Clean and normalize search value
        cleaned_value = clean_quotes(str(search_value).strip())
        if not cleaned_value:
            return [], None
        
        # Construct PK for search index: SEARCH#<search_type>#<value>
        search_pk = f"SEARCH#{search_type}#{cleaned_value}"
        
        # Build query parameters
        # SK format: DT_POSTED#YYYY-MM-DD#<entityPK>
        # We can use SK range conditions for date filtering
        key_condition = Key('PK').eq(search_pk)
        
        if date_from or date_to:
            # Build SK range condition for date filtering
            # SK format: DT_POSTED#YYYY-MM-DD#<entityPK>
            # Extract date part (YYYY-MM-DD) from ISO format if needed
            def extract_date(date_str):
                """Extract YYYY-MM-DD from ISO format or return as-is"""
                if not date_str:
                    return None
                # Handle ISO format: YYYY-MM-DDTHH:MM:SS or YYYY-MM-DD
                if 'T' in date_str:
                    return date_str.split('T')[0]
                elif ' ' in date_str:
                    return date_str.split(' ')[0]
                return date_str[:10]  # Take first 10 chars (YYYY-MM-DD)
            
            date_from_part = extract_date(date_from) if date_from else None
            date_to_part = extract_date(date_to) if date_to else None
            
            if date_from_part and date_to_part:
                # Range: DT_POSTED#date_from# <= SK <= DT_POSTED#date_to#~
                # Use ~ to ensure we get all SKs that start with DT_POSTED#date_to#
                sk_start = f"DT_POSTED#{date_from_part}#"
                sk_end = f"DT_POSTED#{date_to_part}#~"  # ~ is after all alphanumeric chars
                key_condition = Key('PK').eq(search_pk) & Key('SK').between(sk_start, sk_end)
            elif date_from_part:
                # Greater than or equal: DT_POSTED#date_from# <= SK
                sk_start = f"DT_POSTED#{date_from_part}#"
                key_condition = Key('PK').eq(search_pk) & Key('SK').gte(sk_start)
            elif date_to_part:
                # Less than or equal: SK <= DT_POSTED#date_to#~
                sk_end = f"DT_POSTED#{date_to_part}#~"
                key_condition = Key('PK').eq(search_pk) & Key('SK').lte(sk_end)
        
        query_params = {
            'KeyConditionExpression': key_condition,
            'ProjectionExpression': 'entity_pk, SK',  # Get entity_pk and SK for pagination
            'Limit': limit
        }
        
        # Add pagination token if provided
        if last_eval_key:
            # Handle custom format with search_index_key
            if isinstance(last_eval_key, dict):
                if 'search_index_key' in last_eval_key:
                    last_eval_key = last_eval_key['search_index_key']
                query_params['ExclusiveStartKey'] = last_eval_key
        
        logger.info(f"Querying search index: PK={search_pk}, limit={limit}, has_pagination={last_eval_key is not None}")
        response = filings_table.query(**query_params)
        
        # Extract entity PKs from results
        for item in response.get('Items', []):
            entity_pk = item.get('entity_pk')
            if entity_pk:
                all_entity_pks.append(str(entity_pk))
        
        last_eval_key = response.get('LastEvaluatedKey')
        
        # Date filtering is handled in the query via SK range conditions
        # No need for Python filtering
        
        logger.info(f"Found {len(all_entity_pks)} entity PKs from search index (has_more: {last_eval_key is not None})")
        
        return all_entity_pks, last_eval_key
        
    except Exception as e:
        logger.error(f"Error querying search index for {search_type}: {str(e)}", exc_info=True)
        raise


def query_parameter_filing_mappings(
    parameter_type: str,
    parameter_values: List[str],
    limit: int = GSI_QUERY_BATCH_SIZE,
    exclusive_start_key: Optional[Dict] = None,
    per_param_limit: Optional[int] = None
) -> tuple[List[str], Optional[Dict]]:
    """
    Query parameter-filing mappings to get filing IDs for a list of parameter values
    Supports pagination on SK (since PK is the same for all items with same parameter value)
    
    Args:
        parameter_type: Type of parameter (e.g., "GENERAL_ISSUE", "GOVERNMENT_ENTITY", "LOBBYIST", "PAC", "FOREIGN_COUNTRY")
        parameter_values: List of parameter values (names, not codes)
        limit: Maximum number of filing IDs to return total
        exclusive_start_key: Pagination token (contains PK and SK for continuing query)
        per_param_limit: Limit per parameter value (for pagination within a single parameter)
    
    Returns:
        Tuple of (list of filing UUIDs, last_evaluated_key for pagination)
    """
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    all_filing_uuids = []
    last_eval_key = exclusive_start_key
    per_param_limit = per_param_limit or limit
    
    try:
        # If we have a last_eval_key, it contains the PK and SK from the previous query
        # This means we're continuing pagination for a specific parameter value
        if last_eval_key:
            # Handle both DynamoDB format and our custom format
            if isinstance(last_eval_key, dict):
                # Check if it's in DynamoDB format (from direct query)
                if 'PK' in last_eval_key:
                    pk_from_key = last_eval_key.get('PK', {}).get('S', '') if isinstance(last_eval_key.get('PK'), dict) else str(last_eval_key.get('PK', ''))
                else:
                    # It's our custom format, extract the actual DynamoDB key
                    pk_from_key = None
                    # Try to extract from nested structure
                    if 'parameter_mapping_key' in last_eval_key:
                        param_key = last_eval_key['parameter_mapping_key']
                        pk_from_key = param_key.get('PK', {}).get('S', '') if isinstance(param_key.get('PK'), dict) else str(param_key.get('PK', ''))
                        last_eval_key = param_key  # Use the actual DynamoDB key
                
                if pk_from_key and pk_from_key.startswith(f"{parameter_type}#"):
                    # Query with pagination token
                    query_params = {
                        'KeyConditionExpression': Key('PK').eq(pk_from_key),
                        'ProjectionExpression': 'SK',
                        'Limit': per_param_limit,
                        'ExclusiveStartKey': last_eval_key
                    }
                    
                    logger.info(f"Continuing pagination for parameter-filing mappings: PK={pk_from_key}")
                    response = filings_table.query(**query_params)
                    
                    for item in response.get('Items', []):
                        sk = item.get('SK', '')
                        if sk:
                            sk_str = str(sk)
                            if sk_str.startswith('FILING#'):
                                filing_uuid = sk_str.replace('FILING#', '')
                                all_filing_uuids.append(filing_uuid)
                    
                    last_eval_key = response.get('LastEvaluatedKey')
                    logger.info(f"Found {len(all_filing_uuids)} filing UUIDs from paginated query")
                    return all_filing_uuids, last_eval_key
        
        # No pagination token - start fresh query
        # For now, only query the first parameter value (can be extended for multiple values)
        if parameter_values:
            param_value = parameter_values[0]
            if not param_value or not str(param_value).strip():
                return [], None
            
            # Clean double quotes from parameter value before querying (values are not stored with quotes)
            cleaned_value = clean_quotes(param_value)
            if not cleaned_value:
                return [], None
            
            # Construct PK for parameter-filing mapping: PARAMETER_TYPE#VALUE
            pk = f"{parameter_type}#{cleaned_value}"
            
            # Query for all mappings with this parameter value (paginated on SK)
            # Use a reasonable batch size for pagination
            query_params = {
                'KeyConditionExpression': Key('PK').eq(pk),
                'ProjectionExpression': 'SK',  # SK contains FILING#<uuid> or CONTRIBUTION#<uuid>
                'Limit': min(per_param_limit, limit)
            }
            
            logger.info(f"Querying parameter-filing mappings: PK={pk}, limit={per_param_limit}")
            response = filings_table.query(**query_params)
            
            for item in response.get('Items', []):
                sk = item.get('SK', '')
                if sk:
                    sk_str = str(sk)
                    # Extract UUID from SK (format: FILING#<uuid> or CONTRIBUTION#<uuid>)
                    if sk_str.startswith('FILING#'):
                        filing_uuid = sk_str.replace('FILING#', '')
                        all_filing_uuids.append(filing_uuid)
                    elif sk_str.startswith('CONTRIBUTION#'):
                        # For contributions, we'd need to fetch the contribution to get filing_uuid
                        # For now, skip contributions in parameter mappings (they're handled separately for PACs)
                        pass
            
            last_eval_key = response.get('LastEvaluatedKey')
            logger.info(f"Found {len(all_filing_uuids)} filing UUIDs from parameter-filing mappings (has_more: {last_eval_key is not None})")
        
        return all_filing_uuids, last_eval_key
        
    except Exception as e:
        logger.error(f"Error querying parameter-filing mappings for {parameter_type}: {str(e)}", exc_info=True)
        raise


def query_gsi_for_filing_ids(
    index_name: str,
    hash_key_name: str,
    hash_key_value: Any,
    range_key_name: Optional[str] = None,
    range_key_value: Optional[str] = None,
    range_key_condition: Optional[str] = None,
    limit: int = GSI_QUERY_BATCH_SIZE,
    exclusive_start_key: Optional[Dict] = None,
    get_all: bool = False
) -> tuple[List[str], Optional[Dict]]:
    """
    Query a GSI to get filing/contribution IDs (PK values)
    
    Returns:
        Tuple of (list of IDs as strings, last_evaluated_key)
        Note: IDs can be from either FILING# or CONTRIBUTION# items
    """
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    filing_ids = []
    last_eval_key = exclusive_start_key
    
    try:
        # Build key condition expression
        key_condition = Key(hash_key_name).eq(hash_key_value)
        
        if range_key_name and range_key_value:
            if range_key_condition == 'gte':
                key_condition = key_condition & Key(range_key_name).gte(range_key_value)
            elif range_key_condition == 'lte':
                key_condition = key_condition & Key(range_key_name).lte(range_key_value)
            elif range_key_condition == 'between':
                # For between, range_key_value should be a tuple (start, end)
                if isinstance(range_key_value, tuple) and len(range_key_value) == 2:
                    key_condition = key_condition & Key(range_key_name).between(range_key_value[0], range_key_value[1])
        
        # Query the GSI
        query_params = {
            'IndexName': index_name,
            'KeyConditionExpression': key_condition,
            'ProjectionExpression': 'PK, SK',
            'Limit': limit
        }
        
        if last_eval_key:
            query_params['ExclusiveStartKey'] = last_eval_key
        
        logger.info(f"Querying GSI {index_name} with hash_key={hash_key_name}, hash_value={hash_key_value} (type: {type(hash_key_value)}), range_key={range_key_name}, range_value={range_key_value}, range_condition={range_key_condition}")
        logger.info(f"KeyConditionExpression: {key_condition}")
        # Note: GSI hash key queries are case-sensitive. If no results, verify the exact case/spacing of the stored value.
        
        response = filings_table.query(**query_params)
        
        logger.info(f"GSI query response: {len(response.get('Items', []))} items returned, LastEvaluatedKey present: {bool(response.get('LastEvaluatedKey'))}")
        
        # Extract IDs from PK (format: FILING#{filing_uuid} or CONTRIBUTION#{contribution_uuid})
        if response.get('Items'):
            sample_item = response.get('Items')[0]
            logger.info(f"Sample item from GSI query: {sample_item}")
            logger.info(f"Sample item keys: {list(sample_item.keys())}")
            logger.info(f"Sample item PK value: {sample_item.get('PK')}, type: {type(sample_item.get('PK'))}")
        
        for item in response.get('Items', []):
            pk = item.get('PK', '')
            logger.debug(f"Processing item with PK: {pk}, type: {type(pk)}")
            if pk:
                pk_str = str(pk)
                if pk_str.startswith('FILING#'):
                    filing_id = pk_str.replace('FILING#', '')
                    filing_ids.append(filing_id)
                    logger.debug(f"Extracted filing ID: {filing_id}")
                elif pk_str.startswith('CONTRIBUTION#'):
                    # For contribution items, we'll extract the contribution ID
                    # The caller will need to handle fetching contribution items and mapping to filings
                    contribution_id = pk_str.replace('CONTRIBUTION#', '')
                    filing_ids.append(contribution_id)
                    logger.debug(f"Extracted contribution ID: {contribution_id}")
                else:
                    logger.warning(f"Item PK does not match expected format: {pk}")
            else:
                logger.warning(f"Item has no PK: {item}")
        
        logger.info(f"Extracted {len(filing_ids)} IDs from {len(response.get('Items', []))} items")
        
        last_eval_key = response.get('LastEvaluatedKey')
        
        # Continue paginating if needed
        if get_all and last_eval_key:
            while last_eval_key and len(filing_ids) < limit:
                query_params['ExclusiveStartKey'] = last_eval_key
                response = filings_table.query(**query_params)
                
                for item in response.get('Items', []):
                    pk = item.get('PK', '')
                    if pk.startswith('FILING#'):
                        filing_id = pk.replace('FILING#', '')
                        if filing_id not in filing_ids:  # Avoid duplicates
                            filing_ids.append(filing_id)
                    elif pk.startswith('CONTRIBUTION#'):
                        contribution_id = pk.replace('CONTRIBUTION#', '')
                        if contribution_id not in filing_ids:  # Avoid duplicates
                            filing_ids.append(contribution_id)
                
                last_eval_key = response.get('LastEvaluatedKey')
                if not last_eval_key:
                    break
                if len(filing_ids) >= limit:
                    break
        
    except Exception as e:
        logger.error(f"Error querying GSI {index_name}: {str(e)}", exc_info=True)
        raise
    
    return filing_ids, last_eval_key


def search_filings(filters: Dict[str, Any], last_evaluated_key: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Search filings in DynamoDB using filters with multi-GSI intersection approach
    
    Strategy:
    1. Query each filter's GSI separately to get filing IDs
    2. Use the shortest list as source of truth (most restrictive filter)
    3. Fetch full items for that list
    4. Apply remaining filters in Python
    5. Return all matching results (no limit)
    
    Args:
        filters: Dictionary of filter fields
        last_evaluated_key: Pagination token from previous request (not used - returns all results)
    
    Returns:
        Dictionary with search results and pagination info
    """
    if not filings_table:
        raise Exception("DynamoDB filings table not initialized")
    
    # Identify which filters can use GSIs
    query_configs = identify_queryable_filters(filters)
    
    # If we have multiple queryable filters, use intersection approach
    if len(query_configs) > 1:
        logger.info(f"Using multi-GSI intersection approach with {len(query_configs)} queries")
        
        # Check if we have a pagination token for a search index, parameter-filing mapping, GSI query, or union offset
        search_index_pagination_key = None
        search_index_config = None
        param_mapping_pagination_key = None
        param_mapping_config = None
        gsi_pagination_key = None
        gsi_config = None
        union_offset = None
        fetch_next_batches = False
        if last_evaluated_key and isinstance(last_evaluated_key, dict):
            query_type = last_evaluated_key.get('query_type')
            if query_type == 'union_offset':
                # Offset-based pagination for union of IDs
                fetch_next_batches = last_evaluated_key.get('fetch_next_batches', False)
                if fetch_next_batches:
                    # We're fetching next batches from queries - reset offset to 0 for new intersection
                    union_offset = 0
                    logger.info(f"Fetching next batches from queries - resetting union_offset to 0 for new intersection")
                else:
                    # Continue from previous offset
                    union_offset = last_evaluated_key.get('offset', 0)
                    logger.info(f"Continuing pagination from union offset: {union_offset}")
            elif query_type == 'search_index':
                # Extract the actual DynamoDB key from our custom format
                search_index_key_obj = last_evaluated_key.get('search_index_key')
                if search_index_key_obj:
                    search_index_pagination_key = search_index_key_obj
                    # Find the matching config
                    for config in query_configs:
                        if (config.get('query_type') == 'search_index' and 
                            config.get('search_type') == last_evaluated_key.get('search_type') and
                            config.get('filter_key') == last_evaluated_key.get('filter_key')):
                            search_index_config = config
                            break
                    if search_index_pagination_key:
                        logger.info(f"Continuing pagination for search index: {search_index_config['search_type'] if search_index_config else 'unknown'}")
            elif query_type == 'parameter_filing_mapping':
                # Extract the actual DynamoDB key from our custom format
                param_mapping_key_obj = last_evaluated_key.get('parameter_mapping_key')
                if param_mapping_key_obj:
                    param_mapping_pagination_key = param_mapping_key_obj
                    # Find the matching config
                    for config in query_configs:
                        if (config.get('query_type') == 'parameter_filing_mapping' and 
                            config.get('parameter_type') == last_evaluated_key.get('parameter_type') and
                            config.get('filter_key') == last_evaluated_key.get('filter_key')):
                            param_mapping_config = config
                            break
                    if param_mapping_pagination_key:
                        logger.info(f"Continuing pagination for parameter-filing mapping: {param_mapping_config['parameter_type'] if param_mapping_config else 'unknown'}")
            elif query_type == 'gsi':
                # Extract the actual DynamoDB key from our custom format
                gsi_key_obj = last_evaluated_key.get('gsi_key')
                if gsi_key_obj:
                    gsi_pagination_key = gsi_key_obj
                    # Find the matching config
                    for config in query_configs:
                        if (config.get('query_type') == 'gsi' and 
                            config.get('index_name') == last_evaluated_key.get('index_name') and
                            config.get('hash_key') == last_evaluated_key.get('hash_key') and
                            config.get('hash_value') == last_evaluated_key.get('hash_value')):
                            gsi_config = config
                            break
                    if gsi_pagination_key:
                        logger.info(f"Continuing pagination for GSI: {gsi_config['index_name'] if gsi_config else 'unknown'}")
        
        # Query each filter to get batches of filing IDs (GSI or parameter-filing mapping)
        # Continue fetching batches until intersection is complete (no limit)
        # Use a unique key for each query config to handle multiple values in the same category
        
        # If we need to fetch next batches, extract query keys from pagination token
        query_keys_from_token = {}
        if fetch_next_batches and last_evaluated_key and isinstance(last_evaluated_key, dict):
            query_keys_from_token = last_evaluated_key.get('query_keys', {})
            logger.info(f"Fetching next batches from queries using stored pagination keys: {list(query_keys_from_token.keys())}")
        
        # Track pagination keys for each query to continue fetching
        query_pagination_keys = {}
        query_config_map = {}  # Map unique_key to config for easy lookup
        for idx, config in enumerate(query_configs):
            if config.get('category'):
                unique_key = f"{config['category']}_{idx}"
            else:
                unique_key = f"{config['filter_key']}_{config.get('hash_value', idx)}"
            query_config_map[unique_key] = config
            
            # Initialize pagination key from token if available
            if fetch_next_batches and unique_key in query_keys_from_token:
                query_key_info = query_keys_from_token[unique_key]
                query_pagination_keys[unique_key] = query_key_info.get('key')
            else:
                query_pagination_keys[unique_key] = None
        
        # Continue fetching batches until we have enough items or all queries are exhausted
        # Only fetch first batch - user will paginate through the rest
        # Exception: For amount filters, allow fetching more batches since buckets are ranges
        has_amount_filters = any(config.get('filter_key') == 'amount' for config in query_configs)
        max_batch_iterations = 1  # Only fetch first batch, let user paginate
        if has_amount_filters:
            # For amount filters, allow fetching more batches to find matches
            # But limit to prevent infinite loops
            max_batch_iterations = 10  # Allow up to 10 batches for amount filters
        batch_iteration = 0
        accumulated_gsi_results = {}  # Accumulate results across batches
        
        while batch_iteration < max_batch_iterations:
            batch_iteration += 1
            logger.info(f"Fetching batch {batch_iteration} from queries...")
            
            # Query each filter to get a batch of filing IDs
            batch_gsi_results = {}
            all_queries_exhausted = True
            
            for unique_key, config in query_config_map.items():
                # Skip if this query is exhausted (no pagination key)
                if query_pagination_keys[unique_key] is None and batch_iteration > 1:
                    # Use accumulated results from previous batches
                    if unique_key in accumulated_gsi_results:
                        batch_gsi_results[unique_key] = accumulated_gsi_results[unique_key]
                    continue
                
                all_queries_exhausted = False
                
                if config.get('query_type') == 'search_index':
                    # Use search index query
                    logger.info(f"Querying search index for {config['search_type']} with values: {config['search_values']}")
                    
                    # Use pagination key from our tracking
                    exclusive_start_key = query_pagination_keys[unique_key]
                    if exclusive_start_key and batch_iteration == 1 and fetch_next_batches:
                        logger.info(f"Using stored pagination key for search index query (fetch_next_batches)")
                    elif exclusive_start_key:
                        logger.info(f"Using pagination key for search index query (batch {batch_iteration})")
                    
                    # Extract date filters from filters dict
                    date_from = filters.get('date_from')
                    date_to = filters.get('date_to')
                    
                    # Query search index - returns entityPKs (FILING#uuid or CONTRIBUTION#uuid)
                    entity_pks, search_last_key = query_search_index(
                        search_type=config['search_type'],
                        search_values=config['search_values'],
                        limit=GSI_QUERY_BATCH_SIZE,
                        exclusive_start_key=exclusive_start_key,
                        date_from=date_from,
                        date_to=date_to
                    )
                    
                    # Convert entityPKs to filing_ids (remove FILING# or CONTRIBUTION# prefix)
                    filing_ids = []
                    for entity_pk in entity_pks:
                        if entity_pk.startswith('FILING#'):
                            filing_id = entity_pk.replace('FILING#', '')
                            filing_ids.append(filing_id)
                        elif entity_pk.startswith('CONTRIBUTION#'):
                            filing_id = entity_pk.replace('CONTRIBUTION#', '')
                            filing_ids.append(filing_id)
                    
                    # Accumulate IDs across batches (union)
                    if unique_key in accumulated_gsi_results:
                        accumulated_gsi_results[unique_key]['filing_ids'] = accumulated_gsi_results[unique_key]['filing_ids'] | set(filing_ids)
                    else:
                        accumulated_gsi_results[unique_key] = {
                            'filing_ids': set(filing_ids),
                            'config': config,
                            'query_type': 'search_index'
                        }
                    
                    # Update pagination key for next iteration
                    query_pagination_keys[unique_key] = search_last_key
                    logger.info(f"Found {len(filing_ids)} filing IDs from search index for {config['search_type']} (has_more: {search_last_key is not None}, total accumulated: {len(accumulated_gsi_results[unique_key]['filing_ids'])})")
                    
                elif config.get('query_type') == 'parameter_filing_mapping':
                    # Use parameter-filing mapping query (legacy - kept for backward compatibility)
                    logger.info(f"Querying parameter-filing mappings for {config['parameter_type']} with values: {config['parameter_values']}")
                    
                    # Use pagination key from our tracking
                    exclusive_start_key = query_pagination_keys[unique_key]
                    
                    filing_ids, param_last_key = query_parameter_filing_mappings(
                        parameter_type=config['parameter_type'],
                        parameter_values=config['parameter_values'],
                        limit=GSI_QUERY_BATCH_SIZE,
                        exclusive_start_key=exclusive_start_key,
                        per_param_limit=GSI_QUERY_BATCH_SIZE
                    )
                    
                    # Accumulate IDs across batches (union)
                    if unique_key in accumulated_gsi_results:
                        accumulated_gsi_results[unique_key]['filing_ids'] = accumulated_gsi_results[unique_key]['filing_ids'] | set(filing_ids)
                    else:
                        accumulated_gsi_results[unique_key] = {
                            'filing_ids': set(filing_ids),
                            'config': config,
                            'query_type': 'parameter_filing_mapping'
                        }
                    
                    # Update pagination key for next iteration
                    query_pagination_keys[unique_key] = param_last_key
                    logger.info(f"Found {len(filing_ids)} filing IDs from parameter-filing mappings for {config['parameter_type']} (has_more: {param_last_key is not None}, total accumulated: {len(accumulated_gsi_results[unique_key]['filing_ids'])})")
                    
                else:
                    # Use GSI query
                    # On first batch, try case variations for name-based queries if original returns 0 results
                    current_hash_value = config['hash_value']
                    if batch_iteration == 1 and config['hash_key'] in ['client_name', 'registrant_name', 'lobbyist_name']:
                        # Test original value first
                        test_ids, _ = query_gsi_for_filing_ids(
                            index_name=config['index_name'],
                            hash_key_name=config['hash_key'],
                            hash_key_value=current_hash_value,
                            range_key_name=config.get('range_key'),
                            range_key_value=config.get('range_value'),
                            range_key_condition=config.get('range_condition'),
                            limit=1,
                            exclusive_start_key=None,
                            get_all=False
                        )
                        
                        found_match = len(test_ids) > 0
                        
                        # If original didn't work, try case variations
                        if not found_match:
                            original_value = str(current_hash_value)
                            variations = [
                                original_value.upper(),
                                original_value.lower(),
                                original_value.title(),
                                original_value.capitalize(),
                            ]
                            for variation in variations:
                                if variation != original_value:
                                    logger.info(f"Trying case variation for {config['hash_key']}: '{variation}'")
                                    test_ids, _ = query_gsi_for_filing_ids(
                                        index_name=config['index_name'],
                                        hash_key_name=config['hash_key'],
                                        hash_key_value=variation,
                                        range_key_name=config.get('range_key'),
                                        range_key_value=config.get('range_value'),
                                        range_key_condition=config.get('range_condition'),
                                        limit=1,
                                        exclusive_start_key=None,
                                        get_all=False
                                    )
                                    
                                    if len(test_ids) > 0:
                                        current_hash_value = variation
                                        config['hash_value'] = variation
                                        logger.info(f"Found results with case variation '{variation}' - using this for all queries")
                                        found_match = True
                                        break
                    
                    logger.info(f"Querying {config['index_name']} for {config['filter_key']}={current_hash_value}")
                    
                    # Use pagination key from our tracking
                    exclusive_start_key = query_pagination_keys[unique_key]
                    if exclusive_start_key and batch_iteration == 1 and fetch_next_batches:
                        logger.info(f"Using stored pagination key for GSI query (fetch_next_batches): {config['index_name']}")
                    elif exclusive_start_key:
                        logger.info(f"Using pagination key for GSI query (batch {batch_iteration}): {config['index_name']}")
                    
                    filing_ids, last_eval_key = query_gsi_for_filing_ids(
                        index_name=config['index_name'],
                        hash_key_name=config['hash_key'],
                        hash_key_value=current_hash_value,
                        range_key_name=config.get('range_key'),
                        range_key_value=config.get('range_value'),
                        range_key_condition=config.get('range_condition'),
                        limit=GSI_QUERY_BATCH_SIZE,
                        exclusive_start_key=exclusive_start_key,
                        get_all=False
                    )
                    
                    # Accumulate IDs across batches (union)
                    if unique_key in accumulated_gsi_results:
                        accumulated_gsi_results[unique_key]['filing_ids'] = accumulated_gsi_results[unique_key]['filing_ids'] | set(filing_ids)
                    else:
                        accumulated_gsi_results[unique_key] = {
                            'filing_ids': set(filing_ids),
                            'config': config,
                            'query_type': 'gsi'
                        }
                    
                    # Update pagination key for next iteration
                    query_pagination_keys[unique_key] = last_eval_key
                    logger.info(f"Found {len(filing_ids)} filing IDs from {config['index_name']} (has_more: {last_eval_key is not None}, total accumulated: {len(accumulated_gsi_results[unique_key]['filing_ids'])})")
            
            # Quick intersection check to see if we have enough items
            # Group results by category for intersection computation
            # Exclude amount filters from ID-level intersection (they're applied in Python)
            # Date range filters should be unioned first (OR logic), then intersected
            temp_general_text_search_results = {}
            temp_advanced_search_results = {}
            temp_other_filters_results = {}
            temp_amount_filters_results = {}
            temp_date_range_filters_results = {}
            
            for key, result in accumulated_gsi_results.items():
                config = result['config']
                if config.get('from_general_text_search', False):
                    temp_general_text_search_results[key] = result
                elif config.get('is_advanced_search', False):
                    category = config.get('category', key)
                    if category not in temp_advanced_search_results:
                        temp_advanced_search_results[category] = []
                    temp_advanced_search_results[category].append(result)
                elif config.get('filter_key') == 'amount':
                    # Amount filters - don't include in ID-level intersection
                    temp_amount_filters_results[key] = result
                elif config.get('filter_key') == 'date_range':
                    # Date range filters - union first, then intersect
                    temp_date_range_filters_results[key] = result
                else:
                    temp_other_filters_results[key] = result
            
            # Compute quick intersection
            temp_intersection = None
            if temp_advanced_search_results:
                category_unions = {}
                for category, results in temp_advanced_search_results.items():
                    category_union = set()
                    for result in results:
                        category_union = category_union | result['filing_ids']
                    category_unions[category] = category_union
                
                category_list = list(category_unions.keys())
                if category_list:
                    temp_intersection = category_unions[category_list[0]]
                    for category in category_list[1:]:
                        temp_intersection = temp_intersection & category_unions[category]
            
            if temp_general_text_search_results:
                general_text_union = set()
                for key, result in temp_general_text_search_results.items():
                    general_text_union = general_text_union | result['filing_ids']
                if temp_intersection is not None:
                    temp_intersection = temp_intersection & general_text_union
                else:
                    temp_intersection = general_text_union
            
            # Union date_range filters first (OR logic - a filing can only be in one year)
            # BUT: If general_text_search or advanced_search queries already have date filtering,
            # we should NOT intersect with date_range because the date filtering is already applied
            if temp_date_range_filters_results:
                # Check if any general_text_search or advanced_search query has date filtering
                has_date_in_queries = False
                for key, result in temp_general_text_search_results.items():
                    config = result.get('config', {})
                    if config.get('range_key') == 'dt_posted' and config.get('range_value'):
                        has_date_in_queries = True
                        break
                if not has_date_in_queries:
                    for category, results in temp_advanced_search_results.items():
                        for result in results:
                            config = result.get('config', {})
                            if config.get('range_key') == 'dt_posted' and config.get('range_value'):
                                has_date_in_queries = True
                                break
                        if has_date_in_queries:
                            break
                
                if not has_date_in_queries:
                    # Only intersect with date_range if queries don't already have date filtering
                    date_range_union = set()
                    for key, result in temp_date_range_filters_results.items():
                        date_range_union = date_range_union | result['filing_ids']
                    # Then intersect the date_range union with other filters
                    if temp_intersection is not None:
                        temp_intersection = temp_intersection & date_range_union
                    else:
                        temp_intersection = date_range_union
                else:
                    # Date filtering already applied in queries, skip date_range intersection
                    logger.info(f"Skipping date_range intersection in temp check - date filtering already applied in queries")
            
            if temp_other_filters_results:
                for key, result in temp_other_filters_results.items():
                    if temp_intersection is not None:
                        temp_intersection = temp_intersection & result['filing_ids']
                    else:
                        temp_intersection = result['filing_ids']
            
            intersection_size = len(temp_intersection) if temp_intersection else 0
            logger.info(f"After batch {batch_iteration}: intersection size = {intersection_size}")
            
            # Check if we have enough items in intersection or all queries exhausted
            if all_queries_exhausted:
                logger.info(f"All queries exhausted after batch {batch_iteration}")
                break
            
            # Continue fetching batches until intersection is complete
            # No limit - fetch all items
            
            # Early termination: If intersection is 0 and ALL queries are exhausted,
            # we should stop because the intersection will remain 0
            # However, if some queries still have more results, we should continue paginating
            # to find the intersection (e.g., if ClientPostedDateIndex is exhausted with 14 IDs,
            # but ItemTypePostedDateIndex has more, we should continue to find those 14 IDs)
            if intersection_size == 0:
                exhausted_queries_with_results = [
                    key for key, result in accumulated_gsi_results.items()
                    if query_pagination_keys.get(key) is None and len(result['filing_ids']) > 0
                ]
                # Only stop early if ALL queries are exhausted (not just some)
                all_queries_exhausted_check = all(
                    query_pagination_keys.get(key) is None
                    for key in query_pagination_keys.keys()
                )
                if exhausted_queries_with_results and all_queries_exhausted_check:
                    # For amount filters, don't stop early - we need to apply Python filtering
                    # Amount buckets are ranges, so intersection at ID level may be 0 but
                    # Python filtering will find matches
                    if not has_amount_filters:
                        logger.warning(f"Intersection is 0 and all queries are exhausted. "
                                     f"{len(exhausted_queries_with_results)} exhausted query/queries have results, "
                                     f"but they don't overlap. Stopping pagination.")
                        logger.info(f"Exhausted queries with results: {exhausted_queries_with_results}")
                        # Log the sizes for debugging
                        for key in exhausted_queries_with_results:
                            logger.info(f"  {key}: {len(accumulated_gsi_results[key]['filing_ids'])} IDs")
                        break
                    else:
                        # For amount filters, continue - we'll apply Python filtering
                        logger.info(f"Intersection is 0 but amount filters present - continuing to apply Python filters")
                elif exhausted_queries_with_results:
                    # Some queries are exhausted but others have more - continue paginating
                    logger.info(f"Intersection is 0 after batch {batch_iteration}, but some queries still have more results. "
                              f"Continuing pagination to find intersection. "
                              f"Exhausted queries with results: {exhausted_queries_with_results}")
            
            # Check if any query has more results
            has_more_results = any(
                query_pagination_keys[key] is not None 
                for key in query_pagination_keys.keys()
            )
            
            if not has_more_results:
                logger.info(f"All queries exhausted after batch {batch_iteration}")
                break
        
        # Use accumulated results for intersection computation
        gsi_results = accumulated_gsi_results
        
        # Store the final state of query_pagination_keys for has_more determination
        # This reflects whether queries are exhausted after all batch iterations
        final_query_pagination_keys = query_pagination_keys.copy() if 'query_pagination_keys' in locals() else {}
        
        # Separate filters into five groups:
        # 1. general_text_search_fields (OR logic - union all)
        # 2. advanced_search_fields (AND across categories, OR within each category)
        # 3. amount_filters (special handling - don't intersect at ID level, apply in Python)
        # 4. date_range_filters (OR logic - union all years in the range)
        # 5. other_filters (AND logic - intersection)
        general_text_search_results = {}
        advanced_search_results = {}  # Grouped by category
        amount_filters_results = {}  # Amount filters - don't intersect at ID level
        date_range_filters_results = {}  # Date range filters - union all years
        other_filters_results = {}
        
        for key, result in gsi_results.items():
            config = result['config']
            if config.get('from_general_text_search', False):
                general_text_search_results[key] = result
            elif config.get('is_advanced_search', False):
                category = config.get('category', key)
                if category not in advanced_search_results:
                    advanced_search_results[category] = []
                advanced_search_results[category].append(result)
            elif config.get('filter_key') == 'amount':
                # Amount filters need special handling - don't intersect at ID level
                # Use as source and apply exact filtering in Python
                amount_filters_results[key] = result
            elif config.get('filter_key') == 'date_range':
                # Date range filters - union all years (OR logic)
                date_range_filters_results[key] = result
            else:
                other_filters_results[key] = result
        
        # Step 1: Union all general_text_search_fields filters (OR logic)
        general_text_search_union = None
        if general_text_search_results:
            general_text_search_union = set()
            for key, result in general_text_search_results.items():
                general_text_search_union = general_text_search_union | result['filing_ids']
            logger.info(f"Union of general_text_search_fields filters: {len(general_text_search_union)} filing IDs (OR logic)")
        
        # Step 1.5: Union all date_range filters (OR logic - union all years in the range)
        date_range_union = None
        if date_range_filters_results:
            date_range_union = set()
            for key, result in date_range_filters_results.items():
                date_range_union = date_range_union | result['filing_ids']
            logger.info(f"Union of date_range filters: {len(date_range_union)} filing IDs (OR logic - all years in range)")
        
        # Step 2: For advanced search fields, union within each category (OR), then intersect across categories (AND)
        advanced_search_intersection = None
        if advanced_search_results:
            # Union within each category (OR logic within category)
            category_unions = {}
            for category, results in advanced_search_results.items():
                category_union = set()
                for result in results:
                    category_union = category_union | result['filing_ids']
                category_unions[category] = category_union
                logger.info(f"Union of {category} filters: {len(category_union)} filing IDs (OR within category)")
            
            # Intersect across categories (AND logic across categories)
            category_list = list(category_unions.keys())
            if category_list:
                advanced_search_intersection = category_unions[category_list[0]]
                for category in category_list[1:]:
                    advanced_search_intersection = advanced_search_intersection & category_unions[category]
                logger.info(f"Intersection of advanced search categories: {len(advanced_search_intersection)} filing IDs (AND across categories)")
        
        # Step 3: Combine all groups
        # For amount filters combined with other filters, use the non-amount filter as source
        # (amount buckets are ranges, so we apply exact filtering in Python)
        # For amount-only queries, use amount filter as source
        # Track which filter keys are the source for has_more determination
        source_filter_keys = set()  # Track which filter keys contribute to source_filing_ids_set
        
        if amount_filters_results and (general_text_search_union is not None or advanced_search_intersection is not None or other_filters_results):
            # When amount filters are combined with other filters, use the non-amount filter as source
            # and apply amount filter in Python (buckets are ranges, so ID-level intersection doesn't work)
            # Priority: advanced_search_intersection > general_text_search_union > other_filters_results
            if advanced_search_intersection is not None:
                source_filing_ids_set = advanced_search_intersection
                # Track all keys that contributed to advanced_search_intersection
                for category, results in advanced_search_results.items():
                    for result in results:
                        # Find the key in gsi_results that matches this result
                        for key, gsi_result in gsi_results.items():
                            if gsi_result == result:
                                source_filter_keys.add(key)
                logger.info(f"Starting with advanced search intersection (will apply amount filter in Python): {len(source_filing_ids_set)} filing IDs")
            elif general_text_search_union is not None:
                source_filing_ids_set = general_text_search_union
                # Track all keys that contributed to general_text_search_union
                for key in general_text_search_results.keys():
                    source_filter_keys.add(key)
                logger.info(f"Starting with general_text_search union (will apply amount filter in Python): {len(source_filing_ids_set)} filing IDs")
            elif other_filters_results:
                shortest_key = min(other_filters_results.keys(), key=lambda k: len(other_filters_results[k]['filing_ids']))
                source_filing_ids_set = other_filters_results[shortest_key]['filing_ids']
                source_filter_keys.add(shortest_key)
                logger.info(f"Starting with shortest other filter (will apply amount filter in Python): {len(source_filing_ids_set)} filing IDs")
        elif amount_filters_results:
            # Amount-only query - use amount filter as source
            if len(amount_filters_results) == 1:
                amount_key = list(amount_filters_results.keys())[0]
                source_filing_ids_set = amount_filters_results[amount_key]['filing_ids']
                source_filter_keys.add(amount_key)
                logger.info(f"Starting with amount filter: {len(source_filing_ids_set)} filing IDs")
            else:
                # Union all amount filter results (multiple buckets)
                source_filing_ids_set = set()
                for key, result in amount_filters_results.items():
                    source_filing_ids_set = source_filing_ids_set | result['filing_ids']
                    source_filter_keys.add(key)
                logger.info(f"Starting with amount filters union: {len(source_filing_ids_set)} filing IDs")
        elif advanced_search_intersection is not None:
            source_filing_ids_set = advanced_search_intersection
            # Track all keys that contributed to advanced_search_intersection
            for category, results in advanced_search_results.items():
                for result in results:
                    # Find the key in gsi_results that matches this result
                    for key, gsi_result in gsi_results.items():
                        if gsi_result == result:
                            source_filter_keys.add(key)
            logger.info(f"Starting with advanced search intersection: {len(source_filing_ids_set)} filing IDs")
        elif general_text_search_union is not None:
            source_filing_ids_set = general_text_search_union
            # Track all keys that contributed to general_text_search_union
            for key in general_text_search_results.keys():
                source_filter_keys.add(key)
            logger.info(f"Starting with general_text_search union: {len(source_filing_ids_set)} filing IDs")
        elif other_filters_results:
            shortest_key = min(other_filters_results.keys(), key=lambda k: len(other_filters_results[k]['filing_ids']))
            source_filing_ids_set = other_filters_results[shortest_key]['filing_ids']
            source_filter_keys.add(shortest_key)
            logger.info(f"Starting with shortest other filter: {len(source_filing_ids_set)} filing IDs")
        else:
            source_filing_ids_set = set()
            logger.warning("No queryable filters found - empty result set")
        
        # Intersect with general_text_search_fields union (if present and not using amount as source)
        if not amount_filters_results:
            if general_text_search_union is not None and advanced_search_intersection is not None:
                source_filing_ids_set = source_filing_ids_set & general_text_search_union
                logger.info(f"After intersecting with general_text_search union: {len(source_filing_ids_set)} filing IDs")
            elif general_text_search_union is not None and advanced_search_intersection is None:
                # Only general_text_search_fields - use union directly
                source_filing_ids_set = general_text_search_union
                logger.info(f"Only general_text_search_fields - using union: {len(source_filing_ids_set)} filing IDs")
        
        # Intersect with date_range union if present (date ranges span multiple years, so union first, then intersect)
        # BUT: If general_text_search or advanced_search queries already have date filtering (range_key with date_from),
        # we should NOT intersect with date_range_union because the date filtering is already applied in those queries
        # and intersecting would incorrectly exclude valid results
        has_date_filtering_in_queries = False
        if general_text_search_results:
            # Check if any general_text_search query has date filtering
            for key, result in general_text_search_results.items():
                config = result.get('config', {})
                if config.get('range_key') == 'dt_posted' and config.get('range_value'):
                    has_date_filtering_in_queries = True
                    break
        if not has_date_filtering_in_queries and advanced_search_results:
            # Check if any advanced_search query has date filtering
            for category, results in advanced_search_results.items():
                for result in results:
                    config = result.get('config', {})
                    if config.get('range_key') == 'dt_posted' and config.get('range_value'):
                        has_date_filtering_in_queries = True
                        break
                if has_date_filtering_in_queries:
                    break
        
        if date_range_union is not None and not has_date_filtering_in_queries:
            # Only intersect with date_range_union if queries don't already have date filtering
            source_filing_ids_set = source_filing_ids_set & date_range_union
            for key in date_range_filters_results.keys():
                source_filter_keys.add(key)
            logger.info(f"After intersecting with date_range union: {len(source_filing_ids_set)} filing IDs")
        elif date_range_union is not None and has_date_filtering_in_queries:
            # Date filtering already applied in queries, skip date_range intersection
            # But still track date_range keys for has_more determination
            for key in date_range_filters_results.keys():
                source_filter_keys.add(key)
            logger.info(f"Skipping date_range intersection - date filtering already applied in queries (source: {len(source_filing_ids_set)} filing IDs)")
        
        # Intersect with other filters (item_type, etc.) - but NOT amount filters or date_range
        # (amount filters are applied in Python, date_range is already handled above)
        if other_filters_results:
            for key, result in other_filters_results.items():
                source_filing_ids_set = source_filing_ids_set & result['filing_ids']
                # Track keys that contribute to the final source (for has_more determination)
                source_filter_keys.add(key)
            logger.info(f"After intersecting with {len(other_filters_results)} other filters: {len(source_filing_ids_set)} filing IDs")
        
        # If using non-amount filters as source but have amount filters, we've already
        # set the source correctly above - amount filters will be applied in Python
        
        source_filing_ids = list(source_filing_ids_set)
        logger.info(f"Initial intersection: {len(source_filing_ids)} filing IDs after applying OR logic for general_text_search_fields, OR within/AND across for advanced search, and AND for other filters")
        
        # Remove all queryable filters from filters
        # For general_text_search_fields, we've already queried all terms via separate query configs
        # and unioned the results, so we can remove them from remaining_filters
        remaining_filters = filters.copy()
        
        # Track which advanced search categories we've processed
        processed_advanced_categories = set()
        
        # Track which general_text_search_fields we've processed (to remove them all at once)
        processed_gtsf_fields = set()
        
        for config in query_configs:
            filter_key = config['filter_key']
            is_from_general_text_search = config.get('from_general_text_search', False)
            is_advanced_search = config.get('is_advanced_search', False)
            category = config.get('category')
            
            # For general_text_search_fields filters, mark them as processed
            # We now create separate query configs for EACH term in general_text_search_fields
            # and union all results, so all terms are already handled by the queries
            if is_from_general_text_search:
                # Map filter_key to general_text_search_fields key
                gtsf_key = None
                if filter_key == 'registrant_name':
                    gtsf_key = 'registrant'
                elif filter_key == 'client_name':
                    gtsf_key = 'client'
                elif filter_key in ['lobbyist', 'pac']:
                    gtsf_key = filter_key
                
                if gtsf_key:
                    processed_gtsf_fields.add(gtsf_key)
            
            # For advanced search fields, handle based on query type
            elif is_advanced_search and category:
                # Only process each category once (even if we have multiple query configs for the same category)
                if category not in processed_advanced_categories:
                    processed_advanced_categories.add(category)
                    # For parameter-filing mappings (lobbyist_name, foreign_entity_name), remove since they already have exact matches
                    if config.get('query_type') == 'parameter_filing_mapping':
                        if filter_key in remaining_filters:
                            del remaining_filters[filter_key]
                    # For GSI queries (registrant_name, client_name), keep for Python filtering to ensure exact matching
                    # (We queried all values via separate GSI queries and unioned them, but keep for exact name matching)
                    # The filter will remain in remaining_filters for Python filtering
            
            # For amount filters, keep in remaining_filters for Python filtering (buckets are ranges)
            elif filter_key == 'amount':
                # Keep amount_min and amount_max for Python filtering to ensure exact matching
                # (GSI buckets are ranges, so we need to filter by exact amount)
                pass  # Don't remove - we need them for Python filtering
            
            # For other filters (date, item_type, state, etc.), remove them since they're fully applied
            elif not is_from_general_text_search and not is_advanced_search:
                if filter_key in remaining_filters:
                    if isinstance(remaining_filters[filter_key], list):
                        remaining_filters[filter_key] = remaining_filters[filter_key][1:]
                        if not remaining_filters[filter_key]:
                            del remaining_filters[filter_key]
                    else:
                        del remaining_filters[filter_key]
        
        # Remove all processed general_text_search_fields at once
        if processed_gtsf_fields and 'general_text_search_fields' in remaining_filters:
            gtsf = remaining_filters['general_text_search_fields']
            for gtsf_key in processed_gtsf_fields:
                if gtsf_key in gtsf:
                    del gtsf[gtsf_key]
            # If general_text_search_fields is now empty or only has false/empty values, remove it entirely
            if not gtsf or not any(v for v in gtsf.values() if v):
                del remaining_filters['general_text_search_fields']
        
        logger.info(f"Remaining filters to apply in Python: {list(remaining_filters.keys())}")
        
        # For multi-query intersection, limit to 125 items per batch (DEFAULT_BATCH_SIZE)
        # Use union offset pagination consistently to avoid switching between pagination methods
        DEFAULT_BATCH_SIZE = 125  # Default batch size (matches contracts lambda)
        all_matching_items = []
        next_offset = None  # Initialize next_offset
        
        if source_filing_ids:
            # Fetch full items in batches
            # Since IDs could be from either FILING or CONTRIBUTION items, try both key formats
            batch_size = 50  # Reduced to 50 since we're trying both formats (effectively 100 keys)
            dynamodb_client = boto3.client('dynamodb')
            
            # Start from union_offset if provided (for pagination)
            start_index = union_offset if union_offset is not None else 0
            last_processed_index = start_index
            
            # Fetch and filter items in batches until we have DEFAULT_BATCH_SIZE filtered items or run out of IDs
            filtered_items = []
            i = start_index
            while i < len(source_filing_ids) and len(filtered_items) < DEFAULT_BATCH_SIZE:
                batch_ids = source_filing_ids[i:i + batch_size]
                last_processed_index = i + len(batch_ids)  # Track the last index we processed
                
                # Try both FILING# and CONTRIBUTION# key formats for each ID
                keys = []
                for fid in batch_ids:
                    keys.append({'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}})
                    keys.append({'PK': {'S': f'CONTRIBUTION#{fid}'}, 'SK': {'S': f'CONTRIBUTION#{fid}'}})
                
                request_items = {
                    FILINGS_TABLE_NAME: {
                        'Keys': keys
                        # No ProjectionExpression - returns ALL attributes (complete row including PII)
                    }
                }
                batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
                deserializer = TypeDeserializer()
                
                # Filter items as we fetch them
                for item in batch_items:
                    # Deserialize all fields - no filtering, returns complete row
                    converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                    if apply_python_filter(converted_item, remaining_filters):
                        filtered_items.append(converted_item)
                        # Stop if we've reached the batch size limit
                        if len(filtered_items) >= DEFAULT_BATCH_SIZE:
                            break
                
                i += batch_size
                
                # Stop if we've reached the batch size limit
                if len(filtered_items) >= DEFAULT_BATCH_SIZE:
                    break
            
            all_matching_items = filtered_items[:DEFAULT_BATCH_SIZE]  # Limit to DEFAULT_BATCH_SIZE
            logger.info(f"Fetched and filtered {len(all_matching_items)} items (processed up to index {last_processed_index} of {len(source_filing_ids)})")
            
            # Set next_offset for pagination
            if last_processed_index < len(source_filing_ids):
                # More IDs to process in current intersection
                next_offset = last_processed_index
            else:
                # We've processed all IDs in the current intersection
                # Check if any queries have more results to fetch
                next_offset = None  # Will be set below if queries have more results
        else:
            next_offset = None
        
        # Use the collected items (limited to DEFAULT_BATCH_SIZE)
        items = all_matching_items
        
        logger.info(f"Multi-GSI intersection complete: {len(items)} items matching all filters")
        method = 'multi_gsi_intersection'
        index_name = f"{len(query_configs)}_queries"
        
        # Convert Decimal to float for JSON serialization
        results = [convert_decimal_to_float(item) for item in items]
        
        # Check if we have a search index or parameter-filing mapping query with pagination support
        # If so, use its pagination key for "load more" functionality
        serializable_last_key = None
        has_more = False
        
        # For multi-query intersection, always use union offset pagination for consistency
        # This ensures we paginate through the intersected results consistently
        # Individual query pagination keys cause inconsistent results when queries are intersected
        if union_offset is not None:
            # We're continuing union offset pagination - use it consistently
            current_offset = union_offset
            has_more = next_offset is not None and next_offset < len(source_filing_ids)
            if has_more:
                # Return union offset pagination key
                serializable_last_key = {
                    'offset': next_offset,
                    'query_type': 'union_offset',
                    'total_ids': len(source_filing_ids)
                }
                logger.info(f"Continuing union offset pagination - next offset: {next_offset}, total IDs: {len(source_filing_ids)}")
            else:
                # Check if we need to fetch more batches from queries to get more items in intersection
                # If we have more results available from SOURCE queries, we should continue
                # CRITICAL: Use final_query_pagination_keys which reflects the current state after all batches
                # Only check source filter keys, not amount filters (when amount is combined with other filters)
                has_more = False
                query_pagination_keys_for_token = {}  # Store pagination keys for each query
                
                # Check final_query_pagination_keys to see if SOURCE queries still have more results
                for key, result in gsi_results.items():
                    # Only check if this is a source filter key
                    # If amount filters are combined with other filters, exclude amount filters from has_more check
                    config = result['config']
                    is_amount_filter = config.get('filter_key') == 'amount'
                    is_source_filter = key in source_filter_keys
                    
                    # Skip amount filters when they're not the source (i.e., when combined with other filters)
                    if is_amount_filter and not is_source_filter:
                        continue
                    
                    # Check if this query has a pagination key in the final state
                    current_pagination_key = final_query_pagination_keys.get(key) if final_query_pagination_keys else None
                    
                    # If not in final_query_pagination_keys, check result.get('last_eval_key') as fallback
                    # (for cases where query_pagination_keys wasn't used)
                    if current_pagination_key is None and result.get('last_eval_key'):
                        current_pagination_key = result['last_eval_key']
                    
                    if current_pagination_key:
                        has_more = True
                        # Store the pagination key for this query
                        if result['query_type'] == 'search_index':
                            query_pagination_keys_for_token[key] = {
                                'type': 'search_index',
                                'key': convert_decimal_to_float(current_pagination_key),
                                'search_type': config['search_type'],
                                'filter_key': config['filter_key']
                            }
                        elif result['query_type'] == 'gsi':
                            query_pagination_keys_for_token[key] = {
                                'type': 'gsi',
                                'key': convert_decimal_to_float(current_pagination_key),
                                'index_name': config['index_name'],
                                'hash_key': config['hash_key'],
                                'hash_value': config['hash_value']
                            }
                
                # CRITICAL FIX: If all queries are exhausted and we have 0 results, set has_more to False
                if not has_more and len(results) == 0:
                    has_more = False
                    logger.info(f"All queries exhausted and 0 results - setting has_more=False")
                elif has_more:
                    # We have more results from queries, but we've exhausted current intersection
                    # Return union offset with query pagination keys to fetch next batches
                    serializable_last_key = {
                        'offset': len(source_filing_ids),  # Signal to fetch next batches
                        'query_type': 'union_offset',
                        'total_ids': len(source_filing_ids),
                        'fetch_next_batches': True,  # Flag to fetch next batches from queries
                        'query_keys': query_pagination_keys_for_token  # Store pagination keys for each query
                    }
                    logger.info(f"Exhausted current intersection ({len(source_filing_ids)} items), but queries have more - will fetch next batches")
        else:
            # First page - for multi-query, use union offset pagination from start
            # Check if we have more items to fetch from the current intersection
            current_offset = 0
            has_more = next_offset is not None and next_offset < len(source_filing_ids)
            if has_more:
                # Return union offset pagination key
                serializable_last_key = {
                    'offset': next_offset,
                    'query_type': 'union_offset',
                    'total_ids': len(source_filing_ids)
                }
                logger.info(f"Union offset pagination - next offset: {next_offset}, total IDs: {len(source_filing_ids)}")
            else:
                # Check if SOURCE queries have more results to fetch
                # CRITICAL: Use final_query_pagination_keys which reflects the current state after all batches
                # Only check source filter keys, not amount filters (when amount is combined with other filters)
                has_more = False
                query_pagination_keys_for_token = {}  # Store pagination keys for each query
                
                # Check final_query_pagination_keys to see if SOURCE queries still have more results
                for key, result in gsi_results.items():
                    # Only check if this is a source filter key
                    # If amount filters are combined with other filters, exclude amount filters from has_more check
                    config = result['config']
                    is_amount_filter = config.get('filter_key') == 'amount'
                    is_source_filter = key in source_filter_keys
                    
                    # Skip amount filters when they're not the source (i.e., when combined with other filters)
                    if is_amount_filter and not is_source_filter:
                        continue
                    
                    # Check if this query has a pagination key in the final state
                    current_pagination_key = final_query_pagination_keys.get(key) if final_query_pagination_keys else None
                    
                    # If not in final_query_pagination_keys, check result.get('last_eval_key') as fallback
                    # (for cases where query_pagination_keys wasn't used)
                    if current_pagination_key is None and result.get('last_eval_key'):
                        current_pagination_key = result['last_eval_key']
                    
                    if current_pagination_key:
                        has_more = True
                        # Store the pagination key for this query
                        if result['query_type'] == 'search_index':
                            query_pagination_keys_for_token[key] = {
                                'type': 'search_index',
                                'key': convert_decimal_to_float(current_pagination_key),
                                'search_type': config['search_type'],
                                'filter_key': config['filter_key']
                            }
                        elif result['query_type'] == 'gsi':
                            query_pagination_keys_for_token[key] = {
                                'type': 'gsi',
                                'key': convert_decimal_to_float(current_pagination_key),
                                'index_name': config['index_name'],
                                'hash_key': config['hash_key'],
                                'hash_value': config['hash_value']
                            }
                
                # CRITICAL FIX: If all queries are exhausted and we have 0 results, set has_more to False
                if not has_more and len(results) == 0:
                    has_more = False
                    logger.info(f"All queries exhausted and 0 results - setting has_more=False")
                elif has_more:
                    # We have more results from queries, but we've exhausted current intersection
                    # Return union offset with query pagination keys to fetch next batches
                    serializable_last_key = {
                        'offset': len(source_filing_ids),  # Signal to fetch next batches
                        'query_type': 'union_offset',
                        'total_ids': len(source_filing_ids),
                        'fetch_next_batches': True,  # Flag to fetch next batches from queries
                        'query_keys': query_pagination_keys_for_token  # Store pagination keys for each query
                    }
                    logger.info(f"Exhausted current intersection ({len(source_filing_ids)} items), but queries have more - will fetch next batches")
                else:
                    has_more = len(source_filing_ids) > len(items)
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': has_more,
            'last_evaluated_key': serializable_last_key,  # Use parameter-filing mapping pagination key if available
            'method': method,
            'index_used': index_name
        }
    
    # Fall back to single GSI query, search index query, parameter-filing mapping query, or scan
    elif len(query_configs) == 1:
        config = query_configs[0]
        
        # Check if this is a search index query
        if config.get('query_type') == 'search_index':
            logger.info(f"Using search index query: {config['search_type']} with values: {config['search_values']}")
            
            # Extract pagination token if present (for "load more" functionality)
            search_index_last_key = None
            if last_evaluated_key and isinstance(last_evaluated_key, dict):
                # Check if this is a search index pagination token
                if 'search_index_key' in last_evaluated_key:
                    search_index_last_key = last_evaluated_key.get('search_index_key')
            
            # Extract date filters
            date_from = filters.get('date_from')
            date_to = filters.get('date_to')
            
            # Query search index to get entity PKs (with pagination support)
            batch_size = 125  # Default batch size (matches contracts lambda)
            entity_pks, search_index_key = query_search_index(
                search_type=config['search_type'],
                search_values=config['search_values'],
                limit=batch_size,
                exclusive_start_key=search_index_last_key,
                date_from=date_from,
                date_to=date_to
            )
            
            # Convert entityPKs to filing_ids (remove FILING# or CONTRIBUTION# prefix)
            filing_ids = []
            for entity_pk in entity_pks:
                if entity_pk.startswith('FILING#'):
                    filing_id = entity_pk.replace('FILING#', '')
                    filing_ids.append(filing_id)
                elif entity_pk.startswith('CONTRIBUTION#'):
                    filing_id = entity_pk.replace('CONTRIBUTION#', '')
                    filing_ids.append(filing_id)
            
            if not filing_ids:
                logger.info("Search index query returned no filing IDs")
                return {
                    'success': True,
                    'results': [],
                    'count': 0,
                    'has_more': False,
                    'last_evaluated_key': None,
                    'method': 'search_index',
                    'search_type': config['search_type']
                }
            
            logger.info(f"Found {len(filing_ids)} filing IDs from search index")
            
            # Fetch full items using efficient batch_get_item
            # Note: No ProjectionExpression is used, so ALL attributes are returned (including PII)
            items = []
            dynamodb_client = boto3.client('dynamodb')
            
            # Process in batches of 50 (reduced since we try both FILING and CONTRIBUTION formats)
            for i in range(0, len(filing_ids), 50):
                batch_ids = filing_ids[i:i + 50]
                # Try both FILING# and CONTRIBUTION# key formats for each ID
                keys = []
                for fid in batch_ids:
                    keys.append({'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}})
                    keys.append({'PK': {'S': f'CONTRIBUTION#{fid}'}, 'SK': {'S': f'CONTRIBUTION#{fid}'}})
                request_items = {
                    FILINGS_TABLE_NAME: {
                        'Keys': keys
                        # No ProjectionExpression - returns all attributes
                    }
                }
                batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
                deserializer = TypeDeserializer()
                for item in batch_items:
                    # Deserialize all fields - no filtering, returns complete row
                    converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                    items.append(converted_item)
            
            logger.info(f"Fetched {len(items)} full items from DynamoDB using batch_get_item")
            
            # Apply remaining filters
            remaining_filters = filters.copy()
            if config['filter_key'] in remaining_filters:
                if isinstance(remaining_filters[config['filter_key']], list):
                    remaining_filters[config['filter_key']] = remaining_filters[config['filter_key']][1:]
                    if not remaining_filters[config['filter_key']]:
                        del remaining_filters[config['filter_key']]
                else:
                    del remaining_filters[config['filter_key']]
            
            # For search index queries, remove the corresponding filter from general_text_search_fields
            # since the search index already filtered for us - we should trust the search index results
            if config.get('query_type') == 'search_index':
                # Remove the search type from general_text_search_fields
                if 'general_text_search_fields' in remaining_filters:
                    gtsf = remaining_filters['general_text_search_fields']
                    # Map search_type to general_text_search_fields key
                    search_type_to_key = {
                        'PAC': 'pac',
                        'LOBBYIST': 'lobbyist',
                        'REGISTRANT': 'registrant',
                        'CLIENT': 'client',
                        'FOREIGN_COUNTRY': 'foreign'
                    }
                    filter_key = search_type_to_key.get(config['search_type'])
                    if filter_key and filter_key in gtsf:
                        # Remove this filter since search index already handled it
                        logger.info(f"Removing {filter_key} filter from general_text_search_fields (search index already filtered)")
                        if isinstance(gtsf[filter_key], list):
                            gtsf[filter_key] = gtsf[filter_key][1:]
                            if not gtsf[filter_key]:
                                del gtsf[filter_key]
                        else:
                            del gtsf[filter_key]
                    if not gtsf:
                        del remaining_filters['general_text_search_fields']
            else:
                # For GSI queries, also remove from general_text_search_fields if present
                if 'general_text_search_fields' in remaining_filters:
                    gtsf = remaining_filters['general_text_search_fields']
                    if config.get('filter_key') and config['filter_key'] in gtsf:
                        if isinstance(gtsf[config['filter_key']], list):
                            gtsf[config['filter_key']] = gtsf[config['filter_key']][1:]
                            if not gtsf[config['filter_key']]:
                                del gtsf[config['filter_key']]
                        else:
                            del gtsf[config['filter_key']]
                    if not gtsf:
                        del remaining_filters['general_text_search_fields']
            
            filtered_items = []
            logger.info(f"Applying Python filters to {len(items)} items. Remaining filters: {remaining_filters}")
            for idx, item in enumerate(items):
                passed = apply_python_filter(item, remaining_filters)
                if passed:
                    filtered_items.append(item)
                else:
                    # Log why item was filtered out for debugging (only log first few to avoid spam)
                    if idx < 3:
                        logger.info(f"Item {idx+1} filtered out: filing_id={item.get('filing_id', 'N/A')}, client_name={item.get('client_name', 'N/A')}, amount_reported={item.get('amount_reported', 0)}")
            
            logger.info(f"After Python filtering: {len(filtered_items)} items passed filters out of {len(items)} total")
            results = [convert_decimal_to_float(item) for item in filtered_items]
            
            # Prepare pagination token for "load more" functionality
            # Store the search index key so we can continue pagination
            serializable_last_key = None
            if search_index_key:
                try:
                    # Store both the search index key and filter info for continuation
                    serializable_last_key = {
                        'search_index_key': convert_decimal_to_float(search_index_key),
                        'search_type': config['search_type'],
                        'filter_key': config['filter_key'],
                        'query_type': 'search_index'
                    }
                except Exception as e:
                    logger.warning(f"Error converting search index key: {e}")
                    serializable_last_key = None
            
            return {
                'success': True,
                'results': results,
                'count': len(results),
                'has_more': search_index_key is not None,  # More results available if we have a pagination key
                'last_evaluated_key': serializable_last_key,
                'method': 'search_index',
                'search_type': config['search_type']
            }
        
        # Check if this is a parameter-filing mapping query (legacy)
        elif config.get('query_type') == 'parameter_filing_mapping':
            logger.info(f"Using parameter-filing mapping query: {config['parameter_type']} with values: {config['parameter_values']}")
            
            # Extract pagination token if present (for "load more" functionality)
            param_mapping_last_key = None
            if last_evaluated_key and isinstance(last_evaluated_key, dict):
                # Check if this is a parameter-filing mapping pagination token
                if 'parameter_mapping_key' in last_evaluated_key:
                    param_mapping_last_key = last_evaluated_key.get('parameter_mapping_key')
            
            # Query parameter-filing mappings to get filing IDs (with pagination support)
            # Use a reasonable batch size for pagination - fetch enough to account for filtering
            # but not too many to avoid long wait times
            batch_size = 125  # Default batch size (matches contracts lambda)
            filing_ids, param_mapping_key = query_parameter_filing_mappings(
                parameter_type=config['parameter_type'],
                parameter_values=config['parameter_values'],
                limit=batch_size,
                exclusive_start_key=param_mapping_last_key,
                per_param_limit=batch_size
            )
            
            if not filing_ids:
                logger.info("Parameter-filing mapping query returned no filing IDs")
                return {
                    'success': True,
                    'results': [],
                    'count': 0,
                    'has_more': False,
                    'last_evaluated_key': None,
                    'method': 'parameter_filing_mapping',
                    'parameter_type': config['parameter_type']
                }
            
            logger.info(f"Found {len(filing_ids)} filing IDs from parameter-filing mappings")
            
            # Fetch full items using efficient batch_get_item
            # Note: No ProjectionExpression is used, so ALL attributes are returned (including PII like addresses, phone numbers, etc.)
            items = []
            dynamodb_client = boto3.client('dynamodb')
            
            # Process in batches of 50 (reduced since we try both FILING and CONTRIBUTION formats)
            # Parameter-filing mappings typically return FILING items, but try both to be safe
            for i in range(0, len(filing_ids), 50):
                batch_ids = filing_ids[i:i + 50]
                # Try both FILING# and CONTRIBUTION# key formats for each ID
                keys = []
                for fid in batch_ids:
                    keys.append({'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}})
                    keys.append({'PK': {'S': f'CONTRIBUTION#{fid}'}, 'SK': {'S': f'CONTRIBUTION#{fid}'}})
                request_items = {
                    FILINGS_TABLE_NAME: {
                        'Keys': keys
                        # No ProjectionExpression - returns all attributes
                    }
                }
                batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
                deserializer = TypeDeserializer()
                for item in batch_items:
                    # Deserialize all fields - no filtering, returns complete row
                    converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                    items.append(converted_item)
            
            logger.info(f"Fetched {len(items)} full items from DynamoDB using batch_get_item")
            
            # Apply remaining filters
            remaining_filters = filters.copy()
            if config['filter_key'] in remaining_filters:
                if isinstance(remaining_filters[config['filter_key']], list):
                    remaining_filters[config['filter_key']] = remaining_filters[config['filter_key']][1:]
                    if not remaining_filters[config['filter_key']]:
                        del remaining_filters[config['filter_key']]
                else:
                    del remaining_filters[config['filter_key']]
            
            # Also remove from general_text_search_fields if present
            if 'general_text_search_fields' in remaining_filters:
                gtsf = remaining_filters['general_text_search_fields']
                if config['filter_key'] in gtsf:
                    if isinstance(gtsf[config['filter_key']], list):
                        gtsf[config['filter_key']] = gtsf[config['filter_key']][1:]
                        if not gtsf[config['filter_key']]:
                            del gtsf[config['filter_key']]
                    else:
                        del gtsf[config['filter_key']]
                if not gtsf:
                    del remaining_filters['general_text_search_fields']
            
            filtered_items = []
            for item in items:
                if apply_python_filter(item, remaining_filters):
                    filtered_items.append(item)
            
            results = [convert_decimal_to_float(item) for item in filtered_items]
            
            # Prepare pagination token for "load more" functionality
            # Store the parameter-filing mapping key so we can continue pagination
            serializable_last_key = None
            if param_mapping_key:
                try:
                    # Store both the parameter mapping key and filter info for continuation
                    serializable_last_key = {
                        'parameter_mapping_key': convert_decimal_to_float(param_mapping_key),
                        'parameter_type': config['parameter_type'],
                        'filter_key': config['filter_key'],
                        'query_type': 'parameter_filing_mapping'
                    }
                except Exception as e:
                    logger.warning(f"Error converting parameter mapping key: {e}")
                    serializable_last_key = None
            
            return {
                'success': True,
                'results': results,
                'count': len(results),
                'has_more': param_mapping_key is not None,  # More results available if we have a pagination key
                'last_evaluated_key': serializable_last_key,
                'method': 'parameter_filing_mapping',
                'parameter_type': config['parameter_type']
            }
        
        # Normal GSI query
        logger.info(f"Using single GSI query: {config['index_name']}")
        logger.info(f"GSI query config: hash_key={config['hash_key']}, hash_value={config['hash_value']}, range_key={config.get('range_key')}, range_value={config.get('range_value')}")
        
        # Special handling for amount_bucket queries - need to increment buckets
        is_amount_query = config['filter_key'] == 'amount' and config['hash_key'] == 'amount_bucket'
        current_amount_bucket = None
        amount_min = config.get('amount_min')
        amount_max = config.get('amount_max')
        
        # Parse pagination key for amount queries
        if is_amount_query:
            # Extract current bucket from pagination key or start from amount_min
            if last_evaluated_key and isinstance(last_evaluated_key, dict):
                if 'amount_bucket' in last_evaluated_key:
                    current_amount_bucket = int(last_evaluated_key['amount_bucket'])
                    # Also extract the actual DynamoDB last_eval_key if present
                    if 'last_eval_key' in last_evaluated_key:
                        last_evaluated_key = last_evaluated_key['last_eval_key']
                    else:
                        last_evaluated_key = None  # Reset for new bucket
                    logger.info(f"Continuing amount query from bucket: {current_amount_bucket}")
                elif 'hash_value' in last_evaluated_key:
                    # Fallback: try to extract from hash_value
                    try:
                        current_amount_bucket = int(last_evaluated_key['hash_value'])
                        if 'last_eval_key' in last_evaluated_key:
                            last_evaluated_key = last_evaluated_key['last_eval_key']
                        else:
                            last_evaluated_key = None
                    except (ValueError, TypeError):
                        pass
            
            if current_amount_bucket is None:
                current_amount_bucket = int(amount_min) if amount_min else int(config['hash_value'])
                logger.info(f"Starting amount query from bucket: {current_amount_bucket}")
            
            # Update config to use current bucket
            config['hash_value'] = current_amount_bucket
        
        # For PAC searches, we need to paginate through all results efficiently
        # Process in batches to avoid memory issues
        remaining_filters = filters.copy()
        # For PAC searches, we only filtered by pac=1, but still need to filter by PAC name
        # So we keep general_text_search_fields.pac in the filters
        if config['filter_key'] == 'pac' and 'general_text_search_fields' in remaining_filters:
            # Keep general_text_search_fields.pac for name matching
            logger.info("PAC GSI query used - keeping general_text_search_fields.pac for name filtering")
        elif config['filter_key'] in remaining_filters:
            if isinstance(remaining_filters[config['filter_key']], list):
                remaining_filters[config['filter_key']] = remaining_filters[config['filter_key']][1:]
                if not remaining_filters[config['filter_key']]:
                    del remaining_filters[config['filter_key']]
            else:
                del remaining_filters[config['filter_key']]
        
        # For amount queries, remove amount_min and amount_max from remaining filters
        # (they're already handled by the GSI query, but we still need to apply Python filtering
        # to ensure exact amount matching since buckets are ranges)
        if is_amount_query:
            # Keep amount_min and amount_max in filters for Python filtering to ensure exact matching
            # (GSI buckets are ranges, so we need to filter by exact amount)
            pass  # Don't remove - we need them for Python filtering
        
        logger.info(f"Applying remaining filters: {list(remaining_filters.keys())}")
        logger.info(f"Remaining filters details: {json.dumps(remaining_filters, default=str)}")
        
        # Memory-efficient pagination: process in batches
        # Only fetch first batch - user will paginate through the rest
        # For amount queries, allow trying multiple buckets within the same round
        filtered_items = []
        gsi_last_eval_key = last_evaluated_key
        max_pagination_rounds = 1  # Only fetch first batch, let user paginate
        max_consecutive_empty_rounds = 5  # Stop if 5 consecutive rounds return 0 matching items
        consecutive_empty_rounds = 0
        pagination_round = 0
        batch_size = 125  # Default batch size (matches contracts lambda)
        
        # For amount queries, allow trying multiple buckets until we have enough results
        if is_amount_query:
            max_pagination_rounds = 100  # Allow trying many buckets, but will break when we have enough items
        
        # Special handling for PAC searches - GSI returns CONTRIBUTION items, not FILING items
        is_pac_search = config['filter_key'] == 'pac' and 'general_text_search_fields' in remaining_filters and remaining_filters.get('general_text_search_fields', {}).get('pac')
        
        # Try case variations for name-based queries if first attempt returns 0 results
        hash_value_variations = [config['hash_value']]  # Start with original value
        current_variation_index = 0
        tried_variations = False
        
        if config['hash_key'] in ['client_name', 'registrant_name', 'lobbyist_name']:
            # Generate case variations for name queries
            original_value = str(config['hash_value'])
            variations = [
                original_value.upper(),  # UPPERCASE
                original_value.lower(),  # lowercase
                original_value.title(),   # Title Case
                original_value.capitalize(),  # First letter uppercase
            ]
            # Add unique variations (avoid duplicates)
            for var in variations:
                if var not in hash_value_variations and var != original_value:
                    hash_value_variations.append(var)
        
        # On first query, try case variations for name-based queries if original returns 0 results
        if config['hash_key'] in ['client_name', 'registrant_name', 'lobbyist_name']:
            # First, test the original value
            test_ids, _ = query_gsi_for_filing_ids(
                index_name=config['index_name'],
                hash_key_name=config['hash_key'],
                hash_key_value=hash_value_variations[0],  # Original value
                range_key_name=config.get('range_key'),
                range_key_value=config.get('range_value'),
                range_key_condition=config.get('range_condition'),
                limit=1,  # Just test if any results exist
                exclusive_start_key=None,
                get_all=False
            )
            
            if len(test_ids) == 0:
                # Original didn't work, try case variations
                logger.info(f"Original value '{hash_value_variations[0]}' returned 0 results, trying case variations...")
                for var_idx, variation in enumerate(hash_value_variations[1:], start=1):  # Skip original, already tested
                    logger.info(f"Trying case variation {var_idx + 1}/{len(hash_value_variations)} for {config['hash_key']}: '{variation}'")
                    test_ids, _ = query_gsi_for_filing_ids(
                        index_name=config['index_name'],
                        hash_key_name=config['hash_key'],
                        hash_key_value=variation,
                        range_key_name=config.get('range_key'),
                        range_key_value=config.get('range_value'),
                        range_key_condition=config.get('range_condition'),
                        limit=1,  # Just test if any results exist
                        exclusive_start_key=None,
                        get_all=False
                    )
                    
                    if len(test_ids) > 0:
                        # Found results with this variation - use it for all queries
                        current_variation_index = var_idx
                        config['hash_value'] = variation  # Update config for pagination
                        logger.info(f"Found results with variation '{variation}' - using this for all queries")
                        break
                else:
                    # No variation returned results
                    logger.warning(f"All variations returned 0 results for {config['hash_key']}='{config['hash_value']}'")
            else:
                # Original value works, use it
                logger.info(f"Original value '{hash_value_variations[0]}' works - no variation needed")
        
        while pagination_round < max_pagination_rounds:
            pagination_round += 1
            
            # For amount queries, use current bucket; otherwise use working variation
            if is_amount_query:
                current_hash_value = current_amount_bucket
                # Reset pagination key when moving to next bucket
                if pagination_round > 1 and gsi_last_eval_key is None:
                    # We exhausted previous bucket, increment to next
                    current_amount_bucket += 1
                    current_hash_value = current_amount_bucket
                    config['hash_value'] = current_amount_bucket
                    gsi_last_eval_key = None  # Reset for new bucket
                    logger.info(f"Amount bucket {current_amount_bucket - 1} exhausted, moving to bucket {current_amount_bucket}")
                    
                    # Check if we've exceeded amount_max
                    if amount_max and current_amount_bucket > int(amount_max):
                        logger.info(f"Reached amount_max ({amount_max}), stopping bucket increment")
                        break
            else:
                # Use the working variation (or original if none worked)
                current_hash_value = hash_value_variations[current_variation_index] if current_variation_index < len(hash_value_variations) else config['hash_value']
            
            # Query GSI to get a batch of IDs (could be filing IDs or contribution IDs)
            ids_batch, new_last_eval_key = query_gsi_for_filing_ids(
                index_name=config['index_name'],
                hash_key_name=config['hash_key'],
                hash_key_value=current_hash_value,
                range_key_name=config.get('range_key'),
                range_key_value=config.get('range_value'),
                range_key_condition=config.get('range_condition'),
                limit=batch_size,
                exclusive_start_key=gsi_last_eval_key,
                get_all=False
            )
            
            gsi_last_eval_key = new_last_eval_key
            
            if not ids_batch:
                logger.info(f"GSI query returned no more IDs (pagination round {pagination_round})")
                # For amount queries, try next bucket if current one is exhausted
                if is_amount_query:
                    current_amount_bucket += 1
                    if amount_max and current_amount_bucket > int(amount_max):
                        logger.info(f"Reached amount_max ({amount_max}), stopping bucket increment")
                        break
                    logger.info(f"Moving to next amount bucket: {current_amount_bucket}")
                    config['hash_value'] = current_amount_bucket
                    gsi_last_eval_key = None  # Reset for new bucket
                    # Continue loop to try next bucket (but only if we haven't reached max_pagination_rounds)
                    if pagination_round < max_pagination_rounds:
                        continue  # Try next bucket
                    else:
                        break
                else:
                    break
            
            logger.info(f"Pagination round {pagination_round}: Got {len(ids_batch)} IDs from GSI")
            
            # Fetch full items for this batch
            items_batch = []
            if ids_batch:
                dynamodb_client = boto3.client('dynamodb')
                
                if is_pac_search:
                    # For PAC searches, GSI returns contribution items
                    # Fetch contribution items to get filing_uuid and check pacs array
                    contribution_items = []
                    for i in range(0, len(ids_batch), 100):  # DynamoDB batch_get_item limit is 100
                        batch_ids = ids_batch[i:i + 100]
                        request_items = {
                            FILINGS_TABLE_NAME: {
                                'Keys': [
                                    {'PK': {'S': f'CONTRIBUTION#{cid}'}, 'SK': {'S': f'CONTRIBUTION#{cid}'}}
                                    for cid in batch_ids
                                ]
                                # No ProjectionExpression - returns ALL attributes (complete row including PII)
                            }
                        }
                        batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                        batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
                        deserializer = TypeDeserializer()
                        for item in batch_items:
                            # Deserialize all fields - no filtering, returns complete row
                            converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                            contribution_items.append(converted_item)
                    
                    logger.info(f"Pagination round {pagination_round}: Fetched {len(contribution_items)} contribution items")
                    
                    # Filter contributions by PAC name and extract filing UUIDs
                    pac_terms = remaining_filters.get('general_text_search_fields', {}).get('pac', [])
                    if isinstance(pac_terms, list):
                        pac_terms = [str(t).strip().lower() for t in pac_terms if t]
                    
                    filing_uuids = set()
                    for contribution in contribution_items:
                        # Check if contribution matches PAC name
                        pacs = contribution.get('pacs', [])
                        if isinstance(pacs, str):
                            # Handle JSON string format
                            try:
                                pacs = json.loads(pacs)
                            except:
                                pacs = []
                        
                        if not isinstance(pacs, list):
                            pacs = []
                        
                        # Check if any PAC name matches
                        matches = False
                        for pac_name in pacs:
                            if isinstance(pac_name, dict):
                                # Handle DynamoDB format
                                pac_name = pac_name.get('S', '') if 'S' in pac_name else str(pac_name)
                            pac_name_lower = str(pac_name).strip().lower()
                            for term in pac_terms:
                                if term in pac_name_lower:
                                    matches = True
                                    break
                            if matches:
                                break
                        
                        if matches:
                            filing_uuid = contribution.get('filing_uuid')
                            if filing_uuid:
                                filing_uuids.add(filing_uuid)
                    
                    logger.info(f"Pagination round {pagination_round}: Found {len(filing_uuids)} unique filing UUIDs matching PAC names")
                    
                    # Fetch the actual filing items
                    if filing_uuids:
                        filing_uuids_list = list(filing_uuids)
                        for i in range(0, len(filing_uuids_list), 100):
                            batch_uuids = filing_uuids_list[i:i + 100]
                            request_items = {
                                FILINGS_TABLE_NAME: {
                                    'Keys': [
                                        {'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}}
                                        for fid in batch_uuids
                                    ]
                                    # No ProjectionExpression - returns ALL attributes (complete row including PII)
                                }
                            }
                            batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                            batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
                            deserializer = TypeDeserializer()
                            for item in batch_items:
                                # Deserialize all fields - no filtering, returns complete row
                                converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                                items_batch.append(converted_item)
                else:
                    # Normal case: GSI returns filing/contribution IDs
                    # Try both FILING# and CONTRIBUTION# formats since we don't know the type
                    for i in range(0, len(ids_batch), 50):  # Reduced to 50 since we try both formats (effectively 100 keys)
                        batch_ids = ids_batch[i:i + 50]
                        # Try both FILING# and CONTRIBUTION# key formats for each ID
                        keys = []
                        for fid in batch_ids:
                            keys.append({'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}})
                            keys.append({'PK': {'S': f'CONTRIBUTION#{fid}'}, 'SK': {'S': f'CONTRIBUTION#{fid}'}})
                        request_items = {
                            FILINGS_TABLE_NAME: {
                                'Keys': keys
                                # No ProjectionExpression - returns ALL attributes (complete row including PII)
                            }
                        }
                        batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                        batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
                        deserializer = TypeDeserializer()
                        for item in batch_items:
                            # Deserialize all fields - no filtering, returns complete row
                            converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                            items_batch.append(converted_item)
            
            logger.info(f"Pagination round {pagination_round}: Fetched {len(items_batch)} full items from DynamoDB")
            
            # Track items before filtering to detect empty rounds
            items_before_round = len(filtered_items)
            
            # Apply remaining filters to this batch (for PAC search, PAC name filtering already done)
            if is_pac_search:
                # For PAC searches, we already filtered by PAC name, so just add all items
                # But still apply other filters if any
                temp_filters = remaining_filters.copy()
                if 'general_text_search_fields' in temp_filters:
                    temp_filters_gtsf = temp_filters['general_text_search_fields'].copy()
                    temp_filters_gtsf.pop('pac', None)  # Remove PAC filter as it's already applied
                    if temp_filters_gtsf:
                        temp_filters['general_text_search_fields'] = temp_filters_gtsf
                    else:
                        temp_filters.pop('general_text_search_fields', None)
                
                for item in items_batch:
                    if apply_python_filter(item, temp_filters):
                        filtered_items.append(item)
            else:
                # Normal filtering
                for item in items_batch:
                    if apply_python_filter(item, remaining_filters):
                        filtered_items.append(item)
            
            items_after_round = len(filtered_items)
            items_matched_this_round = items_after_round - items_before_round
            
            logger.info(f"Pagination round {pagination_round}: {len(filtered_items)} items match all filters so far, matched {items_matched_this_round} this round")
            
            # For amount queries, stop if we have enough items
            if is_amount_query and len(filtered_items) >= batch_size:
                logger.info(f"Reached batch size limit ({batch_size}), stopping")
                break
            
            # Stop if GSI ran out
            if not gsi_last_eval_key:
                # For amount queries, try next bucket if current one is exhausted
                if is_amount_query:
                    current_amount_bucket += 1
                    if amount_max and current_amount_bucket > int(amount_max):
                        logger.info(f"Reached amount_max ({amount_max}), stopping bucket increment")
                        break
                    logger.info(f"Bucket exhausted, moving to next amount bucket: {current_amount_bucket}")
                    config['hash_value'] = current_amount_bucket
                    gsi_last_eval_key = None  # Reset for new bucket
                    continue  # Try next bucket
                else:
                    break
            
            # Early termination: if multiple consecutive rounds return 0 matching items, stop paginating
            if items_matched_this_round == 0:
                consecutive_empty_rounds += 1
                if consecutive_empty_rounds >= max_consecutive_empty_rounds:
                    logger.warning(f"Stopping pagination after {consecutive_empty_rounds} consecutive rounds with 0 matching items. This may indicate filters are too restrictive or data mismatch.")
                    break
            else:
                consecutive_empty_rounds = 0  # Reset counter if we found items
        
        logger.info(f"Pagination complete: {len(filtered_items)} items match all filters after {pagination_round} rounds")
        
        # Limit results to batch_size
        results = [convert_decimal_to_float(item) for item in filtered_items[:batch_size]]
        
        serializable_last_key = None
        has_more = False
        
        if is_amount_query:
            # For amount queries, create custom pagination key with bucket info
            if gsi_last_eval_key:
                # Still have more in current bucket
                try:
                    serializable_last_key = {
                        'amount_bucket': current_amount_bucket,
                        'hash_value': current_amount_bucket,
                        'index_name': config['index_name'],
                        'hash_key': config['hash_key'],
                        'last_eval_key': convert_decimal_to_float(gsi_last_eval_key),
                        'amount_min': amount_min,
                        'amount_max': amount_max
                    }
                    has_more = True
                except Exception as e:
                    logger.warning(f"Error converting last_evaluated_key: {e}")
            elif amount_max is None or current_amount_bucket < int(amount_max):
                # Current bucket exhausted but more buckets available
                serializable_last_key = {
                    'amount_bucket': current_amount_bucket + 1,
                    'hash_value': current_amount_bucket + 1,
                    'index_name': config['index_name'],
                    'hash_key': config['hash_key'],
                    'amount_min': amount_min,
                    'amount_max': amount_max
                }
                has_more = True
        else:
            # Normal GSI query pagination
            if gsi_last_eval_key:
                try:
                    serializable_last_key = convert_decimal_to_float(gsi_last_eval_key)
                    has_more = True
                except Exception as e:
                    logger.warning(f"Error converting last_evaluated_key: {e}")
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': has_more,
            'last_evaluated_key': serializable_last_key,
            'method': 'single_gsi_query',
            'index_used': config['index_name']
        }
    
    else:
        # No GSI-queryable filters - use default GSI query for recent years
        # This avoids scan operations by querying YearPostedDateIndex for recent years
        logger.info("No GSI-queryable filters found, using default YearPostedDateIndex query for recent years")
        
        # Use current year and previous year as default to get recent filings
        from datetime import datetime
        current_year = datetime.now().year
        years_to_query = [current_year, current_year - 1]
        
        all_filing_ids = []
        all_last_eval_keys = {}
        
        # Query each year's GSI to get filing IDs (limit to 125 to prevent large responses)
        DEFAULT_BATCH_SIZE = 125  # Default batch size (matches contracts lambda)
        total_ids_needed = DEFAULT_BATCH_SIZE
        
        for year in years_to_query:
            if len(all_filing_ids) >= total_ids_needed:
                break  # Stop if we have enough IDs
            
            # Calculate how many more IDs we need
            remaining_needed = total_ids_needed - len(all_filing_ids)
            
            filing_ids, last_eval_key = query_gsi_for_filing_ids(
                index_name='YearPostedDateIndex',
                hash_key_name='filing_year',
                hash_key_value=year,
                limit=remaining_needed,  # Only fetch what we need
                exclusive_start_key=last_evaluated_key if year == years_to_query[0] else None,
                get_all=False
            )
            all_filing_ids.extend(filing_ids)
            if last_eval_key:
                all_last_eval_keys[year] = last_eval_key
        
        logger.info(f"Found {len(all_filing_ids)} filing IDs from recent years (limited to {DEFAULT_BATCH_SIZE} for response size)")
        
        # Fetch full items using batch get (only fetch what we need)
        items = []
        if all_filing_ids:
            # Limit to DEFAULT_BATCH_SIZE to prevent large responses
            ids_to_fetch = all_filing_ids[:DEFAULT_BATCH_SIZE]
            # DynamoDB BatchGetItem limit is 100 items per request
            batch_get_size = 100
            dynamodb_client = boto3.client('dynamodb')
            for i in range(0, len(ids_to_fetch), batch_get_size):
                batch_ids = ids_to_fetch[i:i + batch_get_size]
                request_items = {
                    FILINGS_TABLE_NAME: {
                        'Keys': [
                            {'PK': {'S': f'FILING#{fid}'}, 'SK': {'S': f'FILING#{fid}'}}
                            for fid in batch_ids
                        ]
                        # No ProjectionExpression - returns ALL attributes (complete row including PII)
                    }
                }
                batch_response = dynamodb_client.batch_get_item(RequestItems=request_items)
                batch_items = batch_response.get('Responses', {}).get(FILINGS_TABLE_NAME, [])
                deserializer = TypeDeserializer()
                for item in batch_items:
                    # Deserialize all fields - no filtering, returns complete row
                    converted_item = {k: deserializer.deserialize(v) for k, v in item.items()}
                    items.append(converted_item)
        
        # Apply all filters in Python
        filtered_items = [item for item in items if apply_python_filter(item, filters)]
        logger.info(f"After filtering: {len(filtered_items)} items match filters (out of {len(items)} fetched)")
        
        # Return up to DEFAULT_BATCH_SIZE items to prevent response size issues
        results = [convert_decimal_to_float(item) for item in filtered_items[:DEFAULT_BATCH_SIZE]]
        
        # Use the last evaluated key from the most recent year queried
        # has_more is True if: (1) we have a pagination key, OR (2) we fetched the full batch
        serializable_last_key = None
        has_more = False
        
        # Check if we have more results available
        if all_last_eval_keys:
            # We have a pagination key, so there are more items in the GSI
            try:
                # Use the last evaluated key from the first year (most recent)
                serializable_last_key = convert_decimal_to_float(all_last_eval_keys.get(years_to_query[0]))
                has_more = True
            except Exception as e:
                logger.warning(f"Error converting last_evaluated_key: {e}")
        elif len(all_filing_ids) >= DEFAULT_BATCH_SIZE:
            # We fetched the full batch, so there might be more items
            # Create a pagination key to continue from where we left off
            has_more = True
            # Store the last fetched ID and year info for continuation
            if all_filing_ids:
                serializable_last_key = {
                    'query_type': 'default_gsi_query',
                    'last_fetched_id': all_filing_ids[-1],
                    'years_queried': years_to_query,
                    'total_ids_fetched': len(all_filing_ids),
                    'last_eval_key': convert_decimal_to_float(all_last_eval_keys.get(years_to_query[0])) if all_last_eval_keys else None
                }
        
        return {
            'success': True,
            'results': results,
            'count': len(results),
            'has_more': has_more,
            'last_evaluated_key': serializable_last_key,
            'method': 'default_gsi_query',
            'index_used': 'YearPostedDateIndex'
        }


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for LDA search API
    
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
    cors_headers = get_cors_headers()
    
    # Handle OPTIONS preflight request
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }
    
    # Track if this is from SQS (for completion notification)
    is_sqs_event = False
    job_id = None
    request_id = None
    completion_sns_topic = os.environ.get('LDA_SEARCH_COMPLETION_SNS_TOPIC_ARN')
    
    # Handle SQS events (from wrapper Lambda when worker is at concurrency)
    if 'Records' in event and len(event.get('Records', [])) > 0:
        is_sqs_event = True
        try:
            record = event['Records'][0]
            message_body = json.loads(record.get('body', '{}'))
            request_id = message_body.get('request_id')
            job_id = message_body.get('job_id')
            api_gateway_event = message_body.get('api_gateway_event', {})
            event = api_gateway_event
        except Exception as e:
            logger.error(f"Error parsing SQS event: {str(e)}", exc_info=True)
            return {
                'statusCode': 400,
                'headers': cors_headers,
                'body': json.dumps({'error': 'Invalid SQS event format'})
            }
    
    try:
        # Parse request body
        if isinstance(event.get('body'), str):
            try:
                request_body = json.loads(event['body'])
            except json.JSONDecodeError:
                request_body = {}
        else:
            request_body = event.get('body', {})
        
        # Extract filters
        filters = request_body.get('filters', {})
        last_evaluated_key = request_body.get('last_evaluated_key')
        
        # Log filters for debugging
        logger.info(f"Search request - filters: {json.dumps(filters)}, last_evaluated_key: {last_evaluated_key is not None}")
        
        # Perform search - return all results (no limit)
        result = search_filings(filters, last_evaluated_key)
        logger.info(f"Search complete - found {result.get('count', 0)} results, has_more: {result.get('has_more', False)}")
        
        # If this is from SQS, publish completion notification
        if is_sqs_event and completion_sns_topic:
            import boto3
            sns_client = boto3.client('sns')
            try:
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps({
                        'request_id': request_id,
                        'job_id': job_id,
                        'status': 'completed',
                        'response': result
                    }),
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': str(request_id)
                        }
                    }
                )
            except Exception as e:
                logger.error(f"Error publishing completion notification: {str(e)}", exc_info=True)
        
        # Return API Gateway response
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps(result)
        }
    
    except Exception as e:
        logger.error(f"Error processing search request: {str(e)}", exc_info=True)
        
        # If this is from SQS, publish failure notification
        if is_sqs_event and completion_sns_topic:
            import boto3
            sns_client = boto3.client('sns')
            try:
                sns_client.publish(
                    TopicArn=completion_sns_topic,
                    Message=json.dumps({
                        'request_id': request_id,
                        'job_id': job_id,
                        'status': 'failed',
                        'error': str(e)
                    }),
                    MessageAttributes={
                        'request_id': {
                            'DataType': 'String',
                            'StringValue': str(request_id)
                        }
                    }
                )
            except Exception as e2:
                logger.error(f"Error publishing failure notification: {str(e2)}", exc_info=True)
        
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': 'Internal server error',
                'message': str(e)
            })
        }

