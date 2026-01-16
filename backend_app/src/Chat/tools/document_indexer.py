"""
Document Indexer for storing extracted structured data in DynamoDB
Enables fast retrieval and querying of financial data from parsed documents
"""

import os
import json
import hashlib
import boto3
import logging
from typing import Dict, Any, Optional
from datetime import datetime
from decimal import Decimal
from botocore.exceptions import ClientError

logger = logging.getLogger()


class DocumentIndexer:
    """
    Indexes extracted document data in DynamoDB for fast retrieval
    """
    
    def __init__(self):
        self.dynamodb = boto3.resource('dynamodb')
        self.table_name = os.environ.get('DOCUMENT_INDEX_TABLE_NAME')
        
        # Fallback to constructed name if env var not set
        if not self.table_name:
            project_name = os.environ.get('PROJECT_NAME', 'cosine')
            environment = os.environ.get('ENVIRONMENT', 'production')
            self.table_name = f"{project_name}-document-index-{environment}"
        
        logger.info(f"DocumentIndexer initialized with table: {self.table_name}")
    
    def index_document(self, user_id: str, s3_key: str, doc_info: Dict[str, Any], 
                       extracted_data: Dict[str, Any]) -> Optional[str]:
        """
        Index a document's extracted data in DynamoDB
        
        Args:
            user_id: User ID
            s3_key: S3 key of the document
            doc_info: Document detection info (type, confidence, metadata)
            extracted_data: Extracted structured data from parser
            
        Returns:
            Document ID (index key) or None if indexing failed
        """
        try:
            # Generate document ID
            s3_key_hash = hashlib.sha256(s3_key.encode()).hexdigest()[:16]
            document_id = f"{user_id}#{s3_key_hash}"
            
            # Check if already indexed
            if self._is_already_indexed(document_id):
                logger.info(f"Document {s3_key} already indexed, skipping")
                return document_id
            
            # Prepare index item
            index_item = {
                "document_id": document_id,
                "user_id": user_id,
                "s3_key": s3_key,
                "document_type": doc_info.get("type", {}).value if hasattr(doc_info.get("type"), 'value') else str(doc_info.get("type", "unknown")),
                "extracted_data": self._convert_to_decimal(extracted_data),
                "metadata": doc_info.get("metadata", {}),
                "confidence": Decimal(str(doc_info.get("confidence", 0.0))),
                "indexed_at": datetime.utcnow().isoformat(),
                "extraction_version": "1.0",
                "markers_found": doc_info.get("markers_found", [])
            }
            
            # Extract company name for GSI if available
            metadata = doc_info.get("metadata", {})
            if "company_name" in metadata:
                index_item["company_name"] = metadata["company_name"]
            
            # Store in DynamoDB
            table = self.dynamodb.Table(self.table_name)
            table.put_item(Item=index_item)
            
            logger.info(f"✅ Indexed document {s3_key} as {document_id}")
            return document_id
            
        except ClientError as e:
            logger.error(f"Error indexing document {s3_key}: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error indexing document {s3_key}: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return None
    
    def _is_already_indexed(self, document_id: str) -> bool:
        """
        Check if document is already indexed
        
        Args:
            document_id: Document ID to check
            
        Returns:
            True if already indexed, False otherwise
        """
        try:
            table = self.dynamodb.Table(self.table_name)
            response = table.get_item(Key={"document_id": document_id})
            return "Item" in response
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                logger.warning(f"Table {self.table_name} does not exist yet")
            else:
                logger.error(f"Error checking if document indexed: {e}")
            return False
        except Exception as e:
            logger.error(f"Error checking index: {e}")
            return False
    
    def _convert_to_decimal(self, obj: Any) -> Any:
        """
        Convert floats to Decimal for DynamoDB compatibility
        Recursively processes dicts and lists
        
        Args:
            obj: Object to convert
            
        Returns:
            Object with floats converted to Decimal
        """
        if isinstance(obj, float):
            return Decimal(str(obj))
        elif isinstance(obj, dict):
            return {k: self._convert_to_decimal(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._convert_to_decimal(item) for item in obj]
        elif isinstance(obj, int):
            return Decimal(str(obj))
        else:
            return obj
    
    def get_document(self, document_id: str) -> Optional[Dict[str, Any]]:
        """
        Get indexed document by ID
        
        Args:
            document_id: Document ID
            
        Returns:
            Indexed document data or None
        """
        try:
            table = self.dynamodb.Table(self.table_name)
            response = table.get_item(Key={"document_id": document_id})
            
            if "Item" in response:
                return response["Item"]
            return None
            
        except ClientError as e:
            logger.error(f"Error getting document {document_id}: {e}")
            return None
    
    def query_by_user_and_type(self, user_id: str, document_type: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Query documents by user and type
        
        Args:
            user_id: User ID
            document_type: Document type (e.g., "sec_10k")
            limit: Maximum number of results
            
        Returns:
            List of indexed documents
        """
        try:
            table = self.dynamodb.Table(self.table_name)
            
            # Use GSI: user_id + document_type
            response = table.query(
                IndexName='UserTypeIndex',  # Assumes GSI exists
                KeyConditionExpression='user_id = :uid AND document_type = :type',
                ExpressionAttributeValues={
                    ':uid': user_id,
                    ':type': document_type
                },
                Limit=limit
            )
            
            return response.get('Items', [])
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                logger.warning(f"Table or index does not exist: {e}")
            else:
                logger.error(f"Error querying documents: {e}")
            return []
    
    def query_by_company(self, user_id: str, company_name: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        Query documents by company name
        
        Args:
            user_id: User ID
            company_name: Company name to search for
            limit: Maximum number of results
            
        Returns:
            List of indexed documents
        """
        try:
            table = self.dynamodb.Table(self.table_name)
            
            # Use GSI: user_id + company_name
            response = table.query(
                IndexName='UserCompanyIndex',  # Assumes GSI exists
                KeyConditionExpression='user_id = :uid AND company_name = :company',
                ExpressionAttributeValues={
                    ':uid': user_id,
                    ':company': company_name
                },
                Limit=limit
            )
            
            return response.get('Items', [])
            
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                logger.warning(f"Table or index does not exist: {e}")
            else:
                logger.error(f"Error querying by company: {e}")
            return []

