"""
Politician Trades Search Lambda Function
Provides search functionality for politician trades stored in DynamoDB
Supports filtering by various fields using GSIs
"""

import json
import os
import logging
import boto3
import re
from typing import Dict, List, Any, Optional
from datetime import datetime
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
dynamodb = boto3.resource('dynamodb')

# Environment variables
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'cosine-politician-trades-production')
MAX_RESULTS = int(os.environ.get('MAX_RESULTS', '100'))

# GSI names from table definition
GSI_NAMES = {
    'politicianName': 'PoliticianTradeDateIndex',
    'position': 'PositionTradeDateIndex',
    'party': 'PartyTradeDateIndex',
    'securitySymbol': 'SecurityTradeDateIndex',
    'transactionType': 'TransactionTypeTradeDateIndex',
    'amountMin': 'AmountRangeTradeDateIndex',
    'stateDistrict': 'StateDistrictTradeDateIndex',
}

# Standard Senate PTR ranges (as tuples of (min, max)) - matches Senate lambda
STANDARD_PTR_RANGES = [
    (0, 1000),        # $0 - $1,000
    (1001, 15000),    # $1,001 - $15,000
    (15001, 50000),   # $15,001 - $50,000
    (50001, 100000),  # $50,001 - $100,000
    (100001, 250000), # $100,001 - $250,000
    (250001, 500000), # $250,001 - $500,000
    (500001, 1000000), # $500,001 - $1,000,000
    (1000001, 5000000), # $1,000,001 - $5,000,000
    (5000001, 25000000), # $5,000,001 - $25,000,000
    (25000001, 50000000), # $25,000,001 - $50,000,000
    (50000001, None)  # Over $50,000,000
]

def parse_amount_range_filter(amount_range: str) -> tuple:
    """
    Parse amount range string like "$1,001-$15,000" into (min, max) tuple
    
    Args:
        amount_range: Amount range string (e.g., "$1,001-$15,000", "$50,000,001+")
        
    Returns:
        (min, max) tuple or None if parsing fails
    """
    if not amount_range:
        return None
    
    try:
        # Remove currency symbols and whitespace
        range_str = re.sub(r'[\$,\s]', '', amount_range)
        
        # Handle "Over $50,000,000" case (no upper bound)
        if '+' in range_str or 'over' in amount_range.lower():
            # Extract the minimum value
            min_match = re.search(r'(\d+)', range_str)
            if min_match:
                return (int(min_match.group(1)), None)
        
        # Handle range format: "1001-15000"
        range_match = re.search(r'(\d+)\s*[-–—]\s*(\d+)', range_str)
        if range_match:
            min_val = int(range_match.group(1))
            max_val = int(range_match.group(2))
            return (min_val, max_val)
        
        # Handle single number (use as exact match)
        single_match = re.search(r'^(\d+)$', range_str)
        if single_match:
            val = int(single_match.group(1))
            return (val, val)
        
        return None
    except (ValueError, AttributeError) as e:
        logger.warning(f"⚠️ Error parsing amount range '{amount_range}': {e}")
        return None


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder for Decimal types"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return int(obj) if obj % 1 == 0 else float(obj)
        return super(DecimalEncoder, self).default(obj)


def convert_to_dynamodb_format(value: Any) -> Any:
    """Convert Python types to DynamoDB-compatible types"""
    if isinstance(value, float):
        return Decimal(str(value))
    elif isinstance(value, int):
        return value
    elif isinstance(value, list):
        return [convert_to_dynamodb_format(item) for item in value]
    elif isinstance(value, dict):
        return {k: convert_to_dynamodb_format(v) for k, v in value.items()}
    return value


def convert_from_dynamodb_format(item: Dict[str, Any]) -> Dict[str, Any]:
    """Convert DynamoDB item to Python dict with proper types"""
    result = {}
    for key, value in item.items():
        if isinstance(value, Decimal):
            result[key] = int(value) if value % 1 == 0 else float(value)
        elif isinstance(value, dict):
            result[key] = convert_from_dynamodb_format(value)
        elif isinstance(value, list):
            result[key] = [
                convert_from_dynamodb_format(v) if isinstance(v, dict) else
                (int(v) if isinstance(v, Decimal) and v % 1 == 0 else float(v) if isinstance(v, Decimal) else v)
                for v in value
            ]
        else:
            result[key] = value
    return result


