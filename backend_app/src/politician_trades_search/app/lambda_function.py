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
    'securityName': 'SecurityNameTradeDateIndex',
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


def map_amount_range_to_standard_ranges(user_min: int, user_max: Optional[int]) -> List[tuple]:
    """
    Map a user-selected amount range to all STANDARD_PTR_RANGES that overlap with it.
    
    A standard range overlaps with the user range if:
    - The standard range's min <= user_max (if user_max exists) AND
    - The standard range's max >= user_min (or is None for open-ended ranges)
    
    Args:
        user_min: Minimum amount from user selection
        user_max: Maximum amount from user selection (None for open-ended)
        
    Returns:
        List of (min, max) tuples from STANDARD_PTR_RANGES that overlap with the user range
    """
    matching_ranges = []
    
    for std_min, std_max in STANDARD_PTR_RANGES:
        # Check if ranges overlap
        # Ranges overlap if: std_min <= user_max AND (std_max >= user_min OR std_max is None)
        if user_max is None:
            # User selected open-ended range (e.g., "$1000+")
            # Match if standard range's max >= user_min OR standard range is open-ended
            if std_max is None or std_max >= user_min:
                matching_ranges.append((std_min, std_max))
        else:
            # User selected bounded range (e.g., "$1000-$50000")
            # Ranges overlap if: std_min <= user_max AND (std_max >= user_min OR std_max is None)
            if std_min <= user_max and (std_max is None or std_max >= user_min):
                matching_ranges.append((std_min, std_max))
    
    logger.info(f"🔍 Mapped user range ({user_min}, {user_max}) to {len(matching_ranges)} standard ranges: {matching_ranges}")
    return matching_ranges


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
    # Priority order: politicianName > position > party > securitySymbol > securityName > transactionType > amountMin > stateDistrict
    
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
                # Multiple politicians - return None to indicate special handling needed
                logger.info(f"✅ Multiple politicians provided {politician_name_value}, will use multiple GSI queries")
                return None, None, None  # Signal that multi-politician search is needed
        else:
            # Single string value
            key_condition = Key('politicianName').eq(politician_name_value)
            logger.info(f"✅ Selected GSI: {index_name} for politicianName: '{politician_name_value}'")
    elif filters.get('position'):
        index_name = GSI_NAMES['position']
        position_value = filters['position']
        logger.info(f"🔍 Position value type: {type(position_value)}, value: {repr(position_value)}")
        
        # Handle both single string and array formats
        if isinstance(position_value, list):
            if len(position_value) == 1:
                # Single position in array - use GSI
                position_value = position_value[0]
                key_condition = Key('position').eq(position_value)
                logger.info(f"✅ Selected GSI: {index_name} for single position: '{position_value}'")
            else:
                # Multiple positions - cannot use GSI efficiently, fall back to scan
                logger.info(f"⚠️ Multiple positions provided {position_value}, falling back to scan")
                index_name = None
                key_condition = None
        else:
            # Single string value
            key_condition = Key('position').eq(position_value)
            logger.info(f"✅ Selected GSI: {index_name} for position: '{position_value}'")
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
        logger.info(f"🔍 Processing amountRange: {amount_ranges}, type: {type(amount_ranges)}")
        
        if isinstance(amount_ranges, list):
            if len(amount_ranges) == 1:
                # Single amount range - map to standard ranges and use GSI if possible
                amount_range_tuple = parse_amount_range_filter(amount_ranges[0])
                if amount_range_tuple:
                    user_min, user_max = amount_range_tuple
                    # Map user range to all overlapping standard ranges
                    matching_ranges = map_amount_range_to_standard_ranges(user_min, user_max)
                    
                    if matching_ranges:
                        # If only one matching range, use GSI directly
                        if len(matching_ranges) == 1:
                            std_min, std_max = matching_ranges[0]
                            index_name = GSI_NAMES['amountMin']
                            if std_max is None:
                                key_condition = Key('amountMin').gte(Decimal(str(std_min)))
                                logger.info(f"✅ Selected GSI: {index_name} for amount range: >= {std_min}")
                            else:
                                key_condition = Key('amountMin').between(Decimal(str(std_min)), Decimal(str(std_max)))
                                logger.info(f"✅ Selected GSI: {index_name} for amount range: {std_min} - {std_max}")
                        else:
                            # Multiple matching ranges - cannot use single GSI efficiently, fall back to scan
                            logger.info(f"⚠️ User range ({user_min}, {user_max}) maps to {len(matching_ranges)} standard ranges, falling back to scan")
                            index_name = None
                            key_condition = None
                    else:
                        logger.warning(f"⚠️ No matching standard ranges for user range: {amount_ranges[0]}")
                        index_name = None
                        key_condition = None
                else:
                    logger.warning(f"⚠️ Failed to parse amount range: {amount_ranges[0]}")
                    index_name = None
                    key_condition = None
            else:
                # Multiple amount ranges - use scan with filter
                logger.info(f"🔍 Multiple amount ranges ({len(amount_ranges)} items) will use scan with filter")
                index_name = None
                key_condition = None
        else:
            # Single string - parse the amount range filter (e.g., "$1,001-$15,000")
            logger.info(f"🔍 Processing single amount range string: '{amount_ranges}'")
            amount_range_tuple = parse_amount_range_filter(amount_ranges)
            if amount_range_tuple:
                user_min, user_max = amount_range_tuple
                # Map user range to all overlapping standard ranges
                matching_ranges = map_amount_range_to_standard_ranges(user_min, user_max)
                
                if matching_ranges:
                    # If only one matching range, use GSI directly
                    if len(matching_ranges) == 1:
                        std_min, std_max = matching_ranges[0]
                        index_name = GSI_NAMES['amountMin']
                        if std_max is None:
                            key_condition = Key('amountMin').gte(Decimal(str(std_min)))
                            logger.info(f"✅ Selected GSI: {index_name} for amount range: >= {std_min}")
                        else:
                            key_condition = Key('amountMin').between(Decimal(str(std_min)), Decimal(str(std_max)))
                            logger.info(f"✅ Selected GSI: {index_name} for amount range: {std_min} - {std_max}")
                    else:
                        # Multiple matching ranges - cannot use single GSI efficiently, fall back to scan
                        logger.info(f"⚠️ User range ({user_min}, {user_max}) maps to {len(matching_ranges)} standard ranges, falling back to scan")
                        index_name = None
                        key_condition = None
                else:
                    logger.warning(f"⚠️ No matching standard ranges for user range: {amount_ranges}")
                    index_name = None
                    key_condition = None
            else:
                logger.warning(f"⚠️ Failed to parse amount range: '{amount_ranges}'")
                index_name = None
                key_condition = None
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
        securities = filters['security']  # Always a list of strings
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
        elif len(securities) > 1:
            # Multiple securities - always use scan with filter
            logger.info(f"🔍 Multiple securities search ({len(securities)} items) will use scan with filter")
        # Empty list case is handled by the check above
    
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
        securities = filters['security']  # Always a list of strings
        
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
        
        if len(securities) == 1:
            # Single security
            security_filter = create_security_filter(securities[0])
            filter_conditions.append(security_filter)
            logger.info(f"🔍 Added security filter for: '{securities[0]}' (symbol/name/other search)")
        elif len(securities) > 1:
            # Multiple securities - use OR condition
            combined_filter = None
            for security_value in securities:
                single_filter = create_security_filter(security_value)
                if combined_filter is None:
                    combined_filter = single_filter
                else:
                    combined_filter = combined_filter | single_filter
            filter_conditions.append(combined_filter)
            logger.info(f"🔍 Added multiple securities filter: {securities} (symbol/name/other search)")
        # Empty list case is handled by the check above
    
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
                    user_min, user_max = amount_range_tuple
                    # Map user range to all overlapping standard ranges
                    matching_ranges = map_amount_range_to_standard_ranges(user_min, user_max)
                    
                    if matching_ranges:
                        # Create OR condition for all matching standard ranges
                        range_filter = None
                        for std_min, std_max in matching_ranges:
                            if std_max is None:
                                # Open-ended range (e.g., "$50,000,001+")
                                range_condition = Attr('amountMin').gte(Decimal(str(std_min)))
                            else:
                                # Bounded range - check if amountMin falls within the standard range
                                # A trade's amountMin is in the range if: std_min <= amountMin <= std_max
                                range_condition = Attr('amountMin').between(Decimal(str(std_min)), Decimal(str(std_max)))
                            
                            if range_filter is None:
                                range_filter = range_condition
                            else:
                                range_filter = range_filter | range_condition
                        
                        if range_filter is not None:
                            filter_conditions.append(range_filter)
                            logger.info(f"🔍 Added amount range filter mapping ({user_min}, {user_max}) to {len(matching_ranges)} standard ranges")
            elif len(amount_ranges) > 1:
                # Multiple amount ranges - use OR condition
                range_filter = None
                for amount_range in amount_ranges:
                    amount_range_tuple = parse_amount_range_filter(amount_range)
                    if amount_range_tuple:
                        user_min, user_max = amount_range_tuple
                        # Map user range to all overlapping standard ranges
                        matching_ranges = map_amount_range_to_standard_ranges(user_min, user_max)
                        
                        for std_min, std_max in matching_ranges:
                            if std_max is None:
                                range_condition = Attr('amountMin').gte(Decimal(str(std_min)))
                            else:
                                range_condition = Attr('amountMin').between(Decimal(str(std_min)), Decimal(str(std_max)))
                            
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
                user_min, user_max = amount_range_tuple
                # Map user range to all overlapping standard ranges
                matching_ranges = map_amount_range_to_standard_ranges(user_min, user_max)
                
                if matching_ranges:
                    # Create OR condition for all matching standard ranges
                    range_filter = None
                    for std_min, std_max in matching_ranges:
                        if std_max is None:
                            range_condition = Attr('amountMin').gte(Decimal(str(std_min)))
                        else:
                            range_condition = Attr('amountMin').between(Decimal(str(std_min)), Decimal(str(std_max)))
                        
                        if range_filter is None:
                            range_filter = range_condition
                        else:
                            range_filter = range_filter | range_condition
                    
                    if range_filter is not None:
                        filter_conditions.append(range_filter)
                        logger.info(f"🔍 Added amount range filter mapping ({user_min}, {user_max}) to {len(matching_ranges)} standard ranges")
    
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
    
    # Add transactionDate range filter when not using GSI (for scan operations)
    # IMPORTANT: transactionDate is stored as YYYYMMDD integer (e.g., 20251021), NOT Unix timestamp
    if not index_name and (filters.get('dateFrom') or filters.get('dateTo')):
        date_from = filters.get('dateFrom')
        date_to = filters.get('dateTo')
        
        logger.info(f"📅 Processing transaction date range for scan - dateFrom: {date_from}, dateTo: {date_to}")
        
        if date_from and date_to:
            # Convert date strings to YYYYMMDD integer format
            try:
                date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                date_from_num = int(date_from_obj.strftime('%Y%m%d'))
                date_to_num = int(date_to_obj.strftime('%Y%m%d'))
                logger.info(f"📅 Transaction date range numeric for scan - from: {date_from_num} ({date_from}), to: {date_to_num} ({date_to})")
                filter_conditions.append(Attr('transactionDate').between(date_from_num, date_to_num))
            except ValueError as e:
                logger.warning(f"⚠️ Invalid date format for scan: {date_from} or {date_to}, error: {e}")
        elif date_from:
            try:
                date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                date_from_num = int(date_from_obj.strftime('%Y%m%d'))
                logger.info(f"📅 Transaction date from numeric for scan: {date_from_num} ({date_from})")
                filter_conditions.append(Attr('transactionDate').gte(date_from_num))
            except ValueError as e:
                logger.warning(f"⚠️ Invalid date format for scan: {date_from}, error: {e}")
        elif date_to:
            try:
                date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                date_to_num = int(date_to_obj.strftime('%Y%m%d'))
                logger.info(f"📅 Transaction date to numeric for scan: {date_to_num} ({date_to})")
                filter_conditions.append(Attr('transactionDate').lte(date_to_num))
            except ValueError as e:
                logger.warning(f"⚠️ Invalid date format for scan: {date_to}, error: {e}")
    
    if filter_conditions:
        filter_expression = filter_conditions[0]
        for condition in filter_conditions[1:]:
            filter_expression = filter_expression & condition
    
    return index_name, key_condition, filter_expression


