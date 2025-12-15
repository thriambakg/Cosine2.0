"""
JSON Parser Helper - Utility for tools to parse JSON data from S3 or strings
Tools should use this instead of relying on orchestrator for JSON parsing
"""

import json
import logging
import os
from typing import Any, Dict, List, Optional

logger = logging.getLogger()

class JSONParserHelper:
    """Helper class for tools to parse JSON data"""
    
    @staticmethod
    def parse_json_data(data_source: Any) -> Dict[str, Any]:
        """
        Parse JSON data from various sources (S3 key string, JSON string, dict, etc.)
        
        Args:
            data_source: Can be:
                - S3 key string (will read from S3)
                - JSON string
                - Dict (already parsed)
                - File reference dict with s3_key
        
        Returns:
            Parsed JSON as dict
        """
        import boto3
        import os
        
        # If already a dict, return it
        if isinstance(data_source, dict):
            # Check if it's a file reference that needs to be resolved
            if 'file_reference' in data_source and 's3_key' in data_source.get('file_reference', {}):
                file_ref = data_source['file_reference']
                s3_key = file_ref.get('s3_key')
                if s3_key:
                    logger.info(f"Detected file reference, reading actual data from: {s3_key}")
                    return JSONParserHelper._read_json_from_s3(s3_key)
            return data_source
        
        # If it's a string, try to parse as JSON first
        if isinstance(data_source, str):
            # Try parsing as JSON string
            try:
                parsed = json.loads(data_source)
                if isinstance(parsed, dict):
                    # Check if it's a file reference
                    if 'file_reference' in parsed and 's3_key' in parsed.get('file_reference', {}):
                        file_ref = parsed['file_reference']
                        s3_key = file_ref.get('s3_key')
                        if s3_key:
                            logger.info(f"Detected file reference in JSON, reading actual data from: {s3_key}")
                            return JSONParserHelper._read_json_from_s3(s3_key)
                    return parsed
            except json.JSONDecodeError:
                # Not JSON, assume it's an S3 key
                logger.info(f"String is not JSON, treating as S3 key: {data_source}")
                return JSONParserHelper._read_json_from_s3(data_source)
        
        raise ValueError(f"Cannot parse data_source of type {type(data_source)}")
    
    @staticmethod
    def _read_json_from_s3(s3_key: str) -> Dict[str, Any]:
        """Read JSON file from S3"""
        import boto3
        from botocore.exceptions import ClientError
        
        s3_client = boto3.client('s3')
        bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
        
        if not bucket_name:
            raise ValueError("S3 bucket name not configured")
        
        try:
            response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            content = response['Body'].read().decode('utf-8')
            return json.loads(content)
        except ClientError as e:
            logger.error(f"Error reading from S3: {e}")
            raise
        except json.JSONDecodeError as e:
            logger.error(f"Error parsing JSON from S3: {e}")
            raise
    
    @staticmethod
    def extract_nested_field(data: Dict[str, Any], field_path: str) -> Any:
        """
        Extract a nested field from a dict using dot notation.
        
        Examples:
        - 'metrics_table' -> data.get('metrics_table')
        - 'portfolio.cagr' -> data.get('portfolio', {}).get('cagr')
        - 'time_series.portfolio_values' -> data.get('time_series', {}).get('portfolio_values')
        
        Args:
            data: Dictionary to extract from
            field_path: Dot-separated field path
        
        Returns:
            Extracted value or None
        """
        if not isinstance(data, dict):
            return None
        
        # Handle dot notation for nested paths
        if '.' in field_path:
            parts = field_path.split('.')
            current = data
            for part in parts:
                if isinstance(current, dict):
                    current = current.get(part)
                    if current is None:
                        return None
                else:
                    return None
            return current
        
        # Direct field access
        return data.get(field_path)
    
    @staticmethod
    def extract_multiple_fields(data: Dict[str, Any], field_paths: List[str]) -> Dict[str, Any]:
        """
        Extract multiple fields from a dict.
        
        Args:
            data: Dictionary to extract from
            field_paths: List of field paths (supports dot notation)
        
        Returns:
            Dict mapping field paths to extracted values
        """
        result = {}
        for field_path in field_paths:
            value = JSONParserHelper.extract_nested_field(data, field_path)
            if value is not None:
                result[field_path] = value
        return result