def build_query_params(
    table,
    filters: Dict[str, Any],
    page: int = 1,
    page_size: int = 50
) -> tuple[Optional[str], Optional[Dict[str, Any]], Optional[str]]:
    """
    Build DynamoDB query parameters based on filters.
    Returns (index_name, key_condition, filter_expression)
    """
    logger.info(f"🔧 build_query_params called with filters: {json.dumps(filters, default=str)}")
    
    # Determine which GSI to use based on provided filters
    # Priority order: politicianName > position > party > securitySymbol > formType > transactionType > amountMin > stateDistrict
    
    index_name = None
    key_condition = None
    filter_expression = None
    filter_conditions = []
    
    # Check for GSI hash key filters
    # Priority order: politicianName > position > party > transactionType > amountMin > stateDistrict
    # Note: Security search is handled as a filter condition since it searches multiple fields
    
    if filters.get('politicianName'):
        index_name = GSI_NAMES['politicianName']
        politician_name_value = filters['politicianName']
        
        # Handle both single string and array formats
        if isinstance(politician_name_value, list):
            if len(politician_name_value) == 1:
                # Single politician in array - use GSI
                politician_name_value = politician_name_value[0]
                key_condition = Key('politicianName').eq(politician_name_value)
                logger.info(f"✅ Selected GSI: {index_name} for single politicianName: '{politician_name_value}'")
            else:
                # Multiple politicians - cannot use GSI efficiently, fall back to scan
                logger.info(f"⚠️ Multiple politicians provided {politician_name_value}, falling back to scan")
                index_name = None
                key_condition = None
        else:
            # Single string value
            key_condition = Key('politicianName').eq(politician_name_value)
            logger.info(f"✅ Selected GSI: {index_name} for politicianName: '{politician_name_value}'")
    elif filters.get('position'):
        index_name = GSI_NAMES['position']
        position_value = filters['position']
        key_condition = Key('position').eq(position_value)
        logger.info(f"✅ Selected GSI: {index_name} for position: '{position_value}'")
        logger.info(f"🔍 Position value type: {type(position_value)}, value: {repr(position_value)}")
    elif filters.get('party'):
        index_name = GSI_NAMES['party']
        party_value = filters['party']
        
        # Handle both single string and array formats
        if isinstance(party_value, list):
            if len(party_value) == 1:
                # Single party in array - use GSI
                party_value = party_value[0]
                key_condition = Key('party').eq(party_value)
                logger.info(f"✅ Selected GSI: {index_name} for single party: '{party_value}'")
            else:
                # Multiple parties - cannot use GSI efficiently, fall back to scan
                logger.info(f"⚠️ Multiple parties provided {party_value}, falling back to scan")
                index_name = None
                key_condition = None
        else:
            # Single string value
            key_condition = Key('party').eq(party_value)
            logger.info(f"✅ Selected GSI: {index_name} for party: '{party_value}'")
    elif filters.get('transactionType'):
        index_name = GSI_NAMES['transactionType']
        transaction_type_value = filters['transactionType']
        
        # Handle both single string and array formats
        if isinstance(transaction_type_value, list):
            if len(transaction_type_value) == 1:
                # Single transaction type in array - use GSI
                transaction_type_value = transaction_type_value[0]
                key_condition = Key('transactionType').eq(transaction_type_value)
                logger.info(f"✅ Selected GSI: {index_name} for single transactionType: '{transaction_type_value}'")
            else:
                # Multiple transaction types - cannot use GSI efficiently, fall back to scan
                logger.info(f"⚠️ Multiple transaction types provided {transaction_type_value}, falling back to scan")
                index_name = None
                key_condition = None
        else:
            # Single string value
            key_condition = Key('transactionType').eq(transaction_type_value)
            logger.info(f"✅ Selected GSI: {index_name} for transactionType: '{transaction_type_value}'")
    elif filters.get('amountRange'):
        # Handle amount range filter(s)
        amount_ranges = filters['amountRange']
        if isinstance(amount_ranges, list):
            if len(amount_ranges) == 1:
                # Single amount range - can use GSI
                amount_range_tuple = parse_amount_range_filter(amount_ranges[0])
                if amount_range_tuple:
                    index_name = GSI_NAMES['amountMin']
                    amount_min, amount_max = amount_range_tuple
                    
                    if amount_max is None:
                        # "Over X" case - no upper bound
                        key_condition = Key('amountMin').gte(Decimal(str(amount_min)))
                    else:
                        # Standard range
                        key_condition = Key('amountMin').between(Decimal(str(amount_min)), Decimal(str(amount_max)))
                    
                    logger.info(f"✅ Selected GSI: {index_name} for single amount range: {amount_ranges[0]} -> ({amount_min}, {amount_max})")
            else:
                # Multiple amount ranges - use scan with filter
                logger.info(f"🔍 Multiple amount ranges ({len(amount_ranges)} items) will use scan with filter")
        else:
            # Single string - parse the amount range filter (e.g., "$1,001-$15,000")
            amount_range_tuple = parse_amount_range_filter(amount_ranges)
            if amount_range_tuple:
                index_name = GSI_NAMES['amountMin']
                amount_min, amount_max = amount_range_tuple
                
                if amount_max is None:
                    # "Over X" case - no upper bound
                    key_condition = Key('amountMin').gte(Decimal(str(amount_min)))
                else:
                    # Standard range
                    key_condition = Key('amountMin').between(Decimal(str(amount_min)), Decimal(str(amount_max)))
                
                logger.info(f"✅ Selected GSI: {index_name} for amount range: {amount_ranges} -> ({amount_min}, {amount_max})")
    elif filters.get('stateDistrict'):
        index_name = GSI_NAMES['stateDistrict']
        state_district_value = filters['stateDistrict']
        
        # Handle both single string and array formats
        if isinstance(state_district_value, list):
            if len(state_district_value) == 1:
                # Single state/district in array - use GSI
                state_district_value = state_district_value[0]
                key_condition = Key('stateDistrict').eq(state_district_value)
                logger.info(f"✅ Selected GSI: {index_name} for single stateDistrict: '{state_district_value}'")
            else:
                # Multiple states/districts - cannot use GSI efficiently, fall back to scan
                logger.info(f"⚠️ Multiple states/districts provided {state_district_value}, falling back to scan")
                index_name = None
                key_condition = None
        else:
            # Single string value
            key_condition = Key('stateDistrict').eq(state_district_value)
            logger.info(f"✅ Selected GSI: {index_name} for stateDistrict: '{state_district_value}'")
    
    # If we have a security search but no other GSI key, try to use SecuritySymbol GSI for better performance
    elif filters.get('security'):
        securities = filters['security']
        if isinstance(securities, list):
            if len(securities) == 1:
                # Single security - check if it's a good GSI candidate
                security_value = securities[0].strip()
                if (2 <= len(security_value) <= 6 and 
                    security_value.replace('.', '').replace('-', '').isalnum() and
                    security_value.isupper()):
                    index_name = GSI_NAMES['securitySymbol']
                    key_condition = Key('securitySymbol').eq(security_value.upper())
                    logger.info(f"✅ Selected GSI: {index_name} for single security symbol: '{security_value}'")
                else:
                    logger.info(f"🔍 Single security search '{security_value}' will use scan with filter")
            else:
                # Multiple securities - always use scan with filter
                logger.info(f"🔍 Multiple securities search ({len(securities)} items) will use scan with filter")
        else:
            # Single string
            security_value = securities.strip()
            # Use GSI if it looks like an exact stock symbol match
            # Criteria: short (2-6 chars), mostly uppercase, and alphanumeric
            if (2 <= len(security_value) <= 6 and 
                security_value.replace('.', '').replace('-', '').isalnum() and
                security_value.isupper()):
                index_name = GSI_NAMES['securitySymbol']
                key_condition = Key('securitySymbol').eq(security_value.upper())
                logger.info(f"✅ Selected GSI: {index_name} for exact security symbol: '{security_value}'")
            else:
                logger.info(f"🔍 Security search '{security_value}' will use scan with filter (likely company name or partial match)")
    
    # Add transactionDate range filter if using a GSI (all GSIs have transactionDate as range key)
    # IMPORTANT: transactionDate is stored as YYYYMMDD integer (e.g., 20251021), NOT Unix timestamp
    if index_name and (filters.get('dateFrom') or filters.get('dateTo')):
        date_from = filters.get('dateFrom')
        date_to = filters.get('dateTo')
        
        logger.info(f"📅 Processing date range - dateFrom: {date_from}, dateTo: {date_to}")
        
        if date_from and date_to:
            # Convert date strings to YYYYMMDD integer format
            try:
                date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                date_from_num = int(date_from_obj.strftime('%Y%m%d'))
                date_to_num = int(date_to_obj.strftime('%Y%m%d'))
                logger.info(f"📅 Date range numeric - from: {date_from_num} ({date_from}), to: {date_to_num} ({date_to})")
                key_condition = key_condition & Key('transactionDate').between(date_from_num, date_to_num)
            except ValueError as e:
                logger.warning(f"⚠️ Invalid date format: {date_from} or {date_to}, error: {e}")
        elif date_from:
            try:
                date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                date_from_num = int(date_from_obj.strftime('%Y%m%d'))
                logger.info(f"📅 Date from numeric: {date_from_num} ({date_from})")
                key_condition = key_condition & Key('transactionDate').gte(date_from_num)
            except ValueError as e:
                logger.warning(f"⚠️ Invalid date format: {date_from}, error: {e}")
        elif date_to:
            try:
                date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                date_to_num = int(date_to_obj.strftime('%Y%m%d'))
                logger.info(f"📅 Date to numeric: {date_to_num} ({date_to})")
                key_condition = key_condition & Key('transactionDate').lte(date_to_num)
            except ValueError as e:
                logger.warning(f"⚠️ Invalid date format: {date_to}, error: {e}")
    
    # Build filter expression for non-key attributes
    
    # Enhanced security search - searches both securitySymbol and securityName with improved logic
    if filters.get('security') and index_name != GSI_NAMES.get('securitySymbol'):
        securities = filters['security']
        
        def create_security_filter(security_value):
            """Create a comprehensive security filter for a single security value"""
            security_value = security_value.strip()
            security_upper = security_value.upper()
            security_lower = security_value.lower()
            
            return (
                Attr('securitySymbol').eq(security_upper) |                    # Exact symbol match
                Attr('securitySymbol').contains(security_upper) |             # Partial symbol match
                Attr('securityName').contains(security_value) |               # Name contains (original case)
                Attr('securityName').contains(security_lower) |               # Name contains (lowercase)
                Attr('securityName').contains(security_upper) |               # Name contains (uppercase)
                Attr('securityName').begins_with(security_value) |            # Name begins with (original case)
                Attr('securityName').begins_with(security_value.title()) |    # Name begins with (title case)
                # Also search securities with missing/empty symbols (other securities like bonds)
                (Attr('securitySymbol').not_exists() & Attr('securityName').contains(security_value)) |
                (Attr('securitySymbol').eq('') & Attr('securityName').contains(security_value)) |
                (Attr('securitySymbol').eq('--') & Attr('securityName').contains(security_value))
            )
        
        if isinstance(securities, list):
            if len(securities) == 1:
                # Single security
                security_filter = create_security_filter(securities[0])
                filter_conditions.append(security_filter)
                logger.info(f"🔍 Added security filter for: '{securities[0]}' (symbol/name/other search)")
            elif len(securities) > 1:
                # Multiple securities - use OR condition
                combined_filter = None
                for security_value in securities:
                    security_filter = create_security_filter(security_value)
                    if combined_filter is None:
                        combined_filter = security_filter
                    else:
                        combined_filter = combined_filter | security_filter
                filter_conditions.append(combined_filter)
                logger.info(f"🔍 Added multiple securities filter: {securities} (symbol/name/other search)")
        else:
            # Single string
            security_filter = create_security_filter(securities)
            filter_conditions.append(security_filter)
            logger.info(f"🔍 Added security filter for: '{securities}' (symbol/name/other search)")
    
    # Politician name filter (when not using GSI)
    if filters.get('politicianName') and index_name != GSI_NAMES.get('politicianName'):
        politician_names = filters['politicianName']
        if isinstance(politician_names, list):
            if len(politician_names) == 1:
                # Single politician
                filter_conditions.append(Attr('politicianName').eq(politician_names[0]))
                logger.info(f"🔍 Added politician name filter: '{politician_names[0]}'")
            elif len(politician_names) > 1:
                # Multiple politicians - use OR condition
                politician_filter = None
                for name in politician_names:
                    name_condition = Attr('politicianName').eq(name)
                    if politician_filter is None:
                        politician_filter = name_condition
                    else:
                        politician_filter = politician_filter | name_condition
                filter_conditions.append(politician_filter)
                logger.info(f"🔍 Added multiple politician names filter: {politician_names}")
        else:
            # Single string
            filter_conditions.append(Attr('politicianName').eq(politician_names))
            logger.info(f"🔍 Added politician name filter: '{politician_names}'")
    
    # Party filter (when not using GSI)
    if filters.get('party') and index_name != GSI_NAMES.get('party'):
        parties = filters['party']
        if isinstance(parties, list):
            if len(parties) == 1:
                # Single party
                filter_conditions.append(Attr('party').eq(parties[0]))
                logger.info(f"🔍 Added party filter: '{parties[0]}'")
            elif len(parties) > 1:
                # Multiple parties - use OR condition
                party_filter = None
                for party in parties:
                    party_condition = Attr('party').eq(party)
                    if party_filter is None:
                        party_filter = party_condition
                    else:
                        party_filter = party_filter | party_condition
                filter_conditions.append(party_filter)
                logger.info(f"🔍 Added multiple parties filter: {parties}")
        else:
            # Single string
            filter_conditions.append(Attr('party').eq(parties))
            logger.info(f"🔍 Added party filter: '{parties}'")
    
    # Transaction type filter (when not using GSI)
    if filters.get('transactionType') and index_name != GSI_NAMES.get('transactionType'):
        transaction_types = filters['transactionType']
        if isinstance(transaction_types, list):
            if len(transaction_types) == 1:
                # Single transaction type
                filter_conditions.append(Attr('transactionType').eq(transaction_types[0]))
                logger.info(f"🔍 Added transaction type filter: '{transaction_types[0]}'")
            elif len(transaction_types) > 1:
                # Multiple transaction types - use OR condition
                type_filter = None
                for trans_type in transaction_types:
                    type_condition = Attr('transactionType').eq(trans_type)
                    if type_filter is None:
                        type_filter = type_condition
                    else:
                        type_filter = type_filter | type_condition
                filter_conditions.append(type_filter)
                logger.info(f"🔍 Added multiple transaction types filter: {transaction_types}")
        else:
            # Single string
            filter_conditions.append(Attr('transactionType').eq(transaction_types))
            logger.info(f"🔍 Added transaction type filter: '{transaction_types}'")
    
    # State/District filter (when not using GSI)
    if filters.get('stateDistrict') and index_name != GSI_NAMES.get('stateDistrict'):
        state_districts = filters['stateDistrict']
        if isinstance(state_districts, list):
            if len(state_districts) == 1:
                # Single state/district
                filter_conditions.append(Attr('stateDistrict').eq(state_districts[0]))
                logger.info(f"🔍 Added state/district filter: '{state_districts[0]}'")
            elif len(state_districts) > 1:
                # Multiple state/districts - use OR condition
                district_filter = None
                for district in state_districts:
                    district_condition = Attr('stateDistrict').eq(district)
                    if district_filter is None:
                        district_filter = district_condition
                    else:
                        district_filter = district_filter | district_condition
                filter_conditions.append(district_filter)
                logger.info(f"🔍 Added multiple state/districts filter: {state_districts}")
        else:
            # Single string
            filter_conditions.append(Attr('stateDistrict').eq(state_districts))
            logger.info(f"🔍 Added state/district filter: '{state_districts}'")
    
    # Amount range filter (when not using GSI)
    if filters.get('amountRange') and index_name != GSI_NAMES.get('amountMin'):
        amount_ranges = filters['amountRange']
        if isinstance(amount_ranges, list):
            if len(amount_ranges) == 1:
                # Single amount range
                amount_range_tuple = parse_amount_range_filter(amount_ranges[0])
                if amount_range_tuple:
                    amount_min, amount_max = amount_range_tuple
                    if amount_max is None:
                        # "Over X" case
                        filter_conditions.append(Attr('amountMin').gte(Decimal(str(amount_min))))
                        logger.info(f"🔍 Added amount range filter: >= {amount_min}")
                    else:
                        # Standard range
                        filter_conditions.append(Attr('amountMin').between(Decimal(str(amount_min)), Decimal(str(amount_max))))
                        logger.info(f"🔍 Added amount range filter: {amount_min} - {amount_max}")
            elif len(amount_ranges) > 1:
                # Multiple amount ranges - use OR condition
                range_filter = None
                for amount_range in amount_ranges:
                    amount_range_tuple = parse_amount_range_filter(amount_range)
                    if amount_range_tuple:
                        amount_min, amount_max = amount_range_tuple
                        if amount_max is None:
                            # "Over X" case
                            range_condition = Attr('amountMin').gte(Decimal(str(amount_min)))
                        else:
                            # Standard range
                            range_condition = Attr('amountMin').between(Decimal(str(amount_min)), Decimal(str(amount_max)))
                        
                        if range_filter is None:
                            range_filter = range_condition
                        else:
                            range_filter = range_filter | range_condition
                
                if range_filter is not None:
                    filter_conditions.append(range_filter)
                    logger.info(f"🔍 Added multiple amount ranges filter: {amount_ranges}")
        else:
            # Single string
            amount_range_tuple = parse_amount_range_filter(amount_ranges)
            if amount_range_tuple:
                amount_min, amount_max = amount_range_tuple
                if amount_max is None:
                    # "Over X" case
                    filter_conditions.append(Attr('amountMin').gte(Decimal(str(amount_min))))
                    logger.info(f"🔍 Added amount range filter: >= {amount_min}")
                else:
                    # Standard range
                    filter_conditions.append(Attr('amountMin').between(Decimal(str(amount_min)), Decimal(str(amount_max))))
                    logger.info(f"🔍 Added amount range filter: {amount_min} - {amount_max}")
    
    # Filing date range filter (filingDate is stored as YYYY-MM-DD string)
    if filters.get('filingDateFrom') or filters.get('filingDateTo'):
        filing_date_from = filters.get('filingDateFrom')
        filing_date_to = filters.get('filingDateTo')
        
        logger.info(f"📅 Processing filing date range - from: {filing_date_from}, to: {filing_date_to}")
        
        if filing_date_from and filing_date_to:
            filter_conditions.append(Attr('filingDate').between(filing_date_from, filing_date_to))
            logger.info(f"📅 Added filing date range filter: {filing_date_from} to {filing_date_to}")
        elif filing_date_from:
            filter_conditions.append(Attr('filingDate').gte(filing_date_from))
            logger.info(f"📅 Added filing date from filter: >= {filing_date_from}")
        elif filing_date_to:
            filter_conditions.append(Attr('filingDate').lte(filing_date_to))
            logger.info(f"📅 Added filing date to filter: <= {filing_date_to}")
    
    if filters.get('requiresManualReview') is not None:
        filter_conditions.append(Attr('requiresManualReview').eq(filters['requiresManualReview']))
    
    if filters.get('isUnparsed') is not None:
        filter_conditions.append(Attr('isUnparsed').eq(filters['isUnparsed']))
    
    if filters.get('matchConfidence'):
        filter_conditions.append(Attr('matchConfidence').gte(Decimal(str(filters['matchConfidence']))))
    
    if filter_conditions:
        filter_expression = filter_conditions[0]
        for condition in filter_conditions[1:]:
            filter_expression = filter_expression & condition
    
    return index_name, key_condition, filter_expression


