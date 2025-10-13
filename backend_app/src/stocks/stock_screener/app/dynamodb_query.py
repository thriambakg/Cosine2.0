"""
DynamoDB Query Module for Stock Screener
Queries pre-cached stock data from DynamoDB using GSIs with numeric range queries
"""

import os
import logging
import boto3
from typing import Dict, List, Any, Optional
from decimal import Decimal
from boto3.dynamodb.conditions import Key, Attr

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# AWS clients
dynamodb = boto3.resource('dynamodb')

def get_stock_data_table():
    """Get DynamoDB table reference"""
    table_name = os.environ.get('STOCK_DATA_TABLE_NAME', 'cosine-stock-data-production')
    return dynamodb.Table(table_name)

def decimal_to_float(obj):
    """Convert Decimal objects to float for JSON serialization"""
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [decimal_to_float(item) for item in obj]
    return obj

def normalize_sector_name(sector: str) -> str:
    """
    Normalize sector names to match GICS standard.
    Handles legacy/shortened sector names.
    """
    sector_mapping = {
        'Technology': 'Information Technology',
        'Tech': 'Information Technology',
        'IT': 'Information Technology',
        'Healthcare': 'Health Care',
        'Financial Services': 'Financials',
        'Finance': 'Financials',
        'Comm Services': 'Communication Services',
        'Telecom': 'Communication Services',
        # Exact matches pass through
        'Information Technology': 'Information Technology',
        'Health Care': 'Health Care',
        'Financials': 'Financials',
        'Consumer Discretionary': 'Consumer Discretionary',
        'Consumer Staples': 'Consumer Staples',
        'Industrials': 'Industrials',
        'Energy': 'Energy',
        'Materials': 'Materials',
        'Real Estate': 'Real Estate',
        'Utilities': 'Utilities',
        'Communication Services': 'Communication Services',
    }
    return sector_mapping.get(sector, sector)


