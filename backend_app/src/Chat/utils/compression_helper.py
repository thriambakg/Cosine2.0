"""
Compression Helper Class

Centralized compression and decompression utilities for all tools.
Handles gzip compression with base64 encoding for data transmission.
"""

import gzip
import base64
import json
import logging
from typing import Any, Dict, Union

logger = logging.getLogger(__name__)

class CompressionHelper:
    """
    Centralized compression and decompression helper class.
    
    Provides standardized methods for compressing and decompressing data
    across all tools in the system.
    """
    
    # Default compression threshold (in characters)
    DEFAULT_COMPRESSION_THRESHOLD = 2000
    
    @staticmethod
    def compress_data(data: Any, compression_threshold: int = None) -> Union[Dict, Any]:
        """
        Compress data if it exceeds the threshold, otherwise return as-is.
        
        Args:
            data: Data to potentially compress
            compression_threshold: Minimum size (in characters) to trigger compression
            
        Returns:
            Compressed data structure or original data if below threshold
        """
        if compression_threshold is None:
            compression_threshold = CompressionHelper.DEFAULT_COMPRESSION_THRESHOLD
            
        try:
            # Convert data to JSON string to measure size
            json_str = json.dumps(data, default=str)
            original_size = len(json_str)
            
            # Check if compression is needed
            if original_size < compression_threshold:
                return data
            
            # Compress the data
            compressed_bytes = gzip.compress(json_str.encode('utf-8'))
            compressed_b64 = base64.b64encode(compressed_bytes).decode('utf-8')
            compressed_size = len(compressed_b64)
            compression_ratio = compressed_size / original_size
            
            logger.info(f"Compressed data: {original_size} -> {compressed_size} chars ({compression_ratio:.1%} of original)")
            
            # Return compressed data structure
            return {
                "_compressed": True,
                "_original_size": original_size,
                "_compressed_size": compressed_size,
                "_compression_ratio": compression_ratio,
                "data": compressed_b64,
                "original_data": data  # Fallback in case decompression fails
            }
            
        except Exception as e:
            logger.error(f"Error compressing data: {str(e)}")
            logger.error(f"Data type: {type(data)}")
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
                # Get compressed data
                compressed_b64 = data.get("data", "")
                if not compressed_b64:
                    logger.error("No compressed data found in compressed structure")
                    return data
                
                # Validate base64 string length
                if len(compressed_b64) % 4 != 0:
                    logger.error(f"Invalid base64 string length: {len(compressed_b64)} (not multiple of 4)")
                    logger.error(f"Base64 string preview: {compressed_b64[:100]}...")
                    # Try to pad the string
                    missing_padding = 4 - (len(compressed_b64) % 4)
                    compressed_b64 += '=' * missing_padding
                    logger.info(f"Padded base64 string to length: {len(compressed_b64)}")
                
                # Decode base64
                try:
                    compressed_bytes = base64.b64decode(compressed_b64.encode('utf-8'))
                except Exception as b64_error:
                    logger.error(f"Base64 decode error: {str(b64_error)}")
                    logger.error(f"Base64 string (first 200 chars): {compressed_b64[:200]}")
                    logger.error(f"Base64 string (last 200 chars): {compressed_b64[-200:]}")
                    # Try to use original_data as fallback
                    if 'original_data' in data:
                        logger.info("Using original_data as fallback due to base64 decode error")
                        return data['original_data']
                    raise b64_error
                
                # Decompress with gzip
                json_str = gzip.decompress(compressed_bytes).decode('utf-8')
                
                # Parse JSON
                decompressed_data = json.loads(json_str)
                
                original_size = data.get('_original_size', 0)
                compressed_size = data.get('_compressed_size', 0)
                logger.info(f"Decompressed data: {compressed_size} -> {original_size} chars")
                
                return decompressed_data
            else:
                # Data is not compressed, return as-is
                return data
                
        except Exception as e:
            logger.error(f"Error decompressing data: {str(e)}")
            logger.error(f"Data type: {type(data)}")
            if isinstance(data, dict):
                logger.error(f"Data keys: {list(data.keys())}")
                if 'original_data' in data:
                    logger.info("Using original_data as fallback due to decompression error")
                    return data['original_data']
            return data  # Return original data if decompression fails
    
    @staticmethod
    def is_compressed(data: Any) -> bool:
        """
        Check if data is compressed.
        
        Args:
            data: Data to check
            
        Returns:
            True if data is compressed, False otherwise
        """
        return isinstance(data, dict) and data.get("_compressed") is True
    
    @staticmethod
    def get_compression_info(data: Any) -> Dict[str, Any]:
        """
        Get compression information from compressed data.
        
        Args:
            data: Potentially compressed data
            
        Returns:
            Dictionary with compression information
        """
        if CompressionHelper.is_compressed(data):
            return {
                "is_compressed": True,
                "original_size": data.get("_original_size", 0),
                "compressed_size": data.get("_compressed_size", 0),
                "compression_ratio": data.get("_compression_ratio", 0.0),
                "has_fallback": "original_data" in data
            }
        else:
            return {
                "is_compressed": False,
                "original_size": len(json.dumps(data, default=str)),
                "compressed_size": 0,
                "compression_ratio": 0.0,
                "has_fallback": False
            }