def search_multiple_politicians(table, politician_names: List[str], filters: Dict[str, Any], max_results: int = 1000) -> List[Dict[str, Any]]:
    """
    Search for trades across multiple politicians using individual GSI queries and union results
    
    Args:
        table: DynamoDB table resource
        politician_names: List of politician names to search for
        filters: Additional filters to apply (dateFrom, dateTo, etc.)
        max_results: Maximum number of results to return across all politicians
    
    Returns:
        List of deduplicated trade records
    """
    all_results = []
    seen_trade_ids = set()
    
    logger.info(f"🔄 Starting multi-politician search for {len(politician_names)} politicians")
    
    for politician_name in politician_names:
        logger.info(f"🔍 Querying GSI for politician: {politician_name}")
        
        # Create individual filters for this politician
        individual_filters = filters.copy()
        individual_filters['politicianName'] = politician_name
        
        # Build query parameters for this individual politician
        index_name, key_condition, filter_expression = build_query_params(table, individual_filters, 1, max_results)
        
        if not index_name or not key_condition:
            logger.warning(f"⚠️ Could not build query for politician: {politician_name}")
            continue
            
        try:
            query_kwargs = {
                'IndexName': index_name,
                'KeyConditionExpression': key_condition,
                'Limit': max_results,
                'ScanIndexForward': False  # Most recent first
            }
            
            if filter_expression:
                query_kwargs['FilterExpression'] = filter_expression
            
            logger.info(f"🚀 Executing GSI query for {politician_name}")
            response = table.query(**query_kwargs)
            
            politician_results = response.get('Items', [])
            logger.info(f"📊 Found {len(politician_results)} results for {politician_name}")
            
            # Deduplicate by tradeId and add to results
            for item in politician_results:
                trade_id = item.get('tradeId')
                if trade_id and trade_id not in seen_trade_ids:
                    seen_trade_ids.add(trade_id)
                    all_results.append(item)
                    
            # Stop if we've reached the maximum results
            if len(all_results) >= max_results:
                logger.info(f"🛑 Reached maximum results limit: {max_results}")
                break
                
        except Exception as e:
            logger.error(f"❌ Error querying for politician {politician_name}: {str(e)}")
            continue
    
    logger.info(f"✅ Multi-politician search complete: {len(all_results)} total deduplicated results")
    return all_results


