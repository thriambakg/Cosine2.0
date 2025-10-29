"""
Data compression utilities for efficient data passing between tools.
Reduces token usage while preserving all data integrity.
"""

import json
import gzip
import base64
import logging
from typing import Any, Dict, Union

logger = logging.getLogger()

class DataCompression:
    """Handles compression and decompression of large datasets for tool communication."""
    
    @staticmethod
    def compress_data(data: Any, compression_threshold: int = 1000) -> Union[Dict, str]:
        """
        Compress data if it's large enough to benefit from compression.
        
        Args:
            data: Data to potentially compress
            compression_threshold: Minimum character count to trigger compression
            
        Returns:
            Original data if small, or compressed data structure if large
        """
        try:
            # Convert to JSON string to measure size
            json_str = json.dumps(data, separators=(',', ':'))
            
            # If data is small, return as-is
            if len(json_str) < compression_threshold:
                return data
            
            # Compress the data
            compressed_bytes = gzip.compress(json_str.encode('utf-8'))
            compressed_b64 = base64.b64encode(compressed_bytes).decode('utf-8')
            
            # Return compressed data structure with fallback
            compressed_data = {
                "_compressed": True,
                "_original_size": len(json_str),
                "_compressed_size": len(compressed_b64),
                "_compression_ratio": round(len(compressed_b64) / len(json_str), 3),
                "data": compressed_b64,
                "original_data": data  # Store original data as fallback
            }
            
            logger.info(f"Compressed data: {len(json_str)} -> {len(compressed_b64)} chars ({compressed_data['_compression_ratio']:.1%} of original)")
            return compressed_data
            
        except Exception as e:
            logger.error(f"Error compressing data: {str(e)}")
            return data  # Return original data if compression fails
    
    @staticmethod
    def decompress_data(data: Any) -> Any:
        """
        Decompress data if it's compressed, otherwise return as-is.
        
        Args:
            data: Potentially compressed data
            
        Returns:
            Decompressed data or original data if not compressed
        """
        try:
            # Check if data is compressed
            if isinstance(data, dict) and data.get("_compressed") is True:
                # Decompress the data
                compressed_b64 = data.get("data", "")
                
                # Validate base64 string length
                if len(compressed_b64) % 4 != 0:
                    logger.error(f"Invalid base64 string length: {len(compressed_b64)} (not multiple of 4)")
                    logger.error(f"Base64 string preview: {compressed_b64[:100]}...")
                    # Try to pad the string
                    missing_padding = 4 - (len(compressed_b64) % 4)
                    compressed_b64 += '=' * missing_padding
                    logger.info(f"Padded base64 string to length: {len(compressed_b64)}")
                
                # Validate base64 characters
                try:
                    compressed_bytes = base64.b64decode(compressed_b64.encode('utf-8'))
                except Exception as b64_error:
                    logger.error(f"Base64 decode error: {str(b64_error)}")
                    logger.error(f"Base64 string (first 200 chars): {compressed_b64[:200]}")
                    logger.error(f"Base64 string (last 200 chars): {compressed_b64[-200:]}")
                    raise b64_error
                
                json_str = gzip.decompress(compressed_bytes).decode('utf-8')
                
                logger.info(f"Decompressed data: {data.get('_compressed_size', 0)} -> {data.get('_original_size', 0)} chars")
                return json.loads(json_str)
            else:
                # Data is not compressed, return as-is
                return data
                
        except Exception as e:
            logger.error(f"Error decompressing data: {str(e)}")
            logger.error(f"Data type: {type(data)}")
            if isinstance(data, dict):
                logger.error(f"Data keys: {list(data.keys())}")
                if 'data' in data:
                    logger.error(f"Compressed data length: {len(str(data['data']))}")
                    logger.error(f"Compressed data preview: {str(data['data'])[:100]}...")
            return data  # Return original data if decompression fails
    
    @staticmethod
    def is_compressed(data: Any) -> bool:
        """Check if data is compressed."""
        return isinstance(data, dict) and data.get("_compressed") is True
    
    @staticmethod
    def get_compression_info(data: Any) -> Dict[str, Any]:
        """Get compression information if data is compressed."""
        if isinstance(data, dict) and data.get("_compressed") is True:
            return {
                "is_compressed": True,
                "original_size": data.get("_original_size", 0),
                "compressed_size": data.get("_compressed_size", 0),
                "compression_ratio": data.get("_compression_ratio", 0)
            }
        return {"is_compressed": False}
