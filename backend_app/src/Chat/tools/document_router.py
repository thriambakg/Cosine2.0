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

    def route_document(self, doc_type: DocumentType, s3_key: str, content: Optional[bytes], metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Route document to appropriate parser and extract structured data
        
        Args:
            doc_type: Detected document type
            s3_key: S3 key of the document
            content: Full document content (bytes) or None if parser should read from S3
            metadata: Optional metadata from detection (CIK, accession number, etc.)
            
        Returns:
            Dict with extracted data from parser
        """
        content_size = len(content) if content else 0
        logger.info(f"🔄 [DOCUMENT_ROUTER] Starting routing for document: {s3_key}, type: {doc_type}, content_size: {content_size} bytes (content provided: {content is not None})")
        logger.info(f"📋 [DOCUMENT_ROUTER] Metadata: {metadata}")
        
        try:
            logger.info(f"🔍 [DOCUMENT_ROUTER] Getting parser for document type: {doc_type}")
            parser = self._get_parser(doc_type)
            
            if parser is None:
                logger.warning(f"⚠️ [DOCUMENT_ROUTER] No parser available for document type: {doc_type}")
                return {
                    "success": False,
                    "error": f"No parser available for document type: {doc_type}",
                    "document_type": doc_type.value if isinstance(doc_type, DocumentType) else str(doc_type)
                }
            
            parser_class_name = parser.__class__.__name__
            logger.info(f"✅ [DOCUMENT_ROUTER] Selected parser: {parser_class_name} for document {s3_key} (type: {doc_type})")
            
            # If content is None, parser will read from S3 using s3_key internally
            # This allows the parser to handle large files by reading in chunks
            if content is None:
                logger.info(f"📦 [DOCUMENT_ROUTER] Content is None - passing s3_key to parser for S3 reading: {s3_key}")
                logger.info(f"📦 [DOCUMENT_ROUTER] Parser will read from S3 internally and process in chunks if needed")
            
            # Call parser with metadata if available
            content_size_str = f"{len(content):,} bytes" if content else "None (will read from S3)"
            logger.info(f"📊 [DOCUMENT_ROUTER] Calling parser.parse() with s3_key: {s3_key}, content_size: {content_size_str}, metadata: {metadata is not None}")
            if metadata:
                result = parser.parse(s3_key, content, metadata=metadata)
            else:
                result = parser.parse(s3_key, content)
            
            logger.info(f"📊 [DOCUMENT_ROUTER] Parser returned - success: {result.get('success', False) if isinstance(result, dict) else False}")
            
            success = result.get("success", False) if isinstance(result, dict) else False
            logger.info(f"{'✅' if success else '❌'} [DOCUMENT_ROUTER] Parser completed - Success: {success}")
            if success:
                extracted_keys = list(result.get("extracted_data", {}).keys()) if isinstance(result, dict) and isinstance(result.get("extracted_data"), dict) else "N/A"
                logger.info(f"📊 [DOCUMENT_ROUTER] Extracted data keys: {extracted_keys}")
            
            return result
            
        except ImportError as e:
            logger.error(f"❌ [DOCUMENT_ROUTER] Error importing parser for {doc_type}: {e}")
            import traceback
            logger.error(f"❌ [DOCUMENT_ROUTER] Import error traceback: {traceback.format_exc()}")
            return {
                "success": False,
                "error": f"Parser not available: {str(e)}",
                "document_type": doc_type.value if isinstance(doc_type, DocumentType) else str(doc_type)
            }
        except Exception as e:
            logger.error(f"❌ [DOCUMENT_ROUTER] Error routing document {s3_key}: {e}")
            import traceback
            logger.error(f"❌ [DOCUMENT_ROUTER] Routing error traceback: {traceback.format_exc()}")
            return {
                "success": False,
                "error": f"Error parsing document: {str(e)}",
                "document_type": doc_type.value if isinstance(doc_type, DocumentType) else str(doc_type)
            }

