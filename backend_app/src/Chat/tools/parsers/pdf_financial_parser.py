"""
PDF Financial Parser: extract structured financial data from PDF financial documents.
Uses parsers.pdf_parser for deterministic text extraction; no dependency on tools outside parsers/.
"""

import logging
import sys
import os
from typing import Dict, Any, Optional

from .base_parser import BaseParser

logger = logging.getLogger(__name__)

# Ensure parsers package is on path when run from tools/
_parsers_dir = os.path.dirname(os.path.abspath(__file__))
_tools_dir = os.path.dirname(_parsers_dir)
if _tools_dir not in sys.path:
    sys.path.insert(0, _tools_dir)


def _get_pdf_text(s3_key: str, content: Optional[bytes]) -> str:
    """Get full text from PDF: use content if provided, else fetch from S3 via pdf_parser."""
    from .pdf_parser import extract_text, get_pdf_bytes_from_s3
    if content is not None:
        result = extract_text(content, page_numbers=None)
    else:
        try:
            raw = get_pdf_bytes_from_s3(s3_key)
            result = extract_text(raw, page_numbers=None)
        except Exception as e:
            logger.error("Failed to get PDF bytes from S3 for %s: %s", s3_key, e)
            return ""
    if not result.get("success"):
        raise ValueError(result.get("error", "Failed to extract PDF text"))
    return result.get("text", "")


class PDFFinancialParser(BaseParser):
    """
    Parser for PDF financial documents. Uses deterministic pdf_parser for text
    extraction and SECFilingParser patterns for financial structure.
    """

    def parse(
        self,
        s3_key: str,
        content: Optional[bytes],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        try:
            text_content = _get_pdf_text(s3_key, content)
        except ValueError as e:
            return {
                "success": False,
                "error": str(e),
                "document_type": "pdf_financial",
            }

        try:
            try:
                from .sec_filing_parser import SECFilingParser
            except ImportError:
                from parsers.sec_filing_parser import SECFilingParser
            sec_parser = SECFilingParser()
            income_statement = sec_parser._extract_income_statement(
                text_content, text_content
            )
            balance_sheet = sec_parser._extract_balance_sheet(
                text_content, text_content
            )
            cash_flow = sec_parser._extract_cash_flow(text_content, text_content)
            metrics = sec_parser._calculate_metrics(
                income_statement, balance_sheet, cash_flow
            )
            return {
                "success": True,
                "document_type": "pdf_financial",
                "metadata": metadata or {},
                "income_statement": income_statement,
                "balance_sheet": balance_sheet,
                "cash_flow": cash_flow,
                "metrics": metrics,
                "raw_content_length": len(text_content),
            }
        except Exception as e:
            logger.error("Error parsing PDF financial %s: %s", s3_key, e)
            import traceback
            logger.error(traceback.format_exc())
            return {
                "success": False,
                "error": str(e),
                "document_type": "pdf_financial",
            }
