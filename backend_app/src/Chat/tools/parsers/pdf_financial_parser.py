"""
PDF Financial Parser for extracting financial data from PDF financial documents
Uses Textract and existing PDFReader for extraction
"""

import logging
from typing import Dict, Any, Optional
from base_parser import BaseParser

logger = logging.getLogger()


class PDFFinancialParser(BaseParser):
    """
    Parser for PDF financial documents
    Uses Textract and text analysis for financial extraction
    """
    
    def __init__(self):
        super().__init__()
        # Import PDFReader for reuse
        try:
            from pdf_reader import PDFReader
            self.pdf_reader = PDFReader()
        except ImportError:
            logger.warning("PDFReader not available, PDF financial parsing will be limited")
            self.pdf_reader = None
    
    def parse(self, s3_key: str, content: bytes, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Parse PDF financial document
        
        Args:
            s3_key: S3 key of the PDF
            content: PDF content (bytes)
            metadata: Optional metadata
            
        Returns:
            Dict with extracted financial data
        """
        try:
            # Use existing PDF reader to extract text
            if self.pdf_reader:
                pdf_result = self.pdf_reader.read_pdf_from_s3(s3_key)
                
                if not pdf_result.get("success"):
                    return {
                        "success": False,
                        "error": pdf_result.get("error", "Failed to read PDF"),
                        "document_type": "pdf_financial"
                    }
                
                text_content = pdf_result.get("text_content", "")
                
                # Reuse SEC filing parser for financial extraction (similar patterns)
                try:
                    from parsers.sec_filing_parser import SECFilingParser
                except ImportError:
                    # Try absolute import
                    import sys
                    import os
                    sys.path.append(os.path.dirname(os.path.dirname(__file__)))
                    from parsers.sec_filing_parser import SECFilingParser
                sec_parser = SECFilingParser()
                
                # Extract financial data using same methods
                income_statement = sec_parser._extract_income_statement(text_content, text_content)
                balance_sheet = sec_parser._extract_balance_sheet(text_content, text_content)
                cash_flow = sec_parser._extract_cash_flow(text_content, text_content)
                
                # Calculate metrics
                metrics = sec_parser._calculate_metrics(income_statement, balance_sheet, cash_flow)
                
                return {
                    "success": True,
                    "document_type": "pdf_financial",
                    "metadata": metadata or {},
                    "income_statement": income_statement,
                    "balance_sheet": balance_sheet,
                    "cash_flow": cash_flow,
                    "metrics": metrics,
                    "raw_content_length": len(text_content)
                }
            else:
                # Fallback: basic text extraction
                text_content = self.decode_content(content)
                return {
                    "success": True,
                    "document_type": "pdf_financial",
                    "metadata": metadata or {},
                    "extracted_data": {
                        "text_preview": text_content[:1000]
                    },
                    "raw_content_length": len(text_content)
                }
                
        except Exception as e:
            logger.error(f"Error parsing PDF financial {s3_key}: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                "success": False,
                "error": str(e),
                "document_type": "pdf_financial"
            }

