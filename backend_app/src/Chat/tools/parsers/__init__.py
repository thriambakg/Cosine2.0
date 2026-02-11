"""
Document Parsers Package
Specialized parsers for extracting structured data from different document types.
PDF: use pdf_parser.extract_text() for deterministic text extraction; pdf_financial_parser for financial PDFs.
"""

from .pdf_parser import extract_text, get_pdf_page_count, get_pdf_bytes_from_s3

__all__ = ["extract_text", "get_pdf_page_count", "get_pdf_bytes_from_s3"]