def search_trades(filters: Dict[str, Any], page: int = 1, page_size: int = 50) -> Dict[str, Any]:
    """
    Search politician trades based on filters
    
    Args:
        filters: Dictionary of filter criteria
        page: Page number (1-indexed)
        page_size: Number of results per page
    
    Returns:
        Dictionary with results and metadata
    """
    try:
        logger.info(f"🔍 Starting search_trades with filters: {json.dumps(filters, default=str)}, page: {page}, page_size: {page_size}")
        logger.info(f"📊 Table name: {DYNAMODB_TABLE_NAME}")
        
        table = dynamodb.Table(DYNAMODB_TABLE_NAME)
        
        # Build query parameters
        index_name, key_condition, filter_expression = build_query_params(table, filters, page, page_size)
        logger.info(f"🔧 Query params - index_name: {index_name}, has_key_condition: {key_condition is not None}, has_filter_expression: {filter_expression is not None}")
        
        # If no GSI filter is provided, use scan (less efficient but necessary)
        if not index_name:
            logger.info("⚠️ No GSI filter provided, using scan operation")
            logger.info(f"📋 Filters provided: {list(filters.keys())}")
            scan_kwargs = {
                'Limit': page_size
            }
            
            # Build filter expression for scan
            if filter_expression:
                scan_kwargs['FilterExpression'] = filter_expression
            
            # Add attribute filters
            if filters.get('politicianName'):
                scan_kwargs['FilterExpression'] = (scan_kwargs.get('FilterExpression', Attr('tradeId').exists()) & 
                                                   Attr('politicianName').contains(filters['politicianName']))
            
            # Combined security search
            if filters.get('security'):
                security_value = filters['security'].strip()
                existing_filter = scan_kwargs.get('FilterExpression', Attr('tradeId').exists())
                security_filter = (
                    Attr('securitySymbol').eq(security_value.upper()) | 
                    Attr('securityName').contains(security_value)
                )
                scan_kwargs['FilterExpression'] = existing_filter & security_filter
            
            # Transaction date range filter
            if filters.get('dateFrom') or filters.get('dateTo'):
                date_from = filters.get('dateFrom')
                date_to = filters.get('dateTo')
                existing_filter = scan_kwargs.get('FilterExpression', Attr('tradeId').exists())
                
                # IMPORTANT: transactionDate is stored as YYYYMMDD integer (e.g., 20251021), NOT Unix timestamp
                if date_from and date_to:
                    try:
                        date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                        date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                        date_from_num = int(date_from_obj.strftime('%Y%m%d'))
                        date_to_num = int(date_to_obj.strftime('%Y%m%d'))
                        scan_kwargs['FilterExpression'] = existing_filter & Attr('transactionDate').between(date_from_num, date_to_num)
                    except ValueError as e:
                        logger.warning(f"⚠️ Invalid date format in scan: {e}")
                elif date_from:
                    try:
                        date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                        date_from_num = int(date_from_obj.strftime('%Y%m%d'))
                        scan_kwargs['FilterExpression'] = existing_filter & Attr('transactionDate').gte(date_from_num)
                    except ValueError as e:
                        logger.warning(f"⚠️ Invalid date format in scan: {e}")
                elif date_to:
                    try:
                        date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                        date_to_num = int(date_to_obj.strftime('%Y%m%d'))
                        scan_kwargs['FilterExpression'] = existing_filter & Attr('transactionDate').lte(date_to_num)
                    except ValueError as e:
                        logger.warning(f"⚠️ Invalid date format in scan: {e}")
            
            # Filing date range filter  
            if filters.get('filingDateFrom') or filters.get('filingDateTo'):
                filing_date_from = filters.get('filingDateFrom')
                filing_date_to = filters.get('filingDateTo')
                existing_filter = scan_kwargs.get('FilterExpression', Attr('tradeId').exists())
                
                # filingDate is stored as YYYY-MM-DD string
                if filing_date_from and filing_date_to:
                    scan_kwargs['FilterExpression'] = existing_filter & Attr('filingDate').between(filing_date_from, filing_date_to)
                elif filing_date_from:
                    scan_kwargs['FilterExpression'] = existing_filter & Attr('filingDate').gte(filing_date_from)
                elif filing_date_to:
                    scan_kwargs['FilterExpression'] = existing_filter & Attr('filingDate').lte(filing_date_to)
            
            # Execute scan
            logger.info(f"🔍 Executing scan with kwargs: {json.dumps({k: str(v) for k, v in scan_kwargs.items() if k != 'FilterExpression'}, default=str)}")
            response = table.scan(**scan_kwargs)
            items = response.get('Items', [])
            
            # Handle pagination
            total_scanned = response.get('ScannedCount', 0)
            last_evaluated_key = response.get('LastEvaluatedKey')
            
            logger.info(f"📊 Scan results - Items found: {len(items)}, Scanned: {total_scanned}, Has more: {last_evaluated_key is not None}")
            
            # Convert items
            results = [convert_from_dynamodb_format(item) for item in items]
            logger.info(f"✅ Converted {len(results)} items from DynamoDB format")
            
            return {
                'success': True,
                'results': results,
                'total_found': len(results),
                'page': page,
                'page_size': page_size,
                'has_more': last_evaluated_key is not None,
                'last_evaluated_key': last_evaluated_key
            }
        else:
            # Use GSI query (more efficient)
            logger.info(f"✅ Using GSI: {index_name}")
            query_kwargs = {
                'IndexName': index_name,
                'KeyConditionExpression': key_condition,
                'Limit': page_size,
                'ScanIndexForward': False  # Sort by transactionDate descending
            }
            
            if filter_expression:
                query_kwargs['FilterExpression'] = filter_expression
                logger.info(f"🔍 Added filter expression to query")
            
            # Log the key condition details
            if key_condition:
                logger.info(f"🔑 Key condition: {key_condition}")
            
            # Handle pagination
            if page > 1:
                logger.info(f"📄 Fetching page {page}, iterating through previous pages...")
                # For simplicity, we'll fetch all pages up to the requested page
                # In production, you'd want to store LastEvaluatedKey client-side
                for page_num in range(page - 1):
                    logger.info(f"📄 Fetching intermediate page {page_num + 1}")
                    response = table.query(**query_kwargs)
                    if 'LastEvaluatedKey' not in response:
                        logger.info(f"⚠️ No more pages available at page {page_num + 1}")
                        break
                    query_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
                    logger.info(f"✅ Page {page_num + 1} complete, found {response.get('Count', 0)} items")
            
            # Log query details before execution
            logger.info(f"🔍 Executing query with kwargs keys: {list(query_kwargs.keys())}")
            logger.info(f"🔍 Query details:")
            logger.info(f"   - IndexName: {query_kwargs.get('IndexName')}")
            logger.info(f"   - Limit: {query_kwargs.get('Limit')}")
            logger.info(f"   - ScanIndexForward: {query_kwargs.get('ScanIndexForward')}")
            logger.info(f"   - Has KeyConditionExpression: {query_kwargs.get('KeyConditionExpression') is not None}")
            logger.info(f"   - Has FilterExpression: {query_kwargs.get('FilterExpression') is not None}")
            logger.info(f"   - Has ExclusiveStartKey: {'ExclusiveStartKey' in query_kwargs}")
            
            # Try to extract key condition values for logging
            try:
                if key_condition:
                    # Log the key condition structure
                    logger.info(f"🔑 KeyConditionExpression structure: {type(key_condition).__name__}")
            except Exception as e:
                logger.warning(f"⚠️ Could not log key condition details: {e}")
            
            # Execute the query
            try:
                logger.info(f"🚀 Executing DynamoDB query now...")
                response = table.query(**query_kwargs)
                logger.info(f"✅ Query completed successfully")
            except Exception as query_error:
                logger.error(f"❌ DynamoDB query failed: {str(query_error)}")
                logger.error(f"❌ Query kwargs: {json.dumps({k: str(v) for k, v in query_kwargs.items() if k not in ['KeyConditionExpression', 'FilterExpression']}, default=str)}")
                raise
            
            items = response.get('Items', [])
            count = response.get('Count', 0)
            scanned_count = response.get('ScannedCount', 0)
            consumed_capacity = response.get('ConsumedCapacity', {})
            
            logger.info(f"📊 Query results - Items found: {len(items)}, Count: {count}, Scanned: {scanned_count}")
            logger.info(f"📊 Has LastEvaluatedKey: {'LastEvaluatedKey' in response}")
            if consumed_capacity:
                logger.info(f"📊 ConsumedCapacity: {json.dumps(consumed_capacity, default=str)}")
            
            if len(items) == 0:
                logger.warning(f"⚠️ No items returned from query!")
                logger.warning(f"⚠️ Query parameters:")
                logger.warning(f"   - Filters: {json.dumps(filters, default=str)}")
                logger.warning(f"   - Index: {index_name}")
                logger.warning(f"   - Table: {DYNAMODB_TABLE_NAME}")
                logger.warning(f"   - Scanned count: {scanned_count}")
                logger.warning(f"   - Count: {count}")
                logger.warning(f"   - This suggests the query executed but found no matching items")
                logger.warning(f"   - Possible causes:")
                logger.warning(f"     * Filter values don't match data format in table")
                logger.warning(f"     * Date range doesn't overlap with data")
                logger.warning(f"     * GSI doesn't contain data for these filter values")
            else:
                logger.info(f"✅ Sample item keys: {list(items[0].keys()) if items else 'N/A'}")
                # Log a sample item (first few fields only to avoid huge logs)
                if items:
                    sample = items[0]
                    sample_preview = {k: str(v)[:100] if len(str(v)) > 100 else v for k, v in list(sample.items())[:5]}
                    logger.info(f"✅ Sample item preview: {json.dumps(sample_preview, default=str)}")
                    # Log the actual values of key fields for debugging
                    key_fields = ['position', 'party', 'politicianName', 'transactionDate', 'securitySymbol']
                    for field in key_fields:
                        if field in sample:
                            logger.info(f"   - {field}: {repr(sample[field])}")
            
            # Convert items
            results = [convert_from_dynamodb_format(item) for item in items]
            logger.info(f"✅ Converted {len(results)} items from DynamoDB format")
            
            return {
                'success': True,
                'results': results,
                'total_found': count if count > 0 else len(results),
                'page': page,
                'page_size': page_size,
                'has_more': 'LastEvaluatedKey' in response,
                'last_evaluated_key': response.get('LastEvaluatedKey')
            }
    
    except Exception as e:
        logger.error(f"❌ Error searching trades: {str(e)}")
        import traceback
        logger.error(f"❌ Traceback: {traceback.format_exc()}")
        logger.error(f"❌ Filters that caused error: {json.dumps(filters, default=str)}")
        return {
            'success': False,
            'error': str(e),
            'results': [],
            'total_found': 0
        }


