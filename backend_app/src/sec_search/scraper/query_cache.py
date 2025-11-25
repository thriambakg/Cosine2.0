"""
Query cache helper for SEC search
Generates normalized query hashes and manages query cache lookups
"""

import json
import hashlib
import os
import logging
import boto3
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from decimal import Decimal

logger = logging.getLogger()


def convert_decimals(obj):
    """
    Recursively convert Decimal types to native Python types for JSON serialization
    
    Args:
        obj: Object that may contain Decimal values
        
    Returns:
        Object with Decimal values converted to int or float
    """
    if isinstance(obj, Decimal):
        # Convert Decimal to int if it's a whole number, otherwise float
        if obj % 1 == 0:
            return int(obj)
        return float(obj)
    elif isinstance(obj, dict):
        return {key: convert_decimals(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimals(item) for item in obj]
    return obj

# DynamoDB configuration
QUERY_CACHE_TABLE_NAME = os.environ.get('SEC_SEARCH_QUERY_CACHE_TABLE')
dynamodb = boto3.resource('dynamodb') if QUERY_CACHE_TABLE_NAME else None
query_cache_table = dynamodb.Table(QUERY_CACHE_TABLE_NAME) if dynamodb and QUERY_CACHE_TABLE_NAME else None

# S3 configuration
S3_BUCKET_NAME = os.environ.get('SEC_FILINGS_S3_BUCKET', 'cosine-sec-filings-production')
s3_client = boto3.client('s3') if S3_BUCKET_NAME else None


def normalize_search_params(search_params: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize search parameters by:
    1. Removing fields that shouldn't affect cache: reportingFor, incorporated, fileNumber, filmNumber
    2. Sorting lists for consistent hashing
    3. Removing None/empty values
    
    Args:
        search_params: Raw search parameters
        
    Returns:
        Normalized search parameters
    """
    normalized = {}
    
    # Fields to include in cache key
    cache_fields = ['cik', 'entityName', 'keywords', 'formTypes', 'dateFrom', 'dateTo', 'located', 'columns']
    
    for field in cache_fields:
        value = search_params.get(field)
        if value is not None:
            # Sort lists for consistent hashing
            if isinstance(value, list):
                normalized[field] = sorted(value) if value else []
            else:
                normalized[field] = value
    
    return normalized


def generate_query_hash(search_params: Dict[str, Any]) -> str:
    """
    Generate a hash of normalized search parameters
    
    Args:
        search_params: Search parameters
        
    Returns:
        SHA256 hash of normalized parameters (hex digest, first 32 chars)
    """
    normalized = normalize_search_params(search_params)
    
    # Convert to JSON string (sorted keys for consistency)
    json_str = json.dumps(normalized, sort_keys=True, separators=(',', ':'))
    
    # Generate hash
    hash_obj = hashlib.sha256(json_str.encode('utf-8'))
    return hash_obj.hexdigest()[:32]  # Use first 32 chars (64 hex chars = 32 bytes)


def get_cached_query(query_hash: str) -> Optional[Dict[str, Any]]:
    """
    Get cached query result from DynamoDB
    
    Args:
        query_hash: Hash of normalized search parameters
        
    Returns:
        Cached query data (job_id, results_s3_key, etc.) or None if not found
    """
    if not query_cache_table:
        logger.warning("Query cache table not configured")
        return None
    
    try:
        response = query_cache_table.get_item(Key={'queryHash': query_hash})
        if 'Item' in response:
            item = response['Item']
            logger.info(f"Found cached query for hash {query_hash}: job_id={item.get('job_id')}")
            cached_data = {
                'queryHash': item.get('queryHash'),
                'job_id': item.get('job_id'),
                'results_s3_key': item.get('results_s3_key'),
                'created_at': item.get('created_at'),
                'updated_at': item.get('updated_at'),
                'search_params': item.get('search_params', {}),
                'total_found': item.get('total_found'),
                'results_count': item.get('results_count')
            }
            # Convert Decimal types to native Python types for JSON serialization
            return convert_decimals(cached_data)
        return None
    except Exception as e:
        logger.error(f"Error getting cached query: {e}")
        return None


def check_s3_key_exists(s3_key: str) -> bool:
    """
    Check if S3 key exists
    
    Args:
        s3_key: S3 key to check
        
    Returns:
        True if key exists, False otherwise
    """
    if not s3_client or not s3_key:
        return False
    
    try:
        s3_client.head_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        return True
    except s3_client.exceptions.NoSuchKey:
        return False
    except Exception as e:
        logger.error(f"Error checking S3 key {s3_key}: {e}")
        return False


def get_cached_query_with_validation(query_hash: str) -> Optional[Dict[str, Any]]:
    """
    Get cached query and validate that S3 results still exist
    If cache exists but S3 key is missing, return None (cache is stale)
    
    Args:
        query_hash: Hash of normalized search parameters
        
    Returns:
        Cached query data if valid, None if not found or stale
    """
    cached = get_cached_query(query_hash)
    if not cached:
        return None
    
    # If results are stored in S3, verify the key exists
    results_s3_key = cached.get('results_s3_key')
    if results_s3_key:
        if not check_s3_key_exists(results_s3_key):
            logger.warning(f"Cached query {query_hash} has invalid S3 key {results_s3_key}, cache is stale")
            return None
    
    return cached


def store_cached_query(query_hash: str, job_id: str, search_params: Dict[str, Any], 
                      results_s3_key: Optional[str] = None, total_found: int = 0, 
                      results_count: int = 0) -> bool:
    """
    Store query cache entry in DynamoDB
    
    Args:
        query_hash: Hash of normalized search parameters
        job_id: Job ID associated with this query
        search_params: Original search parameters (for reference)
        results_s3_key: S3 key where results are stored (optional)
        total_found: Total results found
        results_count: Number of results returned
        
    Returns:
        True if successful, False otherwise
    """
    if not query_cache_table:
        logger.warning("Query cache table not configured")
        return False
    
    try:
        now = datetime.now(timezone.utc).isoformat()
        # TTL: 30 days (2592000 seconds)
        ttl = int((datetime.now(timezone.utc).timestamp() + 2592000))
        
        item = {
            'queryHash': query_hash,
            'job_id': job_id,
            'search_params': normalize_search_params(search_params),  # Store normalized params
            'created_at': now,
            'updated_at': now,
            'ttl': ttl
        }
        
        if results_s3_key:
            item['results_s3_key'] = results_s3_key
        
        if total_found:
            item['total_found'] = total_found
        
        if results_count:
            item['results_count'] = results_count
        
        query_cache_table.put_item(Item=item)
        logger.info(f"Stored cached query for hash {query_hash}: job_id={job_id}")
        return True
    except Exception as e:
        logger.error(f"Error storing cached query: {e}")
        return False


def update_cached_query_results(query_hash: str, results_s3_key: str, 
                                total_found: int, results_count: int) -> bool:
    """
    Update cached query with results information
    
    Args:
        query_hash: Hash of normalized search parameters
        results_s3_key: S3 key where results are stored
        total_found: Total results found
        results_count: Number of results returned
        
    Returns:
        True if successful, False otherwise
    """
    if not query_cache_table:
        return False
    
    try:
        now = datetime.now(timezone.utc).isoformat()
        # TTL: 30 days (2592000 seconds)
        ttl = int((datetime.now(timezone.utc).timestamp() + 2592000))
        
        query_cache_table.update_item(
            Key={'queryHash': query_hash},
            UpdateExpression='SET results_s3_key = :s3_key, total_found = :total, results_count = :count, updated_at = :updated, #ttl = :ttl',
            ExpressionAttributeNames={
                '#ttl': 'ttl'
            },
            ExpressionAttributeValues={
                ':s3_key': results_s3_key,
                ':total': total_found,
                ':count': results_count,
                ':updated': now,
                ':ttl': ttl
            }
        )
        logger.info(f"Updated cached query {query_hash} with results")
        return True
    except Exception as e:
        logger.error(f"Error updating cached query: {e}")
        return False

