#!/usr/bin/env python3
"""
Test script for news_search Lambda function
Tests the query logic and DynamoDB operations
"""

import json
import boto3
import os
from datetime import datetime, timedelta
import sys

# Set environment variables before importing the lambda function
os.environ['NEWS_TABLE_NAME'] = 'cosine-news-production'
os.environ['ENVIRONMENT'] = 'production'
os.environ['LOG_LEVEL'] = 'DEBUG'

# Add the app directory to the path so we can import the lambda function
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

# Import the lambda function components
from lambda_function import (
    build_dynamodb_query_params,
    execute_dynamodb_query,
    apply_client_side_filters,
    format_articles_for_frontend
)

def test_lambda_function():
    """Test the news search Lambda function logic"""
    
    # Set up DynamoDB connection (same as Lambda)
    dynamodb = boto3.resource('dynamodb')
    news_table_name = 'cosine-news-production'  # Use the same table name
    table = dynamodb.Table(news_table_name)
    
    print(f"🔍 Testing Lambda function with table: {news_table_name}")
    print("=" * 60)
    
    # Test 1: Simple keyword query for keywords that actually exist
    print("\n📝 Test 1: Simple keyword query for 'technical analysis' (exists in data)")
    test_event_1 = {
        "body": json.dumps({
            "query": {
                "keywords": {
                    "type": "term",
                    "field": "keywords", 
                    "value": "technical analysis"
                },
                "sources": None,
                "categories": None,
                "countries": None
            },
            "dateRange": "24h",
            "limit": 50,
            "offset": 0
        })
    }
    
    # Parse the test event
    body = json.loads(test_event_1['body'])
    query_filters = body.get('query', {})
    date_range = body.get('dateRange', '12h')
    limit = body.get('limit', 50)
    offset = body.get('offset', 0)
    
    print(f"Query filters: {json.dumps(query_filters, indent=2)}")
    print(f"Date range: {date_range}")
    print(f"Limit: {limit}")
    
    # Build query parameters
    query_params = build_dynamodb_query_params(query_filters, date_range, limit)
    print(f"Built query params: {json.dumps(query_params, indent=2)}")
    
    # Execute query
    try:
        response = execute_dynamodb_query(query_params)
        articles = response.get('Items', [])
        print(f"✅ Query successful! Retrieved {len(articles)} articles")
        
        if articles:
            print(f"Sample article: {json.dumps(articles[0], indent=2, default=str)}")
        else:
            print("❌ No articles found")
            
    except Exception as e:
        print(f"❌ Query failed: {str(e)}")
    
    print("\n" + "=" * 60)
    
    # Test 2: Check what's actually in the table
    print("\n📝 Test 2: Direct table scan to see what data exists")
    try:
        # Scan a few items to see the structure
        scan_response = table.scan(Limit=5)
        items = scan_response.get('Items', [])
        print(f"Found {len(items)} items in table")
        
        if items:
            print("Sample items:")
            for i, item in enumerate(items):
                print(f"\nItem {i+1}:")
                print(f"  PK: {item.get('PK', 'N/A')}")
                print(f"  SK: {item.get('SK', 'N/A')}")
                print(f"  Title: {item.get('title', 'N/A')}")
                print(f"  Keywords: {item.get('keywords', 'N/A')}")
                print(f"  Source: {item.get('source_name', 'N/A')}")
                print(f"  Category: {item.get('category', 'N/A')}")
                print(f"  Published: {item.get('published_date', 'N/A')}")
                
                # Check GSI keys
                print(f"  GSI1PK: {item.get('GSI1PK', 'N/A')}")
                print(f"  GSI3PK: {item.get('GSI3PK', 'N/A')}")
                print(f"  GSI4PK: {item.get('GSI4PK', 'N/A')}")
                print(f"  GSI5PK: {item.get('GSI5PK', 'N/A')}")
        else:
            print("❌ No items found in table")
            
    except Exception as e:
        print(f"❌ Scan failed: {str(e)}")
    
    print("\n" + "=" * 60)
    
    # Test 3: Test different GSI queries
    print("\n📝 Test 3: Test different GSI queries")
    
    # Test GSI4 (keywords) with keywords that actually exist
    gsi_tests = [
        {
            "name": "GSI4 Query - KEYWORD#technical analysis",
            "params": {
                "IndexName": "GSI4",
                "KeyConditionExpression": "GSI4PK = :gsi4pk",
                "ExpressionAttributeValues": {":gsi4pk": "KEYWORD#technical analysis"},
                "ScanIndexForward": False,
                "Limit": 10
            }
        },
        {
            "name": "GSI4 Query - KEYWORD#turbine blade",
            "params": {
                "IndexName": "GSI4", 
                "KeyConditionExpression": "GSI4PK = :gsi4pk",
                "ExpressionAttributeValues": {":gsi4pk": "KEYWORD#turbine blade"},
                "ScanIndexForward": False,
                "Limit": 10
            }
        },
        {
            "name": "GSI4 Query - KEYWORD#act",
            "params": {
                "IndexName": "GSI4",
                "KeyConditionExpression": "GSI4PK = :gsi4pk", 
                "ExpressionAttributeValues": {":gsi4pk": "KEYWORD#act"},
                "ScanIndexForward": False,
                "Limit": 10
            }
        }
    ]
    
    for test in gsi_tests:
        print(f"\n🔍 {test['name']}")
        try:
            result = table.query(**test['params'])
            items = result.get('Items', [])
            print(f"  ✅ Found {len(items)} items")
            
            if items:
                print(f"  Sample: {items[0].get('title', 'N/A')}")
                print(f"  Keywords: {items[0].get('keywords', 'N/A')}")
                
        except Exception as e:
            print(f"  ❌ Failed: {str(e)}")
    
    print("\n" + "=" * 60)
    
    # Test 4: Check if there are any items with "technical" in keywords
    print("\n📝 Test 4: Search for items containing 'technical' in keywords")
    try:
        # Use a filter expression to find items with "technical" in keywords
        filter_params = {
            "FilterExpression": "contains(keywords, :keyword)",
            "ExpressionAttributeValues": {":keyword": "technical"},
            "Limit": 10
        }
        
        result = table.scan(**filter_params)
        items = result.get('Items', [])
        print(f"Found {len(items)} items containing 'technical' in keywords")
        
        if items:
            for i, item in enumerate(items[:3]):  # Show first 3
                print(f"\nItem {i+1}:")
                print(f"  Title: {item.get('title', 'N/A')}")
                print(f"  Keywords: {item.get('keywords', 'N/A')}")
                print(f"  GSI4PK: {item.get('GSI4PK', 'N/A')}")
                
    except Exception as e:
        print(f"❌ Filter scan failed: {str(e)}")
    
    print("\n" + "=" * 60)
    print("🏁 Test completed!")

if __name__ == "__main__":
    test_lambda_function()