def lambda_handler(event, context):
    """
    Lambda handler for politician trades search
    
    Expected event structure (API Gateway AWS_PROXY):
    {
        "httpMethod": "POST",
        "body": "{\"politicianName\": \"...\", \"dateFrom\": \"2024-01-01\", ...}"
    }
    """
    # CORS headers
    cors_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Requested-With',
        'Access-Control-Allow-Methods': 'POST,OPTIONS,GET',
        'Access-Control-Allow-Credentials': 'true'
    }
    
    # Handle OPTIONS preflight request
    if event.get('httpMethod') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': json.dumps({'message': 'CORS preflight successful'})
        }
    
    try:
        logger.info(f"📥 Received event: httpMethod={event.get('httpMethod')}, has_body={bool(event.get('body'))}")
        
        # Parse request body
        body_str = event.get('body', '{}')
        if isinstance(body_str, str):
            body = json.loads(body_str) if body_str else {}
        else:
            body = body_str or {}
        
        logger.info(f"📋 Parsed request body: {json.dumps(body, default=str)}")
        
        # Extract query parameters
        filters = {
            'politicianName': body.get('politicianName'),
            'position': body.get('position'),
            'party': body.get('party'),
            'security': body.get('security'),  # Combined security symbol and name search
            'transactionType': body.get('transactionType'),
            'stateDistrict': body.get('stateDistrict'),
            'dateFrom': body.get('dateFrom'),  # Transaction date range
            'dateTo': body.get('dateTo'),
            'filingDateFrom': body.get('filingDateFrom'),  # Filing date range
            'filingDateTo': body.get('filingDateTo'),
            'amountRange': body.get('amountRange'),  # Standard amount range selection
            'requiresManualReview': body.get('requiresManualReview'),
            'isUnparsed': body.get('isUnparsed'),
            'matchConfidence': body.get('matchConfidence'),
        }
        
        # Remove None values
        filters = {k: v for k, v in filters.items() if v is not None and v != ''}
        
        logger.info(f"🔍 Active filters after cleanup: {json.dumps(filters, default=str)}")
        
        page = int(body.get('page', 1))
        page_size = min(int(body.get('pageSize', 50)), MAX_RESULTS)
        
        logger.info(f"📄 Pagination - page: {page}, page_size: {page_size}")
        
        # Perform search
        result = search_trades(filters, page, page_size)
        
        logger.info(f"✅ Search complete - success: {result.get('success')}, results_count: {len(result.get('results', []))}, total_found: {result.get('total_found', 0)}")
        
        # Return response
        response_body = json.dumps(result, cls=DecimalEncoder)
        logger.info(f"📤 Returning response with {len(result.get('results', []))} results")
        
        return {
            'statusCode': 200,
            'headers': cors_headers,
            'body': response_body
        }
    
    except Exception as e:
        logger.error(f"Error in lambda_handler: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            'statusCode': 500,
            'headers': cors_headers,
            'body': json.dumps({
                'success': False,
                'error': str(e)
            }, cls=DecimalEncoder)
        }

