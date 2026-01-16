"""
Document Index Query Tool for querying indexed financial data
Allows the agent to query structured financial data extracted from previously indexed documents
"""

import json
import os
import logging
from typing import Dict, Any, Optional, List

# Configure logging
logger = logging.getLogger()

# Import Strands types (available in Lambda layer)
try:
    from strands.types.tools import ToolResult, ToolUse
    from strands import tool
    # Import successful - no need to log
except ImportError as e:
    logger.warning(f"Failed to import Strands types: {e}")
    # Define fallback types for local development
    class ToolResult:
        def __init__(self, content: str, is_error: bool = False):
            self.content = content
            self.is_error = is_error
    
    class ToolUse:
        def __init__(self, name: str, arguments: Dict[str, Any]):
            self.name = name
            self.arguments = arguments
    
    def tool(func):
        return func

# Import document indexer
try:
    from document_indexer import DocumentIndexer
except ImportError:
    logger.warning("DocumentIndexer not available")
    DocumentIndexer = None


@tool
def get_document_index_tool(user_id: str, document_type: Optional[str] = None, 
                            company_name: Optional[str] = None, limit: int = 10) -> str:
    """
    Query indexed financial data from parsed documents
    
    Args:
        user_id: User ID to query documents for
        document_type: Optional document type filter (e.g., 'sec_10k', 'sec_10q', 'xbrl')
        company_name: Optional company name filter
        limit: Maximum number of results to return (default: 10)
        
    Returns:
        String with query results showing indexed financial data
    """
    try:
        if not DocumentIndexer:
            return "Error: Document indexer not available. Documents may not be indexed yet."
        
        indexer = DocumentIndexer()
        
        # Query documents
        if company_name:
            documents = indexer.query_by_company(user_id, company_name, limit)
        elif document_type:
            documents = indexer.query_by_user_and_type(user_id, document_type, limit)
        else:
            # Get all documents for user (requires scan - use with caution)
            # For now, require at least one filter
            return "Error: Must specify either document_type or company_name to query documents."
        
        if not documents:
            return f"No indexed documents found for user {user_id}" + \
                   (f" with type {document_type}" if document_type else "") + \
                   (f" for company {company_name}" if company_name else "") + \
                   ". Documents are automatically indexed when read for the first time."
        
        # Format results
        response_parts = [
            f"Found {len(documents)} indexed document(s):",
            ""
        ]
        
        for i, doc in enumerate(documents, 1):
            doc_type = doc.get("document_type", "unknown")
            metadata = doc.get("metadata", {})
            extracted = doc.get("extracted_data", {})
            
            response_parts.append(f"{i}. Document Type: {doc_type}")
            
            # Metadata
            if metadata.get("company_name"):
                response_parts.append(f"   Company: {metadata['company_name']}")
            if metadata.get("form_type"):
                response_parts.append(f"   Form: {metadata['form_type']}")
            if metadata.get("filing_date"):
                response_parts.append(f"   Filing Date: {metadata['filing_date']}")
            if metadata.get("period_end"):
                response_parts.append(f"   Period End: {metadata['period_end']}")
            
            # Income Statement summary
            income = extracted.get("income_statement", {})
            if income:
                response_parts.append(f"   Income Statement:")
                if income.get("revenue"):
                    rev_val = income["revenue"].get("value", 0) / 1_000_000_000
                    response_parts.append(f"     - Revenue: ${rev_val:.2f}B")
                if income.get("net_income"):
                    ni_val = income["net_income"].get("value", 0) / 1_000_000_000
                    response_parts.append(f"     - Net Income: ${ni_val:.2f}B")
                if income.get("eps"):
                    response_parts.append(f"     - EPS: ${income['eps'].get('value', 0):.2f}")
            
            # Balance Sheet summary
            balance = extracted.get("balance_sheet", {})
            if balance:
                response_parts.append(f"   Balance Sheet:")
                if balance.get("total_assets"):
                    assets_val = balance["total_assets"].get("value", 0) / 1_000_000_000
                    response_parts.append(f"     - Total Assets: ${assets_val:.2f}B")
                if balance.get("total_debt"):
                    debt_val = balance["total_debt"].get("value", 0) / 1_000_000_000
                    response_parts.append(f"     - Total Debt: ${debt_val:.2f}B")
                if balance.get("equity"):
                    equity_val = balance["equity"].get("value", 0) / 1_000_000_000
                    response_parts.append(f"     - Equity: ${equity_val:.2f}B")
            
            # Cash Flow summary
            cash_flow = extracted.get("cash_flow", {})
            if cash_flow:
                response_parts.append(f"   Cash Flow:")
                if cash_flow.get("operating_cash_flow"):
                    ocf_val = cash_flow["operating_cash_flow"].get("value", 0) / 1_000_000_000
                    response_parts.append(f"     - Operating CF: ${ocf_val:.2f}B")
                if cash_flow.get("free_cash_flow"):
                    fcf_val = cash_flow["free_cash_flow"].get("value", 0) / 1_000_000_000
                    response_parts.append(f"     - Free Cash Flow: ${fcf_val:.2f}B")
            
            # Metrics summary
            metrics = extracted.get("metrics", {})
            if metrics:
                response_parts.append(f"   Metrics:")
                if metrics.get("gross_margin"):
                    response_parts.append(f"     - Gross Margin: {metrics['gross_margin']:.1%}")
                if metrics.get("net_margin"):
                    response_parts.append(f"     - Net Margin: {metrics['net_margin']:.1%}")
                if metrics.get("debt_to_equity"):
                    response_parts.append(f"     - Debt-to-Equity: {metrics['debt_to_equity']:.2f}")
                if metrics.get("roe"):
                    response_parts.append(f"     - ROE: {metrics['roe']:.1%}")
            
            response_parts.append(f"   Index ID: {doc.get('document_id', 'N/A')}")
            response_parts.append("")
        
        return "\n".join(response_parts)
        
    except Exception as e:
        logger.error(f"Error querying document index: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return f"Error querying document index: {str(e)}"


@tool
def get_document_by_id_tool(document_id: str) -> str:
    """
    Get a specific indexed document by document ID
    
    Args:
        document_id: Document ID from previous index operations
        
    Returns:
        String with full document financial data
    """
    try:
        if not DocumentIndexer:
            return "Error: Document indexer not available."
        
        indexer = DocumentIndexer()
        document = indexer.get_document(document_id)
        
        if not document:
            return f"Document {document_id} not found in index."
        
        # Format full document data
        extracted = document.get("extracted_data", {})
        metadata = document.get("metadata", {})
        
        response_parts = [
            f"Document: {document_id}",
            f"Type: {document.get('document_type', 'unknown')}",
            f"S3 Key: {document.get('s3_key', 'N/A')}",
            f"Indexed At: {document.get('indexed_at', 'N/A')}",
            ""
        ]
        
        # Full financial data
        if extracted.get("income_statement"):
            response_parts.append("Income Statement:")
            income = extracted["income_statement"]
            for key, value in income.items():
                if isinstance(value, dict) and "value" in value:
                    val = value["value"] / 1_000_000_000 if value.get("value", 0) > 1_000_000 else value["value"] / 1_000_000
                    unit = "B" if value.get("value", 0) > 1_000_000 else "M"
                    response_parts.append(f"  {key}: ${val:.2f}{unit}")
        
        if extracted.get("balance_sheet"):
            response_parts.append("\nBalance Sheet:")
            balance = extracted["balance_sheet"]
            for key, value in balance.items():
                if isinstance(value, dict) and "value" in value:
                    val = value["value"] / 1_000_000_000 if value.get("value", 0) > 1_000_000 else value["value"] / 1_000_000
                    unit = "B" if value.get("value", 0) > 1_000_000 else "M"
                    response_parts.append(f"  {key}: ${val:.2f}{unit}")
        
        if extracted.get("cash_flow"):
            response_parts.append("\nCash Flow:")
            cash_flow = extracted["cash_flow"]
            for key, value in cash_flow.items():
                if isinstance(value, dict) and "value" in value:
                    val = value["value"] / 1_000_000_000 if value.get("value", 0) > 1_000_000 else value["value"] / 1_000_000
                    unit = "B" if value.get("value", 0) > 1_000_000 else "M"
                    response_parts.append(f"  {key}: ${val:.2f}{unit}")
        
        if extracted.get("metrics"):
            response_parts.append("\nMetrics:")
            metrics = extracted["metrics"]
            for key, value in metrics.items():
                if isinstance(value, (int, float)):
                    if 'margin' in key.lower() or 'roe' in key.lower() or 'roa' in key.lower():
                        response_parts.append(f"  {key}: {value:.1%}")
                    else:
                        response_parts.append(f"  {key}: {value:.2f}")
        
        return "\n".join(response_parts)
        
    except Exception as e:
        logger.error(f"Error getting document by ID: {e}")
        return f"Error getting document: {str(e)}"

