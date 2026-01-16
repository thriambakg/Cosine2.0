"""
Document Type Detector for automatic document classification
Deterministically identifies document types using file markers, patterns, and content analysis
"""

import re
import logging
from typing import Dict, Any, Optional, List
from enum import Enum

logger = logging.getLogger()


class DocumentType(Enum):
    """Supported document types"""
    SEC_10K = "sec_10k"  # Annual report
    SEC_10Q = "sec_10q"  # Quarterly report
    SEC_8K = "sec_8k"  # Current report
    SEC_FORM4 = "sec_form4"  # Insider trading
    XBRL = "xbrl"  # XBRL structured data
    FINANCIAL_STATEMENT = "financial_statement"  # Generic financial document
    PDF_FINANCIAL = "pdf_financial"  # PDF-based financial reports
    UNKNOWN = "unknown"  # Fallback


class DocumentDetector:
    """
    Deterministically detects document types using:
    - Filename patterns
    - File extensions
    - Content markers (first 2KB scan)
    """

    # SEC filing filename pattern: CIK-ACCESSION_*.txt
    # Example: 0001628280-25-045968_9e6a49ae.txt
    SEC_FILENAME_PATTERN = re.compile(r'^(\d{10})-(\d{2})-(\d{6})_[\w]+\.(txt|html|xml)$', re.IGNORECASE)

    # SEC content markers (XML format)
    SEC_XML_MARKERS = [
        (r'<SEC-DOCUMENT>', 1.0),
        (r'<TYPE>10-K</TYPE>', 0.9),
        (r'<TYPE>10-Q</TYPE>', 0.9),
        (r'<TYPE>8-K</TYPE>', 0.9),
        (r'<TYPE>FORM\s+4</TYPE>', 0.9),
        (r'<ACCESSION-NUMBER>', 0.8),
        (r'<CENTRAL-INDEX-KEY>', 0.8),
        (r'<FILING-DATE>', 0.7),
    ]

    # SEC content markers (HTML/text format)
    SEC_HTML_MARKERS = [
        (r'CENTRAL INDEX KEY', 0.8),
        (r'ACCESSION NUMBER', 0.8),
        (r'FORM\s+10-K', 0.9),
        (r'FORM\s+10-Q', 0.9),
        (r'FORM\s+8-K', 0.9),
        (r'FORM\s+4', 0.9),
        (r'SECURITIES AND EXCHANGE COMMISSION', 0.7),
        (r'UNITED STATES\s+SECURITIES AND EXCHANGE COMMISSION', 0.8),
    ]

    # Financial statement markers
    FINANCIAL_MARKERS = [
        (r'CONSOLIDATED STATEMENTS? OF', 0.8),
        (r'BALANCE SHEET', 0.9),
        (r'INCOME STATEMENT', 0.9),
        (r'STATEMENT OF CASH FLOWS?', 0.9),
        (r'STATEMENT OF OPERATIONS', 0.8),
        (r'TOTAL REVENUE', 0.7),
        (r'NET INCOME', 0.7),
        (r'TOTAL ASSETS', 0.7),
    ]

    # XBRL markers
    XBRL_MARKERS = [
        (r'<xbrl[:\s]', 1.0),
        (r'xmlns:xbrl', 0.9),
        (r'xbrli:xbrl', 0.9),
        (r'http://www\.xbrl\.org/', 0.8),
    ]

    def detect_document_type(self, s3_key: str, content_preview: bytes, filename: str = None) -> Dict[str, Any]:
        """
        Detect document type using deterministic markers
        
        Args:
            s3_key: S3 key/path of the file
            content_preview: First 2KB of file content (bytes)
            filename: Optional filename (extracted from s3_key if not provided)
            
        Returns:
            Dict with:
                - type: DocumentType enum value
                - confidence: 0.0-1.0 confidence score
                - markers_found: List of markers that matched
                - metadata: Additional detected metadata (form_type, cik, etc.)
        """
        if filename is None:
            filename = s3_key.split('/')[-1] if '/' in s3_key else s3_key

        # Convert content preview to string for pattern matching
        try:
            content_str = content_preview.decode('utf-8', errors='ignore')[:2048]  # First 2KB
        except Exception as e:
            logger.warning(f"Error decoding content preview: {e}")
            content_str = ""

        # Check filename pattern first (highest confidence)
        filename_match = self.SEC_FILENAME_PATTERN.match(filename)
        if filename_match:
            cik = filename_match.group(1)
            form_type_code = filename_match.group(2)
            accession = filename_match.group(2) + '-' + filename_match.group(3)
            
            # Form type codes: 10-K = 10, 10-Q = 10 (Q), 8-K = 8
            # We'll use content markers to determine exact form type
            logger.info(f"SEC filing pattern detected: CIK={cik}, Accession={accession}")
            
            # Still check content to determine exact form type
            form_type = self._detect_sec_form_type(content_str)
            
            return {
                "type": form_type,
                "confidence": 0.95,
                "markers_found": ["SEC filename pattern"],
                "metadata": {
                    "cik": cik,
                    "accession_number": accession,
                    "form_type": form_type.value if isinstance(form_type, DocumentType) else form_type,
                    "detection_method": "filename_pattern"
                }
            }

        # Check content markers
        # Priority: XBRL > SEC > Financial Statement
        
        # Check XBRL markers
        xbrl_markers = self._check_markers(content_str, self.XBRL_MARKERS)
        if xbrl_markers:
            return {
                "type": DocumentType.XBRL,
                "confidence": max(score for _, score in xbrl_markers),
                "markers_found": [marker for marker, _ in xbrl_markers],
                "metadata": {
                    "detection_method": "content_markers"
                }
            }

        # Check SEC markers
        sec_xml_markers = self._check_markers(content_str, self.SEC_XML_MARKERS)
        sec_html_markers = self._check_markers(content_str, self.SEC_HTML_MARKERS)
        
        if sec_xml_markers or sec_html_markers:
            form_type = self._detect_sec_form_type(content_str)
            all_markers = sec_xml_markers + sec_html_markers
            max_confidence = max(score for _, score in all_markers) if all_markers else 0.7
            
            # Extract metadata from content if possible
            metadata = self._extract_sec_metadata(content_str)
            metadata["detection_method"] = "content_markers"
            
            return {
                "type": form_type,
                "confidence": max_confidence,
                "markers_found": [marker for marker, _ in all_markers],
                "metadata": metadata
            }

        # Check financial statement markers
        financial_markers = self._check_markers(content_str, self.FINANCIAL_MARKERS)
        if financial_markers:
            # Check if PDF
            if filename.lower().endswith('.pdf') or 'pdf' in s3_key.lower():
                return {
                    "type": DocumentType.PDF_FINANCIAL,
                    "confidence": max(score for _, score in financial_markers),
                    "markers_found": [marker for marker, _ in financial_markers],
                    "metadata": {
                        "detection_method": "content_markers"
                    }
                }
            else:
                return {
                    "type": DocumentType.FINANCIAL_STATEMENT,
                    "confidence": max(score for _, score in financial_markers),
                    "markers_found": [marker for marker, _ in financial_markers],
                    "metadata": {
                        "detection_method": "content_markers"
                    }
                }

        # Unknown document type
        return {
            "type": DocumentType.UNKNOWN,
            "confidence": 0.0,
            "markers_found": [],
            "metadata": {
                "detection_method": "none"
            }
        }

    def _check_markers(self, content: str, markers: List[tuple]) -> List[tuple]:
        """
        Check content against list of marker patterns
        
        Args:
            content: Content string to search
            markers: List of (pattern, confidence) tuples
            
        Returns:
            List of (marker, confidence) tuples that matched
        """
        found = []
        content_upper = content.upper()
        
        for pattern, confidence in markers:
            try:
                if re.search(pattern, content_upper, re.IGNORECASE | re.MULTILINE):
                    found.append((pattern, confidence))
            except re.error as e:
                logger.warning(f"Invalid regex pattern {pattern}: {e}")
        
        return found

    def _detect_sec_form_type(self, content: str) -> DocumentType:
        """
        Detect specific SEC form type from content
        
        Args:
            content: Content string to analyze
            
        Returns:
            DocumentType enum
        """
        content_upper = content.upper()
        
        # Check for specific form types (most specific first)
        if re.search(r'<TYPE>10-K</TYPE>|FORM\s+10-K|ANNUAL\s+REPORT', content_upper):
            return DocumentType.SEC_10K
        elif re.search(r'<TYPE>10-Q</TYPE>|FORM\s+10-Q|QUARTERLY\s+REPORT', content_upper):
            return DocumentType.SEC_10Q
        elif re.search(r'<TYPE>8-K</TYPE>|FORM\s+8-K|CURRENT\s+REPORT', content_upper):
            return DocumentType.SEC_8K
        elif re.search(r'<TYPE>FORM\s+4</TYPE>|FORM\s+4|STATEMENT OF CHANGES', content_upper):
            return DocumentType.SEC_FORM4
        else:
            # Default to 10-K if SEC document but form type unclear
            return DocumentType.SEC_10K

    def _extract_sec_metadata(self, content: str) -> Dict[str, Any]:
        """
        Extract metadata from SEC filing content
        
        Args:
            content: Content string to analyze
            
        Returns:
            Dict with extracted metadata
        """
        metadata = {}
        content_str = content[:5000]  # First 5KB should have header info
        
        # Extract CIK
        cik_match = re.search(r'<CENTRAL-INDEX-KEY>(\d+)</CENTRAL-INDEX-KEY>|CENTRAL INDEX KEY[:\s]+(\d+)', content_str, re.IGNORECASE)
        if cik_match:
            metadata["cik"] = cik_match.group(1) or cik_match.group(2)
        
        # Extract accession number
        acc_match = re.search(r'<ACCESSION-NUMBER>([^<]+)</ACCESSION-NUMBER>|ACCESSION NUMBER[:\s]+([\d-]+)', content_str, re.IGNORECASE)
        if acc_match:
            metadata["accession_number"] = (acc_match.group(1) or acc_match.group(2)).strip()
        
        # Extract filing date
        date_match = re.search(r'<FILING-DATE>(\d{4}-\d{2}-\d{2})</FILING-DATE>|FILING DATE[:\s]+(\d{1,2}[/-]\d{1,2}[/-]\d{4})', content_str, re.IGNORECASE)
        if date_match:
            metadata["filing_date"] = date_match.group(1) or date_match.group(2)
        
        # Extract company name (basic attempt)
        name_match = re.search(r'<COMPANY-CONFORMED-NAME>([^<]+)</COMPANY-CONFORMED-NAME>|COMPANY CONFORMED NAME[:\s]+([^\n]+)', content_str, re.IGNORECASE)
        if name_match:
            metadata["company_name"] = (name_match.group(1) or name_match.group(2)).strip()
        
        return metadata