def is_valid_ticker(security: str) -> bool:
    """
    Check if a security string is a valid ticker symbol (can use GSI)
    
    Args:
        security: Security string to check
    
    Returns:
        True if it's a valid ticker, False otherwise (likely a security name)
    """
    security_value = security.strip().upper()
    return (2 <= len(security_value) <= 6 and 
            security_value.replace('.', '').replace('-', '').isalnum() and
            security_value.isupper())


def search_securities(table, securities: List[str], filters: Dict[str, Any], max_results: int = 1000) -> List[Dict[str, Any]]:
    """
    Unified security search that handles both tickers (GSI) and security names (scan).
    Works for both single and multiple securities.
    
    Args:
        table: DynamoDB table resource
        securities: List of security strings (tickers or names) to search for
                   Examples: ["NFLX", "WBD"] or ["HEMPFIELD PA AREA SCH DIST"]
        filters: Additional filters to apply (dateFrom, dateTo, etc.)
        max_results: Maximum number of results to return across all securities
    
    Returns:
        List of deduplicated trade records
    """
    all_results = []
    seen_trade_ids = set()
    
    logger.info(f"🔄 Starting unified security search for {len(securities)} securities: {securities}")
    
    # Separate tickers (can use GSI) from security names (need scan)
    tickers = []
    security_names = []
    
    for security in securities:
        security_stripped = security.strip()
        if is_valid_ticker(security_stripped):
            tickers.append(security_stripped.upper())
        else:
            # Keep original case for security names (e.g., "HEMPFIELD PA AREA SCH DIST")
            security_names.append(security_stripped)
    
    logger.info(f"📊 Security breakdown - Tickers (GSI): {tickers}, Names (scan): {security_names}")
    
    # Process tickers using GSI queries
    for ticker in tickers:
        logger.info(f"🔍 Querying GSI for ticker: {ticker}")
        
        # Create individual filters for this ticker
        individual_filters = filters.copy()
        individual_filters['security'] = [ticker]  # Pass as list to match expected format
        
        # Build query parameters for this individual ticker
        index_name, key_condition, filter_expression = build_query_params(table, individual_filters, 1, max_results)
        
        if not index_name or not key_condition:
            logger.warning(f"⚠️ Could not build query for ticker: {ticker}")
            continue
            
        try:
            query_kwargs = {
                'IndexName': index_name,
                'KeyConditionExpression': key_condition,
                'Limit': max_results,
                'ScanIndexForward': False  # Most recent first
            }
            
            if filter_expression:
                query_kwargs['FilterExpression'] = filter_expression
            
            logger.info(f"🚀 Executing GSI query for {ticker}")
            response = table.query(**query_kwargs)
            
            ticker_results = response.get('Items', [])
            logger.info(f"📊 Found {len(ticker_results)} results for ticker {ticker}")
            
            # Deduplicate by tradeId and add to results
            for item in ticker_results:
                trade_id = item.get('tradeId')
                if trade_id and trade_id not in seen_trade_ids:
                    seen_trade_ids.add(trade_id)
                    all_results.append(item)
                    
            # Stop if we've reached the maximum results
            if len(all_results) >= max_results:
                logger.info(f"🛑 Reached maximum results limit: {max_results}")
                break
                
        except Exception as e:
            logger.error(f"❌ Error querying for ticker {ticker}: {str(e)}")
            continue
    
    # Process security names using scan with filters (if we haven't hit max results and there are names)
    if security_names and len(all_results) < max_results:
        logger.info(f"🔍 Processing security names using scan: {security_names}")
        
        # Create security name filter
        def create_security_name_filter(security_value):
            """Create a comprehensive security filter for a security name"""
            security_value = security_value.strip()
            security_upper = security_value.upper()
            security_lower = security_value.lower()
            
            return (
                Attr('securityName').eq(security_value) |                    # Exact name match
                Attr('securityName').contains(security_value) |               # Name contains (original case)
                Attr('securityName').contains(security_lower) |               # Name contains (lowercase)
                Attr('securityName').contains(security_upper) |               # Name contains (uppercase)
                Attr('securityName').begins_with(security_value) |            # Name begins with (original case)
                Attr('securityName').begins_with(security_value.title()) |    # Name begins with (title case)
                # Also search securities with missing/empty symbols (other securities like bonds, school districts)
                (Attr('securitySymbol').not_exists() & Attr('securityName').contains(security_value)) |
                (Attr('securitySymbol').eq('') & Attr('securityName').contains(security_value)) |
                (Attr('securitySymbol').eq('--') & Attr('securityName').contains(security_value))
            )
        
        # Build combined filter for all names
        combined_name_filter = None
        for name in security_names:
            name_filter = create_security_name_filter(name)
            if combined_name_filter is None:
                combined_name_filter = name_filter
            else:
                combined_name_filter = combined_name_filter | name_filter
        
        # Build scan filter expression
        scan_filters = []
        if combined_name_filter:
            scan_filters.append(combined_name_filter)
        
        # Add date range filter if present
        if filters.get('dateFrom') or filters.get('dateTo'):
            date_from = filters.get('dateFrom')
            date_to = filters.get('dateTo')
            
            if date_from and date_to:
                try:
                    date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                    date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                    date_from_num = int(date_from_obj.strftime('%Y%m%d'))
                    date_to_num = int(date_to_obj.strftime('%Y%m%d'))
                    scan_filters.append(Attr('transactionDate').between(date_from_num, date_to_num))
                except ValueError as e:
                    logger.warning(f"⚠️ Invalid date format: {date_from} or {date_to}, error: {e}")
            elif date_from:
                try:
                    date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
                    date_from_num = int(date_from_obj.strftime('%Y%m%d'))
                    scan_filters.append(Attr('transactionDate').gte(date_from_num))
                except ValueError as e:
                    logger.warning(f"⚠️ Invalid date format: {date_from}, error: {e}")
            elif date_to:
                try:
                    date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
                    date_to_num = int(date_to_obj.strftime('%Y%m%d'))
                    scan_filters.append(Attr('transactionDate').lte(date_to_num))
                except ValueError as e:
                    logger.warning(f"⚠️ Invalid date format: {date_to}, error: {e}")
        
        # Combine all scan filters
        if scan_filters:
            scan_filter_expression = scan_filters[0]
            for f in scan_filters[1:]:
                scan_filter_expression = scan_filter_expression & f
            
            try:
                scan_kwargs = {
                    'FilterExpression': scan_filter_expression,
                    'Limit': max_results - len(all_results)  # Only get remaining needed results
                }
                
                logger.info(f"🚀 Executing scan for security names")
                response = table.scan(**scan_kwargs)
                
                name_results = response.get('Items', [])
                logger.info(f"📊 Found {len(name_results)} results for security names")
                
                # Deduplicate by tradeId and add to results
                for item in name_results:
                    trade_id = item.get('tradeId')
                    if trade_id and trade_id not in seen_trade_ids:
                        seen_trade_ids.add(trade_id)
                        all_results.append(item)
                        
            except Exception as e:
                logger.error(f"❌ Error scanning for security names: {str(e)}")
    
    logger.info(f"✅ Unified security search complete: {len(all_results)} total deduplicated results")
    return all_results


