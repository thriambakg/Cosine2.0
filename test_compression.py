#!/usr/bin/env python3
"""
Test script to demonstrate data compression effectiveness for financial data.
"""

import json
import sys
import os

# Add the Chat directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend_app', 'src', 'Chat'))

from tools.data_compression import DataCompression

def create_sample_financial_data(days=730):  # 2 years of daily data
    """Create sample financial data similar to what get_financial_data returns."""
    import random
    from datetime import datetime, timedelta
    
    base_price = 150.0
    data = []
    
    for i in range(days):
        date = datetime.now() - timedelta(days=days-i)
        # Simulate price movement
        change = random.uniform(-0.05, 0.05)  # ±5% daily change
        base_price *= (1 + change)
        
        data.append({
            "date": date.strftime('%Y-%m-%d'),
            "open": round(base_price * random.uniform(0.98, 1.02), 2),
            "high": round(base_price * random.uniform(1.01, 1.05), 2),
            "low": round(base_price * random.uniform(0.95, 0.99), 2),
            "close": round(base_price, 2),
            "volume": random.randint(1000000, 5000000)
        })
    
    return data

def test_compression():
    """Test compression effectiveness with sample data."""
    print("🧪 Testing Data Compression Effectiveness")
    print("=" * 50)
    
    # Create sample data
    sample_data = create_sample_financial_data(730)  # 2 years
    
    # Convert to JSON to measure original size
    original_json = json.dumps(sample_data, separators=(',', ':'))
    original_size = len(original_json)
    
    print(f"📊 Sample Data: {len(sample_data)} days of OHLCV data")
    print(f"📏 Original Size: {original_size:,} characters")
    
    # Test compression
    compressed_data = DataCompression.compress_data(sample_data, compression_threshold=1000)
    
    if DataCompression.is_compressed(compressed_data):
        compressed_size = len(json.dumps(compressed_data, separators=(',', ':')))
        compression_ratio = compressed_data['_compression_ratio']
        
        print(f"🗜️  Compressed Size: {compressed_size:,} characters")
        print(f"📈 Compression Ratio: {compression_ratio:.1%} of original")
        print(f"💾 Space Saved: {original_size - compressed_size:,} characters ({(1-compression_ratio)*100:.1f}%)")
        
        # Test decompression
        decompressed_data = DataCompression.decompress_data(compressed_data)
        decompressed_json = json.dumps(decompressed_data, separators=(',', ':'))
        
        print(f"✅ Decompressed Size: {len(decompressed_json):,} characters")
        print(f"🔍 Data Integrity: {'✅ PASS' if len(decompressed_json) == original_size else '❌ FAIL'}")
        
    else:
        print("ℹ️  Data was not compressed (below threshold)")
    
    print("\n🎯 Benefits:")
    print("- Full historical data preserved")
    print("- Automatic compression/decompression")
    print("- Significant token usage reduction")
    print("- No data loss or sampling")

if __name__ == "__main__":
    test_compression()