def query_stocks_by_criteria(
    criteria: Dict[str, Any], 
    max_results: int = 100,
    timeframe: str = '1d'
) -> List[Dict[str, Any]]:
    """
    Query pre-cached stock data from DynamoDB using GSIs with efficient numeric range queries.
    
    Args:
        criteria: Screening criteria with optional filters:
            - sectors: List[str] - GICS sector names
            - industries: List[str] - Industry names (legacy)
            - volatilityRange: [min, max] - Volatility range (e.g., [0.1, 0.3])
            - priceRange: [min, max] - Price range (e.g., [50, 200])
            - priceChangeRange: [min, max] - Price change % range (e.g., [-5, 5])
            - marketCapRange: [min, max] - Market cap range (e.g., [1e9, 1e12])
        max_results: Maximum number of results to return
        timeframe: Time period ('1d', '7d', '30d', '1y')
    
    Returns:
        List of stock data dictionaries
    """
    try:
        table = get_stock_data_table()
        results = []
        
        # Normalize sector names to handle legacy values
        if criteria.get('sectors'):
            criteria['sectors'] = [normalize_sector_name(s) for s in criteria['sectors']]
        if criteria.get('industries'):
            # Map old 'industries' to 'sectors' if sectors not provided
            if not criteria.get('sectors'):
                criteria['sectors'] = [normalize_sector_name(i) for i in criteria['industries']]
        
        logger.info(f"📊 Querying DynamoDB - timeframe: {timeframe}, criteria: {criteria}")
        
        # Determine which GSI to use based on criteria priority
        # Priority: Price Change > Sector+Volatility > Sector > Volatility > Market Cap > Price
        # Rationale: Price change filters are usually most selective
        
        # STRATEGY 1: Price change range query (most selective for screeners)
        if criteria.get('priceChangeRange'):
            logger.info("📊 Using Price Change Range GSI (GSI3)")
            change_min, change_max = criteria['priceChangeRange']
            
            response = table.query(
                IndexName='PriceChangeRangeIndex',
                KeyConditionExpression=Key('GSI3PK').eq(f'PRICE_CHANGE#{timeframe}') & 
                                     Key('GSI3SK').between(Decimal(str(change_min)), Decimal(str(change_max))),
                Limit=max_results * 10  # Get more to filter down by sector
            )
            results = response.get('Items', [])
            logger.info(f"  Found {len(results)} stocks with price change {change_min}%-{change_max}%")
        
        # STRATEGY 2: Sector-based query with volatility range
        elif criteria.get('sectors') and criteria.get('volatilityRange'):
            logger.info("📊 Using Sector+Volatility GSI (GSI1)")
            vol_min, vol_max = criteria['volatilityRange']
            
            for sector in criteria['sectors']:
                response = table.query(
                    IndexName='SectorVolatilityIndex',
                    KeyConditionExpression=Key('GSI1PK').eq(f'SECTOR#{sector}#{timeframe}') & 
                                         Key('GSI1SK').between(Decimal(str(vol_min)), Decimal(str(vol_max))),
                    Limit=max_results
                )
                results.extend(response.get('Items', []))
                logger.info(f"  Found {len(response.get('Items', []))} stocks in {sector} with vol {vol_min}-{vol_max}")
        
        # STRATEGY 3: Sector-only query (all volatilities)
        elif criteria.get('sectors'):
            logger.info("📊 Using Sector GSI (GSI1) - all volatilities")
            
            for sector in criteria['sectors']:
                response = table.query(
                    IndexName='SectorVolatilityIndex',
                    KeyConditionExpression=Key('GSI1PK').eq(f'SECTOR#{sector}#{timeframe}'),
                    Limit=max_results * 2  # Get more to filter down
                )
                results.extend(response.get('Items', []))
                logger.info(f"  Found {len(response.get('Items', []))} stocks in {sector}")
        
        # STRATEGY 4: Volatility range query
        elif criteria.get('volatilityRange'):
            logger.info("📊 Using Volatility Range GSI (GSI2)")
            vol_min, vol_max = criteria['volatilityRange']
            
            # Convert percentages to decimal (e.g., 15% → 0.15)
            vol_min_decimal = Decimal(str(vol_min / 100))
            vol_max_decimal = Decimal(str(vol_max / 100))
            
            response = table.query(
                IndexName='VolatilityRangeIndex',
                KeyConditionExpression=Key('GSI2PK').eq(f'VOLATILITY#{timeframe}') & 
                                     Key('GSI2SK').between(vol_min_decimal, vol_max_decimal),
                Limit=max_results * 2  # Get more to filter down
            )
            results = response.get('Items', [])
            logger.info(f"  Found {len(results)} stocks with volatility {vol_min}%-{vol_max}%")
        
        # STRATEGY 5: Market cap range query
        elif criteria.get('marketCapRange'):
            logger.info("📊 Using Market Cap Range GSI (GSI4)")
            cap_min, cap_max = criteria['marketCapRange']
            
            response = table.query(
                IndexName='MarketCapRangeIndex',
                KeyConditionExpression=Key('GSI4PK').eq(f'MARKET_CAP#{timeframe}') & 
                                     Key('GSI4SK').between(Decimal(str(cap_min)), Decimal(str(cap_max))),
                Limit=max_results * 2
            )
            results = response.get('Items', [])
            logger.info(f"  Found {len(results)} stocks with market cap ${cap_min:,.0f}-${cap_max:,.0f}")
        
        # STRATEGY 6: Price range query
        elif criteria.get('priceRange'):
            logger.info("📊 Using Price Range GSI (GSI5)")
            price_min, price_max = criteria['priceRange']
            
            response = table.query(
                IndexName='PriceRangeIndex',
                KeyConditionExpression=Key('GSI5PK').eq(f'PRICE#{timeframe}') & 
                                     Key('GSI5SK').between(Decimal(str(price_min)), Decimal(str(price_max))),
                Limit=max_results * 2
            )
            results = response.get('Items', [])
            logger.info(f"  Found {len(results)} stocks with price ${price_min}-${price_max}")
        
        # STRATEGY 7: No specific criteria - get all stocks for timeframe (limited)
        else:
            logger.info(f"📊 Scanning all stocks for timeframe {timeframe}")
            response = table.scan(
                FilterExpression=Attr('SK').eq(f'{timeframe}#CURRENT'),
                Limit=max_results
            )
            results = response.get('Items', [])
            logger.info(f"  Found {len(results)} stocks")
        
        # Apply additional filters in-memory for multi-criteria queries
        logger.info(f"📊 Applying additional filters to {len(results)} stocks...")
        logger.info(f"📊 Filters: sectors={criteria.get('sectors')}, priceChange={criteria.get('priceChangeRange')}, volatility={criteria.get('volatilityRange')}")
        
        filtered_results = []
        filter_debug_count = 0
        
        for stock in results:
            # Convert Decimal to float for comparisons
            stock_data = decimal_to_float(stock)
            
            # Debug log first few stocks
            if filter_debug_count < 3:
                logger.info(f"  Sample stock: {stock_data.get('symbol')} - sector={stock_data.get('sector')}, price_change={stock_data.get('price_change_percent')}%, volatility={stock_data.get('volatility')}, market_cap={stock_data.get('market_cap')}")
                filter_debug_count += 1
            
            # Apply all filters
            if not passes_all_filters(stock_data, criteria):
                continue
            
            filtered_results.append(stock_data)
        
        logger.info(f"✅ Filtered to {len(filtered_results)} stocks matching all criteria (from {len(results)} initial results)")
        
        # Sort by volume (liquidity) descending by default
        sort_by = criteria.get('sortBy', 'volume')
        sort_order = criteria.get('sortOrder', 'desc')
        
        if sort_by in ['volume', 'market_cap', 'volatility', 'price_change_percent', 'current_price']:
            filtered_results.sort(
                key=lambda x: x.get(sort_by, 0), 
                reverse=(sort_order == 'desc')
            )
            logger.info(f"🔽 Sorted by {sort_by} ({sort_order})")
        
        # Limit results
        final_results = filtered_results[:max_results]
        
        logger.info(f"✅ Returning {len(final_results)} stocks")
        return final_results
        
    except Exception as e:
        logger.error(f"❌ Error querying DynamoDB: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return []

def passes_all_filters(stock: Dict[str, Any], criteria: Dict[str, Any]) -> bool:
    """
    Check if a stock passes all filter criteria.
    
    Args:
        stock: Stock data dictionary
        criteria: Screening criteria
    
    Returns:
        True if stock passes all filters, False otherwise
    """
    # Sector filter
    if criteria.get('sectors'):
        if stock.get('sector') not in criteria['sectors']:
            return False
    
    # Industry filter (for backwards compatibility)
    if criteria.get('industries'):
        if stock.get('industry') not in criteria['industries']:
            return False
    
    # Volatility range filter
    if criteria.get('volatilityRange'):
        vol_min, vol_max = criteria['volatilityRange']
        # Volatility is already stored as decimal (e.g., 0.23 for 23%)
        # Frontend sends as percentage (0-100), so convert
        vol_min_decimal = vol_min / 100
        vol_max_decimal = vol_max / 100
        volatility = stock.get('volatility', 0)
        # Handle case where volatility might already be a percentage
        if volatility > 1:
            volatility = volatility / 100
        if not (vol_min_decimal <= volatility <= vol_max_decimal):
            return False
    
    # Price range filter
    if criteria.get('priceRange'):
        price_min, price_max = criteria['priceRange']
        current_price = stock.get('current_price', 0)
        if not (price_min <= current_price <= price_max):
            return False
    
    # Price change range filter
    if criteria.get('priceChangeRange'):
        change_min, change_max = criteria['priceChangeRange']
        price_change_percent = stock.get('price_change_percent', 0)
        if not (change_min <= price_change_percent <= change_max):
            return False
    
    # Market cap range filter
    if criteria.get('marketCapRange'):
        cap_min, cap_max = criteria['marketCapRange']
        market_cap = stock.get('market_cap', 0)
        if not (cap_min <= market_cap <= cap_max):
            return False
    
    # PE ratio filter
    if criteria.get('peRatioRange'):
        pe_min, pe_max = criteria['peRatioRange']
        pe_ratio = stock.get('pe_ratio', 0)
        if pe_ratio > 0:  # Only filter if PE ratio is available
            if not (pe_min <= pe_ratio <= pe_max):
                return False
    
    # Beta filter
    if criteria.get('betaRange'):
        beta_min, beta_max = criteria['betaRange']
        beta = stock.get('beta', 1.0)
        if not (beta_min <= beta <= beta_max):
            return False
    
    # Dividend yield filter
    if criteria.get('dividendYieldMin'):
        div_min = criteria['dividendYieldMin']
        dividend_yield = stock.get('dividend_yield', 0)
        if dividend_yield < div_min:
            return False
    
    # Volume filter (minimum)
    if criteria.get('minVolume'):
        min_vol = criteria['minVolume']
        volume = stock.get('volume', 0)
        if volume < min_vol:
            return False
    
    return True

def get_stock_by_symbol(symbol: str, timeframe: str = '1d') -> Optional[Dict[str, Any]]:
    """
    Get a single stock's data by symbol and timeframe.
    
    Args:
        symbol: Stock symbol (e.g., 'AAPL')
        timeframe: Time period ('1d', '7d', '30d', '1y')
    
    Returns:
        Stock data dictionary or None if not found
    """
    try:
        table = get_stock_data_table()
        
        response = table.get_item(
            Key={
                'PK': f'STOCK#{symbol.upper()}',
                'SK': f'{timeframe}#CURRENT'
            }
        )
        
        if 'Item' in response:
            return decimal_to_float(response['Item'])
        else:
            logger.warning(f"Stock {symbol} not found in cache for timeframe {timeframe}")
            return None
            
    except Exception as e:
        logger.error(f"Error fetching stock {symbol}: {str(e)}")
        return None

def get_industries_list(timeframe: str = '1d') -> List[str]:
    """
    Get list of all unique industries in the database.
    
    Args:
        timeframe: Time period to query
    
    Returns:
        List of industry names
    """
    try:
        table = get_stock_data_table()
        
        # Scan to get unique industries
        industries = set()
        
        response = table.scan(
            FilterExpression=Attr('SK').eq(f'{timeframe}#CURRENT'),
            ProjectionExpression='industry',
            Limit=1000  # Get sample
        )
        
        for item in response.get('Items', []):
            industry = item.get('industry')
            if industry and industry != 'Unknown':
                industries.add(industry)
        
        industry_list = sorted(list(industries))
        logger.info(f"Found {len(industry_list)} unique industries")
        return industry_list
        
    except Exception as e:
        logger.error(f"Error getting industries list: {str(e)}")
        return []

def get_cache_statistics(timeframe: str = '1d') -> Dict[str, Any]:
    """
    Get statistics about the cached stock data.
    
    Args:
        timeframe: Time period to query
    
    Returns:
        Dictionary with cache statistics
    """
    try:
        table = get_stock_data_table()
        
        # Count total stocks
        response = table.query(
            IndexName='VolatilityRangeIndex',
            KeyConditionExpression=Key('GSI2PK').eq(f'VOLATILITY#{timeframe}'),
            Select='COUNT'
        )
        
        total_count = response.get('Count', 0)
        
        # Get sample for quality check
        sample_response = table.scan(
            FilterExpression=Attr('SK').eq(f'{timeframe}#CURRENT'),
            Limit=10
        )
        
        sample_items = sample_response.get('Items', [])
        avg_age = 0
        if sample_items:
            from datetime import datetime
            timestamps = []
            for item in sample_items:
                last_updated = item.get('last_updated')
                if last_updated:
                    try:
                        dt = datetime.fromisoformat(last_updated.replace('Z', '+00:00'))
                        timestamps.append(dt)
                    except:
                        pass
            
            if timestamps:
                now = datetime.utcnow()
                ages = [(now - ts).total_seconds() / 3600 for ts in timestamps]  # Hours
                avg_age = sum(ages) / len(ages)
        
        return {
            'total_stocks': total_count,
            'timeframe': timeframe,
            'avg_age_hours': round(avg_age, 2),
            'sample_size': len(sample_items),
            'last_checked': datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error getting cache statistics: {str(e)}")
        return {
            'error': str(e),
            'total_stocks': 0
        }
