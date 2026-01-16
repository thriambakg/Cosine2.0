"""
Base Parser class with common extraction utilities
All specialized parsers inherit from this base class
"""

import re
import logging
from typing import Dict, Any, Optional, List, Tuple
from abc import ABC, abstractmethod
from bs4 import BeautifulSoup
import html

logger = logging.getLogger()


class BaseParser(ABC):
    """Base class for all document parsers"""
    
    def __init__(self):
        self.logger = logger
    
    @abstractmethod
    def parse(self, s3_key: str, content: bytes, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Parse document and extract structured data
        
        Args:
            s3_key: S3 key of the document
            content: Document content (bytes)
            metadata: Optional metadata (CIK, accession number, etc.)
            
        Returns:
            Dict with extracted data structure
        """
        pass
    
    def decode_content(self, content: bytes) -> str:
        """
        Decode content bytes to string with error handling
        
        Args:
            content: Content bytes
            
        Returns:
            Decoded string
        """
        try:
            return content.decode('utf-8', errors='ignore')
        except UnicodeDecodeError:
            try:
                return content.decode('latin-1', errors='ignore')
            except Exception as e:
                self.logger.warning(f"Error decoding content: {e}")
                return content.decode('utf-8', errors='replace')
    
    def extract_html_content(self, html_content: str) -> str:
        """
        Extract text content from HTML
        
        Args:
            html_content: HTML string
            
        Returns:
            Cleaned text content
        """
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            # Remove script and style elements
            for script in soup(["script", "style"]):
                script.decompose()
            text = soup.get_text()
            # Clean up whitespace
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
            text = ' '.join(chunk for chunk in chunks if chunk)
            return text
        except Exception as e:
            self.logger.warning(f"Error parsing HTML: {e}, falling back to regex")
            # Fallback: basic HTML tag removal
            text = re.sub(r'<[^>]+>', '', html_content)
            text = html.unescape(text)
            return text
    
    def extract_xml_content(self, xml_content: str) -> str:
        """
        Extract text content from XML
        
        Args:
            xml_content: XML string
            
        Returns:
            Cleaned text content
        """
        try:
            soup = BeautifulSoup(xml_content, 'xml')
            text = soup.get_text()
            # Clean up whitespace
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
            text = ' '.join(chunk for chunk in chunks if chunk)
            return text
        except Exception as e:
            self.logger.warning(f"Error parsing XML: {e}, falling back to regex")
            # Fallback: basic XML tag removal
            text = re.sub(r'<[^>]+>', '', xml_content)
            text = html.unescape(text)
            return text
    
    def normalize_number(self, value_str: str) -> Optional[float]:
        """
        Normalize number string to float
        Handles commas, parentheses (negative), and unit multipliers
        
        Args:
            value_str: Number string (e.g., "$1,234.56", "(123)", "1.5M")
            
        Returns:
            Float value or None if invalid
        """
        if not value_str or not isinstance(value_str, str):
            return None
        
        # Remove currency symbols
        value_str = re.sub(r'[$€£¥]', '', value_str.strip())
        
        # Handle parentheses (negative numbers)
        is_negative = '(' in value_str and ')' in value_str
        value_str = re.sub(r'[()]', '', value_str)
        
        # Remove commas
        value_str = value_str.replace(',', '')
        
        # Handle unit multipliers (thousands, millions, billions)
        multiplier = 1.0
        value_str_upper = value_str.upper()
        if 'K' in value_str_upper or 'THOUSAND' in value_str_upper:
            multiplier = 1_000
            value_str = re.sub(r'[Kk]|THOUSAND', '', value_str)
        elif 'M' in value_str_upper or 'MILLION' in value_str_upper:
            multiplier = 1_000_000
            value_str = re.sub(r'[Mm]|MILLION', '', value_str)
        elif 'B' in value_str_upper or 'BILLION' in value_str_upper:
            multiplier = 1_000_000_000
            value_str = re.sub(r'[Bb]|BILLION', '', value_str)
        elif 'T' in value_str_upper or 'TRILLION' in value_str_upper:
            multiplier = 1_000_000_000_000
            value_str = re.sub(r'[Tt]|TRILLION', '', value_str)
        
        try:
            value = float(value_str.strip())
            if is_negative:
                value = -value
            return value * multiplier
        except ValueError:
            return None
    
    def extract_financial_table(self, content: str, table_title: str) -> Optional[List[Dict[str, Any]]]:
        """
        Extract financial data from HTML/XML tables
        
        Args:
            content: HTML/XML content
            table_title: Title/heading of the table to extract
            
        Returns:
            List of dicts with line items and values
        """
        try:
            soup = BeautifulSoup(content, 'html.parser')
            
            # Find table by title (look for nearby headers)
            tables = soup.find_all('table')
            for table in tables:
                # Check if table has the title nearby
                prev_text = ''
                for prev in table.find_all_previous(['h1', 'h2', 'h3', 'h4', 'p', 'div'], limit=5):
                    prev_text += prev.get_text() + ' '
                
                if table_title.upper() in prev_text.upper():
                    # Extract table data
                    rows = []
                    for tr in table.find_all('tr'):
                        cells = [td.get_text(strip=True) for td in tr.find_all(['td', 'th'])]
                        if len(cells) >= 2:
                            rows.append({
                                'label': cells[0],
                                'values': cells[1:]
                            })
                    return rows
            
            return None
            
        except Exception as e:
            self.logger.warning(f"Error extracting table {table_title}: {e}")
            return None
    
    def find_section(self, content: str, section_keywords: List[str]) -> Optional[str]:
        """
        Find a section in the document by keywords
        
        Args:
            content: Document content
            section_keywords: List of keywords to search for
            
        Returns:
            Section content or None
        """
        content_upper = content.upper()
        keywords_upper = [kw.upper() for kw in section_keywords]
        
        # Find position of section start
        start_pos = -1
        for keyword in keywords_upper:
            pos = content_upper.find(keyword)
            if pos != -1:
                start_pos = pos
                break
        
        if start_pos == -1:
            return None
        
        # Extract section (next 5000 characters or until next major section)
        section_end = start_pos + 5000
        # Try to find end of section (next major heading)
        end_patterns = [
            r'\n[A-Z\s]{10,}\n',  # All caps line (likely heading)
            r'\n\d+\.\s+[A-Z]',   # Numbered section
        ]
        
        section = content[start_pos:section_end]
        return section
    
    def extract_dates(self, content: str) -> List[str]:
        """
        Extract dates from content
        
        Args:
            content: Content string
            
        Returns:
            List of date strings found
        """
        date_patterns = [
            r'\d{4}-\d{2}-\d{2}',  # YYYY-MM-DD
            r'\d{1,2}/\d{1,2}/\d{4}',  # MM/DD/YYYY
            r'\d{1,2}-\d{1,2}-\d{4}',  # MM-DD-YYYY
            r'[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}',  # Month DD, YYYY
        ]
        
        dates = []
        for pattern in date_patterns:
            matches = re.findall(pattern, content)
            dates.extend(matches)
        
        return list(set(dates))  # Remove duplicates


class BasicTextExtractor(BaseParser):
    """Basic text extractor for unknown document types"""
    
    def parse(self, s3_key: str, content: bytes, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Basic text extraction (fallback)
        
        Args:
            s3_key: S3 key of the document
            content: Document content (bytes)
            metadata: Optional metadata
            
        Returns:
            Dict with basic extracted data
        """
        try:
            text_content = self.decode_content(content)
            
            return {
                "success": True,
                "document_type": "unknown",
                "raw_content": text_content,
                "content_length": len(text_content),
                "extracted_data": {
                    "text_preview": text_content[:1000]  # First 1000 chars
                }
            }
        except Exception as e:
            self.logger.error(f"Error in basic text extraction: {e}")
            return {
                "success": False,
                "error": str(e),
                "document_type": "unknown"
            }

