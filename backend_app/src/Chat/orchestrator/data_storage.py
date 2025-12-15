"""
Data Storage - Handles S3 storage for large results
"""

import json
import logging
import os
import boto3
from datetime import datetime
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class DataStorage:
    """Handles S3 storage for large tool results"""
    
    def __init__(self):
        """Initialize data storage"""
        self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
        if not self.bucket_name:
            logger.warning("S3 bucket not configured - data storage disabled")
            self.s3_client = None
        else:
            self.s3_client = boto3.client('s3')
            logger.info(f"DataStorage initialized with bucket: {self.bucket_name}")
    
    def store_result(self, result: Any, tool_name: str, session_id: str, user_id: str) -> Dict[str, Any]:
        """
        Store a tool result in S3.
        
        Args:
            result: Tool result to store
            tool_name: Name of the tool
            session_id: Session ID
            user_id: User ID
            
        Returns:
            File reference with S3 key
        """
        if not self.s3_client:
            raise ValueError("S3 bucket not configured")
        
        # Convert result to JSON string
        # Remove original_data fallback from compressed data before storing
        if isinstance(result, str):
            try:
                # Try to parse as JSON to validate and clean
                parsed = json.loads(result)
                if isinstance(parsed, dict):
                    # Remove original_data if present (compression fallback)
                    if 'original_data' in parsed:
                        parsed.pop('original_data', None)
                    result_str = json.dumps(parsed)
                else:
                    result_str = result
            except:
                result_str = json.dumps(result)
        else:
            # Remove original_data if present
            if isinstance(result, dict) and 'original_data' in result:
                result = result.copy()
                result.pop('original_data', None)
            result_str = json.dumps(result)
        
        # Generate S3 key
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{tool_name}_{timestamp}.json"
        s3_key = f"users/{user_id}/sessions/{session_id}/data-files/{filename}"
        
        # Upload to S3
        self.s3_client.put_object(
            Bucket=self.bucket_name,
            Key=s3_key,
            Body=result_str.encode('utf-8'),
            ContentType='application/json'
        )
        
        logger.info(f"Stored result in S3: {s3_key} ({len(result_str)} bytes)")
        
        return {
            's3_key': s3_key,
            'filename': filename,
            'tool_name': tool_name,
            'size_bytes': len(result_str)
        }
    
    def retrieve_result(self, file_reference: Dict[str, Any]) -> Any:
        """
        Retrieve a stored result from S3.
        
        Args:
            file_reference: File reference with s3_key
            
        Returns:
            Retrieved result
        """
        if not self.s3_client:
            raise ValueError("S3 bucket not configured")
        
        s3_key = file_reference.get('s3_key')
        if not s3_key:
            raise ValueError("No s3_key in file_reference")
        
        # Download from S3
        response = self.s3_client.get_object(
            Bucket=self.bucket_name,
            Key=s3_key
        )
        
        result_str = response['Body'].read().decode('utf-8')
        
        # Parse JSON
        try:
            return json.loads(result_str)
        except:
            return result_str
