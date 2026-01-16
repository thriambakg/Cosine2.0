"""
Document Router for routing documents to specialized parsers
Routes documents to appropriate parsers based on detected document type
"""

import logging
from typing import Dict, Any, Optional
from document_detector import DocumentType

logger = logging.getLogger()


class DocumentRouter:
    """
    Routes documents to appropriate specialized parsers based on document type
    """

    def __init__(self):
        self._parsers = {}
        self._initialize_parsers()

    def _initialize_parsers(self):
        """Initialize parser instances (lazy loading to avoid circular imports)"""
        # Parsers will be imported when needed
        pass

    def _get_parser(self, doc_type: DocumentType):
        """
        Get parser instance for document type (lazy import)
        
        Args:
            doc_type: DocumentType enum
            
        Returns:
            Parser instance
        """
        # Lazy import to avoid circular dependencies
        if doc_type == DocumentType.SEC_10K or doc_type == DocumentType.SEC_10Q:
            try:
                from parsers.sec_filing_parser import SECFilingParser
            except ImportError:
                # Try absolute import
                import sys
                import os
                tools_dir = os.path.dirname(__file__)
                if tools_dir not in sys.path:
                    sys.path.insert(0, tools_dir)
                from parsers.sec_filing_parser import SECFilingParser
            if 'sec_filing' not in self._parsers:
                self._parsers['sec_filing'] = SECFilingParser()
            return self._parsers['sec_filing']
        
        elif doc_type == DocumentType.SEC_8K:
            try:
                from parsers.sec_filing_parser import SECCurrentReportParser
            except ImportError:
                import sys
                import os
                tools_dir = os.path.dirname(__file__)
                if tools_dir not in sys.path:
                    sys.path.insert(0, tools_dir)
                from parsers.sec_filing_parser import SECCurrentReportParser
            if 'sec_8k' not in self._parsers:
                self._parsers['sec_8k'] = SECCurrentReportParser()
            return self._parsers['sec_8k']
        
        elif doc_type == DocumentType.SEC_FORM4:
            try:
                from parsers.sec_filing_parser import SECForm4Parser
            except ImportError:
                import sys
                import os
                tools_dir = os.path.dirname(__file__)
                if tools_dir not in sys.path:
                    sys.path.insert(0, tools_dir)
                from parsers.sec_filing_parser import SECForm4Parser
            if 'sec_form4' not in self._parsers:
                self._parsers['sec_form4'] = SECForm4Parser()
            return self._parsers['sec_form4']
        
        elif doc_type == DocumentType.XBRL:
            try:
                from parsers.xbrl_parser import XBRLParser
            except ImportError:
                import sys
                import os
                tools_dir = os.path.dirname(__file__)
                if tools_dir not in sys.path:
                    sys.path.insert(0, tools_dir)
                from parsers.xbrl_parser import XBRLParser
            if 'xbrl' not in self._parsers:
                self._parsers['xbrl'] = XBRLParser()
            return self._parsers['xbrl']
        
        elif doc_type == DocumentType.PDF_FINANCIAL:
            try:
                from parsers.pdf_financial_parser import PDFFinancialParser
            except ImportError:
                import sys
                import os
                tools_dir = os.path.dirname(__file__)
                if tools_dir not in sys.path:
                    sys.path.insert(0, tools_dir)
                from parsers.pdf_financial_parser import PDFFinancialParser
            if 'pdf_financial' not in self._parsers:
                self._parsers['pdf_financial'] = PDFFinancialParser()
            return self._parsers['pdf_financial']
        
        elif doc_type == DocumentType.FINANCIAL_STATEMENT:
            try:
                from parsers.sec_filing_parser import SECFilingParser  # Reuse SEC parser for financial statements
            except ImportError:
                import sys
                import os
                tools_dir = os.path.dirname(__file__)
                if tools_dir not in sys.path:
                    sys.path.insert(0, tools_dir)
                from parsers.sec_filing_parser import SECFilingParser
            if 'sec_filing' not in self._parsers:
                self._parsers['sec_filing'] = SECFilingParser()
            return self._parsers['sec_filing']
        
        else:
            # Unknown type - return basic text extractor
            try:
                from parsers.base_parser import BasicTextExtractor
            except ImportError:
                import sys
                import os
                tools_dir = os.path.dirname(__file__)
                if tools_dir not in sys.path:
                    sys.path.insert(0, tools_dir)
                from parsers.base_parser import BasicTextExtractor
            if 'basic' not in self._parsers:
                self._parsers['basic'] = BasicTextExtractor()
            return self._parsers['basic']

    def route_document(self, doc_type: DocumentType, s3_key: str, content: bytes, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Route document to appropriate parser and extract structured data
        
        Args:
            doc_type: Detected document type
            s3_key: S3 key of the document
            content: Full document content (bytes)
            metadata: Optional metadata from detection (CIK, accession number, etc.)
            
        Returns:
            Dict with extracted data from parser
        """
        try:
            parser = self._get_parser(doc_type)
            
            if parser is None:
                logger.warning(f"No parser available for document type: {doc_type}")
                return {
                    "success": False,
                    "error": f"No parser available for document type: {doc_type}",
                    "document_type": doc_type.value if isinstance(doc_type, DocumentType) else str(doc_type)
                }
            
            logger.info(f"Routing document {s3_key} (type: {doc_type}) to {parser.__class__.__name__}")
            
            # Call parser with metadata if available
            if metadata:
                result = parser.parse(s3_key, content, metadata=metadata)
            else:
                result = parser.parse(s3_key, content)
            
            return result
            
        except ImportError as e:
            logger.error(f"Error importing parser for {doc_type}: {e}")
            return {
                "success": False,
                "error": f"Parser not available: {str(e)}",
                "document_type": doc_type.value if isinstance(doc_type, DocumentType) else str(doc_type)
            }
        except Exception as e:
            logger.error(f"Error routing document {s3_key}: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                "success": False,
                "error": f"Error parsing document: {str(e)}",
                "document_type": doc_type.value if isinstance(doc_type, DocumentType) else str(doc_type)
            }

