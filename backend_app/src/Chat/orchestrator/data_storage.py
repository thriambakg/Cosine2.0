"""
Data Storage - S3 storage for large tool results
"""

import json
import os
import logging
import uuid
import boto3
from datetime import datetime
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class DataStorage:
    """
    Handles storage of large tool results in S3.
    Returns file references instead of raw data to prevent LLM context overflow.
    """
    
    def __init__(self):
        """Initialize data storage with S3 client."""
        self.s3_client = boto3.client('s3')
        self.bucket_name = os.environ.get('AGENT_FILES_BUCKET_NAME')
        
        if not self.bucket_name:
            logger.warning("AGENT_FILES_BUCKET_NAME not set, data storage will not work")
        
        logger.info(f"DataStorage initialized with bucket: {self.bucket_name}")
    
    def store_result(self, data: Any, tool_name: str, session_id: str, user_id: str) -> Dict[str, Any]:
        """
        Store large tool result in S3 and return file reference.
        
        Args:
            data: Tool result data to store
            tool_name: Name of the tool that produced the data
            session_id: Session ID
            user_id: User ID
            
        Returns:
            File reference with S3 key, filename, and metadata
        """
        if not self.bucket_name:
            raise ValueError("S3 bucket not configured")
        
        try:
            # Generate filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            file_id = uuid.uuid4().hex[:8]
            filename = f"{tool_name}_{timestamp}_{file_id}.json"
            
            # Determine S3 key (path)
            s3_key = f"agent-files/{user_id}/{session_id}/{filename}"
            
            # Convert data to JSON string
            if isinstance(data, str):
                data_str = data
            else:
                data_str = json.dumps(data, default=str)
            
            # Upload to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=data_str.encode('utf-8'),
                ContentType='application/json',
                Metadata={
                    'tool_name': tool_name,
                    'session_id': session_id,
                    'user_id': user_id,
                    'stored_at': datetime.now().isoformat(),
                    'data_size': str(len(data_str))
                }
            )
            
            logger.info(f"Stored tool result in S3: {s3_key} ({len(data_str)} bytes)")
            
            # Return file reference
            return {
                's3_key': s3_key,
                'filename': filename,
                'bucket': self.bucket_name,
                'tool_name': tool_name,
                'size_bytes': len(data_str),
                'stored_at': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error storing data in S3: {str(e)}")
            raise
    
    def retrieve_result(self, file_reference: Dict[str, Any]) -> Any:
        """
        Retrieve stored data from S3 using file reference.
        
        Args:
            file_reference: File reference returned by store_result
            
        Returns:
            Original data
        """
        try:
            s3_key = file_reference.get('s3_key')
            if not s3_key:
                raise ValueError("File reference missing s3_key")
            
            # Download from S3
            response = self.s3_client.get_object(
                Bucket=self.bucket_name,
                Key=s3_key
            )
            
            data_str = response['Body'].read().decode('utf-8')
            
            # Try to parse as JSON, otherwise return as string
            try:
                return json.loads(data_str)
            except json.JSONDecodeError:
                return data_str
                
        except Exception as e:
            logger.error(f"Error retrieving data from S3: {str(e)}")
            raise

