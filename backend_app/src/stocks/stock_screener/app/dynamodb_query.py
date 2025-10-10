"""
DynamoDB Query Module for Stock Screener
Queries pre-cached stock data from DynamoDB using GSIs for fast filtering
"""

import os
import logging
import boto3
from typing import Dict, List, Any, Optional
from decimal import Decimal

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

def query_stocks_by_criteria(criteria: Dict[str, Any], max_results: int = 100) -> List[Dict[str, Any]]:
    """
    Query pre-cached stock data from DynamoDB using GSIs.
    This is MUCH faster than fetching from Yahoo Finance.
    
    Args:
        criteria: Screening criteria with optional filters:
            - industries: List[str] - Industry names
            - volatilityRange: [min, max] - Volatility percentage range
            - priceRange: [min, max] - Price range
            - priceChangeRange: [min, max] - Price change percentage range
            - marketCapRange: [min, max] - Market cap range
        max_results: Maximum number of results to return
    
    Returns:
        List of stock data dictionaries
    """
    try:
        table = get_stock_data_table()
        results = []
        
        logger.info(f"📊 Querying DynamoDB with criteria: {criteria}")
        
        # Strategy: Query using the most selective GSI first
        if criteria.get('industries'):
            # Use GSI1 (IndustryIndex)
            logger.info(f"📊 Querying by industry: {criteria['industries']}")
            for industry in criteria['industries']:
                response = table.query(
                    IndexName='IndustryIndex',
                    KeyConditionExpression='GSI1PK = :industry AND GSI1SK = :current',
                    ExpressionAttributeValues={
                        ':industry': f'INDUSTRY#{industry}',
                        ':current': 'CURRENT'
                    },
                    Limit=max_results
                )
                results.extend(response.get('Items', []))
                logger.info(f"  Found {len(response.get('Items', []))} stocks in {industry}")
        
        elif criteria.get('volatilityRange'):
            # Use GSI2 (VolatilityIndex)
            vol_min, vol_max = criteria['volatilityRange']
            logger.info(f"📊 Querying by volatility range: {vol_min}% - {vol_max}%")
            
            # Map to categories
            categories = []
            if vol_min < 30:
                categories.append('LOW')
            if vol_min < 60 and vol_max >= 30:
                categories.append('MEDIUM')
            if vol_max >= 60:
                categories.append('HIGH')
            
            for category in categories:
                response = table.query(
                    IndexName='VolatilityIndex',
                    KeyConditionExpression='GSI2PK = :vol AND GSI2SK = :current',
                    ExpressionAttributeValues={
                        ':vol': f'VOLATILITY#{category}',
                        ':current': 'CURRENT'
                    },
                    Limit=max_results
                )
                results.extend(response.get('Items', []))
                logger.info(f"  Found {len(response.get('Items', []))} stocks with {category} volatility")
        
        elif criteria.get('priceRange'):
            # Use GSI5 (PriceIndex)
            price_min, price_max = criteria['priceRange']
            logger.info(f"📊 Querying by price range: ${price_min} - ${price_max}")
            
            # Map to categories
            categories = []
            if price_min < 10:
                categories.append('LOW')
            if price_min < 100 and price_max >= 10:
                categories.append('MEDIUM')
            if price_max >= 100:
                categories.append('HIGH')
            
            for category in categories:
                response = table.query(
                    IndexName='PriceIndex',
                    KeyConditionExpression='GSI5PK = :price AND GSI5SK = :current',
                    ExpressionAttributeValues={
                        ':price': f'PRICE#{category}',
                        ':current': 'CURRENT'
                    },
                    Limit=max_results
                )
                results.extend(response.get('Items', []))
                logger.info(f"  Found {len(response.get('Items', []))} stocks with {category} price")
        
        elif criteria.get('priceChangeRange'):
            # Use GSI3 (PriceChangeIndex)
            change_min, change_max = criteria['priceChangeRange']
            logger.info(f"📊 Querying by price change range: {change_min}% - {change_max}%")
            
            # Map to categories
            categories = []
            if change_min < -20:
                categories.append('VERY_LOW')
            if change_min < -5 and change_max >= -20:
                categories.append('LOW')
            if change_min < 5 and change_max >= -5:
                categories.append('MEDIUM')
            if change_min < 20 and change_max >= 5:
                categories.append('HIGH')
            if change_max >= 20:
                categories.append('VERY_HIGH')
            
            for category in categories:
                response = table.query(
                    IndexName='PriceChangeIndex',
                    KeyConditionExpression='GSI3PK = :change AND GSI3SK = :current',
                    ExpressionAttributeValues={
                        ':change': f'PRICE_CHANGE#{category}',
                        ':current': 'CURRENT'
                    },
                    Limit=max_results
                )
                results.extend(response.get('Items', []))
                logger.info(f"  Found {len(response.get('Items', []))} stocks with {category} price change")
        
        else:
            # No specific criteria - scan for all current stocks
            logger.info("📊 Scanning all current stocks (no specific criteria)")
            response = table.scan(
                FilterExpression='SK = :current',
                ExpressionAttributeValues={
                    ':current': 'CURRENT'
                },
                Limit=max_results
            )
            results = response.get('Items', [])
            logger.info(f"  Found {len(results)} stocks")
        
        # Apply fine-grained filters in-memory
        logger.info(f"📊 Applying fine-grained filters to {len(results)} stocks...")
        filtered_results = []
        
        for stock in results:
            # Convert Decimal to float for numeric comparisons
            stock = decimal_to_float(stock)
            
            # Price range filter
            if criteria.get('priceRange'):
                price_min, price_max = criteria['priceRange']
                current_price = stock.get('current_price', 0)
                if not (price_min <= current_price <= price_max):
                    continue
            
            # Volatility range filter
            if criteria.get('volatilityRange'):
                vol_min, vol_max = criteria['volatilityRange']
                volatility = stock.get('volatility', 0)
                if not (vol_min <= volatility <= vol_max):
                    continue
            
            # Price change range filter
            if criteria.get('priceChangeRange'):
                change_min, change_max = criteria['priceChangeRange']
                price_change_percent = stock.get('price_change_percent', 0)
                if not (change_min <= price_change_percent <= change_max):
                    continue
            
            # Market cap range filter
            if criteria.get('marketCapRange'):
                cap_min, cap_max = criteria['marketCapRange']
                market_cap = stock.get('market_cap', 0)
                if not (cap_min <= market_cap <= cap_max):
                    continue
            
            filtered_results.append(stock)
        
        logger.info(f"✅ Filtered to {len(filtered_results)} stocks matching all criteria")
        
        # Sort by volume (liquidity) descending
        filtered_results.sort(key=lambda x: x.get('volume', 0), reverse=True)
        
        # Limit results
        final_results = filtered_results[:max_results]
        
        logger.info(f"✅ Returning top {len(final_results)} stocks")
        return final_results
        
    except Exception as e:
        logger.error(f"❌ Error querying DynamoDB: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return []

def get_stock_by_symbol(symbol: str) -> Optional[Dict[str, Any]]:
    """
    Get a single stock's data by symbol.
    
    Args:
        symbol: Stock symbol (e.g., 'AAPL')
    
    Returns:
        Stock data dictionary or None if not found
    """
    try:
        table = get_stock_data_table()
        
        response = table.get_item(
            Key={
                'PK': f'STOCK#{symbol.upper()}',
                'SK': 'CURRENT'
            }
        )
        
        if 'Item' in response:
            return decimal_to_float(response['Item'])
        else:
            logger.warning(f"Stock {symbol} not found in cache")
            return None
            
    except Exception as e:
        logger.error(f"Error fetching stock {symbol}: {str(e)}")
        return None

