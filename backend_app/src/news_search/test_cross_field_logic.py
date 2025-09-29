#!/usr/bin/env python3
"""
Test script to demonstrate correct cross-field AND logic behavior.
"""

import json

def create_test_query(name, query_structure, expected_behavior):
    """Create a test query with expected behavior description."""
    return {
        "name": name,
        "payload": {
            "query": query_structure,
            "dateRange": "24h",
            "limit": 50,
            "offset": 0
        },
        "expected_behavior": expected_behavior
    }

def generate_cross_field_test_queries():
    """Generate test queries that demonstrate correct cross-field AND logic."""
    
    test_queries = []
    
    # 1. Keyword AND Source (both specified)
    test_queries.append(create_test_query(
        "Keyword AND Source (Both Specified)",
        {
            "keywords": {"type": "term", "field": "keywords", "value": "tesla"},
            "sources": {"type": "term", "field": "sources", "value": "Reuters"},
            "categories": None,
            "countries": None
        },
        "Find articles that contain 'tesla' AND are from 'Reuters' source"
    ))
    
    # 2. Keyword AND * (empty source)
    test_queries.append(create_test_query(
        "Keyword AND * (Empty Source)",
        {
            "keywords": {"type": "term", "field": "keywords", "value": "tesla"},
            "sources": None,  # Empty = wildcard (*)
            "categories": None,
            "countries": None
        },
        "Find articles that contain 'tesla' (source doesn't matter - treated as *)"
    ))
    
    # 3. * AND Source (empty keyword)
    test_queries.append(create_test_query(
        "* AND Source (Empty Keyword)",
        {
            "keywords": None,  # Empty = wildcard (*)
            "sources": {"type": "term", "field": "sources", "value": "Reuters"},
            "categories": None,
            "countries": None
        },
        "Find articles from 'Reuters' source (keyword doesn't matter - treated as *)"
    ))
    
    # 4. Complex Keyword AND Simple Source
    test_queries.append(create_test_query(
        "Complex Keyword AND Simple Source",
        {
            "keywords": {
                "type": "expression",
                "children": [
                    {"type": "term", "field": "keywords", "value": "tesla", "operator": "OR"},
                    {"type": "term", "field": "keywords", "value": "apple"}
                ]
            },
            "sources": {"type": "term", "field": "sources", "value": "Reuters"},
            "categories": None,
            "countries": None
        },
        "Find articles that contain ('tesla' OR 'apple') AND are from 'Reuters' source"
    ))
    
    # 5. Keyword AND Category AND * (empty source)
    test_queries.append(create_test_query(
        "Keyword AND Category AND *",
        {
            "keywords": {"type": "term", "field": "keywords", "value": "earnings"},
            "sources": None,  # Empty = wildcard (*)
            "categories": {"type": "term", "field": "categories", "value": "technology"},
            "countries": None
        },
        "Find articles that contain 'earnings' AND are in 'technology' category (source doesn't matter)"
    ))
    
    # 6. All fields specified
    test_queries.append(create_test_query(
        "All Fields Specified",
        {
            "keywords": {"type": "term", "field": "keywords", "value": "tesla"},
            "sources": {"type": "term", "field": "sources", "value": "Reuters"},
            "categories": {"type": "term", "field": "categories", "value": "technology"},
            "countries": {"type": "term", "field": "countries", "value": "US"}
        },
        "Find articles that contain 'tesla' AND are from 'Reuters' AND are in 'technology' category AND are from 'US'"
    ))
    
    # 7. Complex expressions in multiple fields
    test_queries.append(create_test_query(
        "Complex Keyword AND Complex Source",
        {
            "keywords": {
                "type": "expression",
                "children": [
                    {"type": "term", "field": "keywords", "value": "tesla", "operator": "OR"},
                    {"type": "term", "field": "keywords", "value": "apple"}
                ]
            },
            "sources": {
                "type": "expression",
                "children": [
                    {"type": "term", "field": "sources", "value": "Reuters", "operator": "OR"},
                    {"type": "term", "field": "sources", "value": "Bloomberg"}
                ]
            },
            "categories": None,
            "countries": None
        },
        "Find articles that contain ('tesla' OR 'apple') AND are from ('Reuters' OR 'Bloomberg')"
    ))
    
    return test_queries

def save_test_queries():
    """Save all test queries to a JSON file."""
    queries = generate_cross_field_test_queries()
    
    with open('cross_field_test_queries.json', 'w') as f:
        json.dump(queries, f, indent=2)
    
    print(f"✅ Generated {len(queries)} cross-field test queries")
    print("📁 Saved to: cross_field_test_queries.json")
    
    return queries

def print_query_summary(queries):
    """Print a summary of all test queries."""
    print("\n🧪 Cross-Field AND Logic Test Queries:")
    print("=" * 60)
    
    for i, query in enumerate(queries, 1):
        print(f"\n{i}. {query['name']}")
        print(f"   Expected: {query['expected_behavior']}")
        
        # Show the query structure
        query_struct = query['payload']['query']
        filters = []
        for field in ['keywords', 'sources', 'categories', 'countries']:
            if query_struct.get(field):
                if query_struct[field].get('type') == 'term':
                    filters.append(f"{field}: '{query_struct[field].get('value')}'")
                elif query_struct[field].get('type') == 'expression':
                    filters.append(f"{field}: (complex expression)")
            else:
                filters.append(f"{field}: * (wildcard)")
        
        print(f"   Filters: {' AND '.join(filters)}")

if __name__ == "__main__":
    print("🚀 Generating Cross-Field AND Logic Test Queries\n")
    
    queries = save_test_queries()
    print_query_summary(queries)
    
    print(f"\n📋 Summary:")
    print(f"   Total Queries: {len(queries)}")
    print(f"   Logic: All cross-field filters use AND logic")
    print(f"   Wildcards: Empty fields are treated as * (select all)")
    print(f"   Examples: keyword AND source, keyword AND *, * AND source")
    
    print(f"\n✅ All test queries generated successfully!")
    print(f"💡 Use these payloads to test the corrected cross-field AND logic.")