def search_trades(filters: Dict[str, Any], page: int = 1, page_size: int = 50, last_evaluated_key: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Search politician trades based on filters
    
    Args:
        filters: Dictionary of filter criteria
        page: Page number (1-indexed) - used for backward compatibility, ignored if last_evaluated_key provided
        page_size: Number of results per page
        last_evaluated_key: DynamoDB LastEvaluatedKey for cursor-based pagination (for "load more" feature)
    
    Returns:
        Dictionary with results and metadata including last_evaluated_key for next page
    """
    try:
        logger.info(f"🔍 Starting search_trades with filters: {json.dumps(filters, default=str)}, page: {page}, page_size: {page_size}")
        logger.info(f"📊 Table name: {DYNAMODB_TABLE_NAME}")
        
        table = dynamodb.Table(DYNAMODB_TABLE_NAME)
        
        # Check if we need to handle multiple politicians
        politician_names = filters.get('politicianName')
        if isinstance(politician_names, list) and len(politician_names) > 1:
            logger.info(f"🔄 Detected multiple politicians: {politician_names}")
            logger.info("✅ Using multiple GSI queries approach instead of scan")
            
            # For cursor-based pagination, we need to fetch more results and filter
            # Increase max_results to allow for cursor-based continuation
            fetch_limit = 1000 if not last_evaluated_key else 2000  # Fetch more if continuing
            
            # Use the new multi-politician search approach
            all_items = search_multiple_politicians(table, politician_names, filters, max_results=fetch_limit)
            
            # Sort by transactionDate descending (most recent first), then by tradeId for stability
            all_items.sort(key=lambda x: (x.get('transactionDate', 0), x.get('tradeId', '')), reverse=True)
            
            # Apply cursor-based pagination if cursor provided
            if last_evaluated_key:
                cursor_date = last_evaluated_key.get('transactionDate')
                cursor_trade_id = last_evaluated_key.get('tradeId')
                if cursor_date is not None:
                    # Filter items that come AFTER the cursor in descending sort order
                    # Since we sort DESC by (transactionDate, tradeId):
                    # - Items with date < cursor_date come after (include)
                    # - Items with date == cursor_date and tradeId < cursor_trade_id come after (include)
                    # - Items with date == cursor_date and tradeId == cursor_trade_id are the cursor (skip)
                    # - Items with date == cursor_date and tradeId > cursor_trade_id come before (skip)
                    # - Items with date > cursor_date come before (skip)
                    filtered_items = []
                    for item in all_items:
                        item_date = item.get('transactionDate', 0)
                        item_trade_id = item.get('tradeId', '')
                        if item_date < cursor_date:
                            # Older dates come after in descending order
                            filtered_items.append(item)
                        elif item_date == cursor_date:
                            if item_trade_id < cursor_trade_id:
                                # Same date, lower tradeId comes after in descending order
                                filtered_items.append(item)
                            elif item_trade_id == cursor_trade_id:
                                # This is the cursor item itself, skip it
                                continue
                            # else: item_trade_id > cursor_trade_id comes before, skip
                        # else: item_date > cursor_date comes before, skip
                    all_items = filtered_items
                    logger.info(f"📄 Applied cursor filter, {len(all_items)} items remaining after cursor")
            
            # Apply pagination (always take first page_size items after cursor)
            paginated_items = all_items[:page_size]
            
            # Convert from DynamoDB format
            converted_items = [convert_from_dynamodb_format(item) for item in paginated_items]
            
            # Generate cursor for next page if we have more items
            next_cursor = None
            if len(all_items) > page_size:
                last_item = paginated_items[-1]
                next_cursor = {
                    'transactionDate': last_item.get('transactionDate'),
                    'tradeId': last_item.get('tradeId')
                }
            
            logger.info(f"✅ Multi-politician search complete - success: True, results_count: {len(converted_items)}, total_found: {len(all_items)}, has_more: {next_cursor is not None}")
            return {
                'success': True,
                'results': converted_items,
                'total_found': len(all_items),  # Approximate total
                'page': page,
                'page_size': page_size,
                'has_more': next_cursor is not None,
                'last_evaluated_key': next_cursor  # Cursor for next "load more" request
            }
        
        # Check if we need to handle securities (single or multiple)
        securities = filters.get('security')
        if securities and isinstance(securities, list) and len(securities) > 0:
            logger.info(f"🔄 Detected securities search: {securities}")
            logger.info("✅ Using unified security search (GSI for tickers, scan for names)")
            
            # For cursor-based pagination, we need to fetch more results and filter
            # Increase max_results to allow for cursor-based continuation
            fetch_limit = 1000 if not last_evaluated_key else 2000  # Fetch more if continuing
            
            # Use the unified security search approach (handles both tickers and names)
            all_items = search_securities(table, securities, filters, max_results=fetch_limit)
            
            # Sort by transactionDate descending (most recent first), then by tradeId for stability
            all_items.sort(key=lambda x: (x.get('transactionDate', 0), x.get('tradeId', '')), reverse=True)
            
            # Apply cursor-based pagination if cursor provided
            if last_evaluated_key:
                cursor_date = last_evaluated_key.get('transactionDate')
                cursor_trade_id = last_evaluated_key.get('tradeId')
                if cursor_date is not None:
                    # Filter items that come AFTER the cursor in descending sort order
                    # Since we sort DESC by (transactionDate, tradeId):
                    # - Items with date < cursor_date come after (include)
                    # - Items with date == cursor_date and tradeId < cursor_trade_id come after (include)
                    # - Items with date == cursor_date and tradeId == cursor_trade_id are the cursor (skip)
                    # - Items with date == cursor_date and tradeId > cursor_trade_id come before (skip)
                    # - Items with date > cursor_date come before (skip)
                    filtered_items = []
                    for item in all_items:
                        item_date = item.get('transactionDate', 0)
                        item_trade_id = item.get('tradeId', '')
                        if item_date < cursor_date:
                            # Older dates come after in descending order
                            filtered_items.append(item)
                        elif item_date == cursor_date:
                            if item_trade_id < cursor_trade_id:
                                # Same date, lower tradeId comes after in descending order
                                filtered_items.append(item)
                            elif item_trade_id == cursor_trade_id:
                                # This is the cursor item itself, skip it
                                continue
                            # else: item_trade_id > cursor_trade_id comes before, skip
                        # else: item_date > cursor_date comes before, skip
                    all_items = filtered_items
                    logger.info(f"📄 Applied cursor filter, {len(all_items)} items remaining after cursor")
            
            # Apply pagination (always take first page_size items after cursor)
            paginated_items = all_items[:page_size]
            
            # Convert from DynamoDB format
            converted_items = [convert_from_dynamodb_format(item) for item in paginated_items]
            
            # Generate cursor for next page if we have more items
            next_cursor = None
            if len(all_items) > page_size:
                last_item = paginated_items[-1]
                next_cursor = {
                    'transactionDate': last_item.get('transactionDate'),
                    'tradeId': last_item.get('tradeId')
                }
            
            logger.info(f"✅ Security search complete - success: True, results_count: {len(converted_items)}, total_found: {len(all_items)}, has_more: {next_cursor is not None}")
            return {
                'success': True,
                'results': converted_items,
                'total_found': len(all_items),  # Approximate total
                'page': page,
                'page_size': page_size,
                'has_more': next_cursor is not None,
                'last_evaluated_key': next_cursor  # Cursor for next "load more" request
            }
        
        # Build query parameters for single politician or other GSI filters
        index_name, key_condition, filter_expression = build_query_params(table, filters, page, page_size)
        logger.info(f"🔧 Query params - index_name: {index_name}, has_key_condition: {key_condition is not None}, has_filter_expression: {filter_expression is not None}")
        
        # If no GSI filter is provided, use scan (less efficient but necessary)
        if not index_name:
            logger.info("⚠️ No GSI filter provided, using scan operation")
            logger.info(f"📋 Filters provided: {list(filters.keys())}")
            scan_kwargs = {
                'Limit': page_size
            }
            
            # Handle cursor-based pagination for scan
            if last_evaluated_key:
                logger.info(f"📄 Using cursor-based pagination for scan with LastEvaluatedKey")
                scan_kwargs['ExclusiveStartKey'] = convert_to_dynamodb_format(last_evaluated_key)
            
            # Build filter expression for scan
            if filter_expression:
                scan_kwargs['FilterExpression'] = filter_expression
            
            # Add attribute filters
            if filters.get('politicianName'):
                scan_kwargs['FilterExpression'] = (scan_kwargs.get('FilterExpression', Attr('tradeId').exists()) & 
                                                   Attr('politicianName').contains(filters['politicianName']))
            
            # Combined security search - always a list of strings
            if filters.get('security'):
                securities = filters['security']
                existing_filter = scan_kwargs.get('FilterExpression', Attr('tradeId').exists())
                
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
                
                if len(securities) == 1:
                    # Single security in list
                    security_filter = create_security_filter(securities[0])
                elif len(securities) > 1:
                    # Multiple securities - use OR condition
                    combined_filter = None
                    for security_value in securities:
                        single_filter = create_security_filter(security_value)
                        if combined_filter is None:
                            combined_filter = single_filter
                        else:
                            combined_filter = combined_filter | single_filter
                    security_filter = combined_filter
                else:
                    # Empty list, skip
                    security_filter = None
                
                if security_filter:
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
            last_evaluated_key_raw = response.get('LastEvaluatedKey')
            
            logger.info(f"📊 Scan results - Items found: {len(items)}, Scanned: {total_scanned}, Has more: {last_evaluated_key_raw is not None}")
            
            # Convert items
            results = [convert_from_dynamodb_format(item) for item in items]
            logger.info(f"✅ Converted {len(results)} items from DynamoDB format")
            
            # Convert LastEvaluatedKey to JSON-serializable format
            last_key = None
            if last_evaluated_key_raw:
                last_key = convert_from_dynamodb_format(last_evaluated_key_raw)
            
            return {
                'success': True,
                'results': results,
                'total_found': len(results),  # Approximate for scan
                'page': page,
                'page_size': page_size,
                'has_more': last_key is not None,
                'last_evaluated_key': last_key  # Cursor for next "load more" request
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
            
            # Handle pagination - prefer cursor-based (last_evaluated_key) over page-based
            if last_evaluated_key:
                # Use cursor-based pagination (for "load more" feature)
                logger.info(f"📄 Using cursor-based pagination with LastEvaluatedKey")
                query_kwargs['ExclusiveStartKey'] = convert_to_dynamodb_format(last_evaluated_key)
            elif page > 1:
                # Fallback to page-based pagination (for backward compatibility)
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
            
            # Convert LastEvaluatedKey to JSON-serializable format
            last_key = None
            if 'LastEvaluatedKey' in response:
                last_key = convert_from_dynamodb_format(response['LastEvaluatedKey'])
            
            return {
                'success': True,
                'results': results,
                'total_found': count if count > 0 else len(results),
                'page': page,
                'page_size': page_size,
                'has_more': last_key is not None,
                'last_evaluated_key': last_key  # Cursor for next "load more" request
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
        last_evaluated_key = body.get('lastEvaluatedKey')  # Cursor for "load more" pagination
        
        logger.info(f"📄 Pagination - page: {page}, page_size: {page_size}, has_cursor: {last_evaluated_key is not None}")
        
        # Perform search
        result = search_trades(filters, page, page_size, last_evaluated_key)
        
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

