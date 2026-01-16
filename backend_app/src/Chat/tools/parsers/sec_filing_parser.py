"""
SEC Filing Parser for extracting comprehensive financial data from SEC filings
Supports 10-K (annual), 10-Q (quarterly), 8-K (current), and Form 4 (insider trading)
"""

import re
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime
from bs4 import BeautifulSoup
from base_parser import BaseParser

logger = logging.getLogger()


class SECFilingParser(BaseParser):
    """
    Parser for SEC 10-K and 10-Q filings
    Extracts comprehensive financial statements and metrics
    """
    
    def parse(self, s3_key: str, content: bytes, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Parse SEC filing and extract comprehensive financial data
        
        Args:
            s3_key: S3 key of the filing
            content: Filing content (bytes)
            metadata: Optional metadata (CIK, accession number, etc.)
            
        Returns:
            Dict with extracted financial data
        """
        try:
            text_content = self.decode_content(content)
            
            # Determine if XML or HTML
            is_xml = '<SEC-DOCUMENT>' in text_content[:1000] or text_content.strip().startswith('<?xml')
            
            if is_xml:
                cleaned_content = self.extract_xml_content(text_content)
            else:
                cleaned_content = self.extract_html_content(text_content)
            
            # Extract metadata
            extracted_metadata = self._extract_metadata(text_content, metadata)
            
            # Extract financial statements
            income_statement = self._extract_income_statement(text_content, cleaned_content)
            balance_sheet = self._extract_balance_sheet(text_content, cleaned_content)
            cash_flow = self._extract_cash_flow(text_content, cleaned_content)
            
            # Calculate metrics
            metrics = self._calculate_metrics(income_statement, balance_sheet, cash_flow)
            
            return {
                "success": True,
                "document_type": "sec_filing",
                "metadata": extracted_metadata,
                "income_statement": income_statement,
                "balance_sheet": balance_sheet,
                "cash_flow": cash_flow,
                "metrics": metrics,
                "raw_content_length": len(text_content)
            }
            
        except Exception as e:
            logger.error(f"Error parsing SEC filing {s3_key}: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                "success": False,
                "error": str(e),
                "document_type": "sec_filing"
            }
    
    def _extract_metadata(self, content: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Extract metadata from SEC filing"""
        result = {}
        
        if metadata:
            result.update(metadata)
        
        # Extract company name
        name_patterns = [
            r'<COMPANY-CONFORMED-NAME>([^<]+)</COMPANY-CONFORMED-NAME>',
            r'COMPANY CONFORMED NAME[:\s]+([^\n]+)',
            r'<ENTITY-NAME>([^<]+)</ENTITY-NAME>',
            r'Name of registrant[:\s]+([^\n]+)',
        ]
        for pattern in name_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                result["company_name"] = match.group(1).strip()
                break
        
        # Extract CIK
        if "cik" not in result:
            cik_patterns = [
                r'<CENTRAL-INDEX-KEY>(\d+)</CENTRAL-INDEX-KEY>',
                r'CENTRAL INDEX KEY[:\s]+(\d+)',
                r'CIK[:\s]+(\d{10})',
            ]
            for pattern in cik_patterns:
                match = re.search(pattern, content, re.IGNORECASE)
                if match:
                    result["cik"] = match.group(1).zfill(10)
                    break
        
        # Extract form type
        form_patterns = [
            r'<TYPE>(\d+-?[A-Z]?)</TYPE>',
            r'FORM\s+(\d+-?[A-Z]?)',
        ]
        for pattern in form_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                result["form_type"] = match.group(1).strip()
                break
        
        # Extract filing date
        date_patterns = [
            r'<FILING-DATE>(\d{4}-\d{2}-\d{2})</FILING-DATE>',
            r'FILING DATE[:\s]+(\d{4}-\d{2}-\d{2})',
            r'FILED AS OF DATE[:\s]+(\d{4}-\d{2}-\d{2})',
        ]
        for pattern in date_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                result["filing_date"] = match.group(1)
                break
        
        # Extract period end date
        period_patterns = [
            r'PERIOD END DATE[:\s]+(\d{4}-\d{2}-\d{2})',
            r'<PERIOD>(\d{4}-\d{2}-\d{2})</PERIOD>',
            r'FISCAL YEAR END[:\s]+(\d{4}-\d{2}-\d{2})',
        ]
        for pattern in period_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                result["period_end"] = match.group(1)
                break
        
        return result
    
    def _extract_income_statement(self, raw_content: str, cleaned_content: str) -> Dict[str, Any]:
        """Extract income statement data"""
        income_statement = {}
        
        # Common income statement line items with variations
        line_items = {
            "revenue": [
                r'REVENUES?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'TOTAL REVENUES?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'NET SALES[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "cost_of_goods_sold": [
                r'COST OF (?:GOODS )?SALES?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'COGS[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "gross_profit": [
                r'GROSS PROFIT[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "operating_expenses": [
                r'TOTAL OPERATING EXPENSES?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'OPERATING EXPENSES?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "ebitda": [
                r'EBITDA[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'EARNINGS BEFORE (?:INTEREST|ITDA)[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "operating_income": [
                r'OPERATING INCOME[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'INCOME FROM OPERATIONS[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "interest_expense": [
                r'INTEREST EXPENSE[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "net_income": [
                r'NET INCOME[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'NET EARNINGS?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "eps": [
                r'EARNINGS PER SHARE[:\s]*\$?([\d,\(\)\.]+)',
                r'EPS[:\s]*\$?([\d,\(\)\.]+)',
                r'BASIC EARNINGS PER SHARE[:\s]*\$?([\d,\(\)\.]+)',
            ],
        }
        
        # Search for each line item
        content_upper = raw_content.upper()
        for item_name, patterns in line_items.items():
            for pattern in patterns:
                matches = re.finditer(pattern, content_upper, re.IGNORECASE | re.MULTILINE)
                for match in matches:
                    value_str = match.group(1)
                    value = self.normalize_number(value_str)
                    if value is not None:
                        # Use first valid match
                        income_statement[item_name] = {
                            "value": value,
                            "unit": "USD",
                            "raw_string": value_str
                        }
                        break
                if item_name in income_statement:
                    break
        
        return income_statement
    
    def _extract_balance_sheet(self, raw_content: str, cleaned_content: str) -> Dict[str, Any]:
        """Extract balance sheet data"""
        balance_sheet = {}
        
        # Common balance sheet line items
        line_items = {
            "total_assets": [
                r'TOTAL ASSETS[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "current_assets": [
                r'TOTAL CURRENT ASSETS[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'CURRENT ASSETS[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "cash": [
                r'CASH AND (?:CASH )?EQUIVALENTS?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'CASH[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "receivables": [
                r'ACCOUNTS? RECEIVABLE[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'TRADE RECEIVABLES?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "inventory": [
                r'INVENTOR(?:IES|Y)[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "total_liabilities": [
                r'TOTAL LIABILITIES?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "current_liabilities": [
                r'TOTAL CURRENT LIABILITIES?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'CURRENT LIABILITIES?[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "total_debt": [
                r'TOTAL DEBT[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'LONG[-\s]TERM DEBT[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "equity": [
                r'TOTAL (?:SHAREHOLDERS?|STOCKHOLDERS?) EQUITY[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'TOTAL EQUITY[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'STOCKHOLDERS? EQUITY[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
        }
        
        content_upper = raw_content.upper()
        for item_name, patterns in line_items.items():
            for pattern in patterns:
                matches = re.finditer(pattern, content_upper, re.IGNORECASE | re.MULTILINE)
                for match in matches:
                    value_str = match.group(1)
                    value = self.normalize_number(value_str)
                    if value is not None:
                        balance_sheet[item_name] = {
                            "value": value,
                            "unit": "USD",
                            "raw_string": value_str
                        }
                        break
                if item_name in balance_sheet:
                    break
        
        return balance_sheet
    
    def _extract_cash_flow(self, raw_content: str, cleaned_content: str) -> Dict[str, Any]:
        """Extract cash flow statement data"""
        cash_flow = {}
        
        line_items = {
            "operating_cash_flow": [
                r'NET CASH PROVIDED BY OPERATING ACTIVITIES[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'OPERATING CASH FLOW[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'CASH FROM OPERATIONS[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "investing_cash_flow": [
                r'NET CASH (?:USED IN|FROM) INVESTING ACTIVITIES[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'INVESTING CASH FLOW[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "financing_cash_flow": [
                r'NET CASH (?:USED IN|FROM) FINANCING ACTIVITIES[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'FINANCING CASH FLOW[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
            "net_cash_flow": [
                r'NET (?:INCREASE|DECREASE) IN CASH[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
                r'NET CHANGE IN CASH[:\s]*\$?([\d,\(\)\.]+(?:[KMBT]|THOUSAND|MILLION|BILLION)?)',
            ],
        }
        
        content_upper = raw_content.upper()
        for item_name, patterns in line_items.items():
            for pattern in patterns:
                matches = re.finditer(pattern, content_upper, re.IGNORECASE | re.MULTILINE)
                for match in matches:
                    value_str = match.group(1)
                    value = self.normalize_number(value_str)
                    if value is not None:
                        cash_flow[item_name] = {
                            "value": value,
                            "unit": "USD",
                            "raw_string": value_str
                        }
                        break
                if item_name in cash_flow:
                    break
        
        # Calculate free cash flow if possible
        if "operating_cash_flow" in cash_flow and "investing_cash_flow" in cash_flow:
            ocf = cash_flow["operating_cash_flow"]["value"]
            icf = cash_flow["investing_cash_flow"]["value"]
            # Free cash flow = Operating CF + Investing CF (Investing is usually negative)
            free_cf = ocf + icf if icf < 0 else ocf - abs(icf)
            cash_flow["free_cash_flow"] = {
                "value": free_cf,
                "unit": "USD",
                "calculated": True
            }
        
        return cash_flow
    
    def _calculate_metrics(self, income_statement: Dict[str, Any], 
                          balance_sheet: Dict[str, Any], 
                          cash_flow: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate financial metrics from extracted data"""
        metrics = {}
        
        revenue = income_statement.get("revenue", {}).get("value")
        net_income = income_statement.get("net_income", {}).get("value")
        gross_profit = income_statement.get("gross_profit", {}).get("value")
        operating_income = income_statement.get("operating_income", {}).get("value")
        
        total_assets = balance_sheet.get("total_assets", {}).get("value")
        total_debt = balance_sheet.get("total_debt", {}).get("value")
        equity = balance_sheet.get("equity", {}).get("value")
        current_assets = balance_sheet.get("current_assets", {}).get("value")
        current_liabilities = balance_sheet.get("current_liabilities", {}).get("value")
        
        # Calculate margins
        if revenue and revenue != 0:
            if net_income:
                metrics["net_margin"] = net_income / revenue
            if gross_profit:
                metrics["gross_margin"] = gross_profit / revenue
            if operating_income:
                metrics["operating_margin"] = operating_income / revenue
        
        # Calculate debt-to-equity ratio
        if total_debt and equity and equity != 0:
            metrics["debt_to_equity"] = total_debt / equity
        
        # Calculate current ratio
        if current_assets and current_liabilities and current_liabilities != 0:
            metrics["current_ratio"] = current_assets / current_liabilities
        
        # Calculate ROE (Return on Equity)
        if net_income and equity and equity != 0:
            metrics["roe"] = net_income / equity
        
        # Calculate ROA (Return on Assets)
        if net_income and total_assets and total_assets != 0:
            metrics["roa"] = net_income / total_assets
        
        return metrics


class SECCurrentReportParser(BaseParser):
    """Parser for SEC 8-K (current reports) - focuses on events"""
    
    def parse(self, s3_key: str, content: bytes, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Parse SEC 8-K filing - event-focused extraction"""
        try:
            text_content = self.decode_content(content)
            cleaned_content = self.extract_html_content(text_content)
            
            metadata = self._extract_metadata(text_content, metadata)
            events = self._extract_events(text_content, cleaned_content)
            
            return {
                "success": True,
                "document_type": "sec_8k",
                "metadata": metadata,
                "events": events,
                "raw_content_length": len(text_content)
            }
        except Exception as e:
            logger.error(f"Error parsing SEC 8-K {s3_key}: {e}")
            return {
                "success": False,
                "error": str(e),
                "document_type": "sec_8k"
            }
    
    def _extract_metadata(self, content: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Extract metadata (same as SECFilingParser)"""
        parser = SECFilingParser()
        return parser._extract_metadata(content, metadata)
    
    def _extract_events(self, raw_content: str, cleaned_content: str) -> List[Dict[str, Any]]:
        """Extract events from 8-K filing"""
        events = []
        
        # Common 8-K event types
        event_patterns = [
            (r'ITEM\s+1\.01\s+ENTRY INTO A MATERIAL DEFINITIVE AGREEMENT', 'Material Agreement'),
            (r'ITEM\s+2\.01\s+COMPLETION OF ACQUISITION', 'Acquisition'),
            (r'ITEM\s+2\.02\s+RESULTS OF OPERATIONS AND FINANCIAL CONDITION', 'Financial Results'),
            (r'ITEM\s+8\.01\s+OTHER EVENTS', 'Other Events'),
        ]
        
        content_upper = raw_content.upper()
        for pattern, event_type in event_patterns:
            if re.search(pattern, content_upper, re.IGNORECASE):
                events.append({
                    "type": event_type,
                    "description": f"8-K {event_type} event reported"
                })
        
        return events


class SECForm4Parser(BaseParser):
    """Parser for SEC Form 4 (insider trading reports)"""
    
    def parse(self, s3_key: str, content: bytes, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Parse SEC Form 4 filing"""
        try:
            text_content = self.decode_content(content)
            metadata = self._extract_metadata(text_content, metadata)
            transactions = self._extract_transactions(text_content)
            
            return {
                "success": True,
                "document_type": "sec_form4",
                "metadata": metadata,
                "transactions": transactions,
                "raw_content_length": len(text_content)
            }
        except Exception as e:
            logger.error(f"Error parsing SEC Form 4 {s3_key}: {e}")
            return {
                "success": False,
                "error": str(e),
                "document_type": "sec_form4"
            }
    
    def _extract_metadata(self, content: str, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Extract metadata"""
        parser = SECFilingParser()
        return parser._extract_metadata(content, metadata)
    
    def _extract_transactions(self, content: str) -> List[Dict[str, Any]]:
        """Extract insider trading transactions"""
        transactions = []
        
        # Basic transaction extraction (can be enhanced)
        transaction_pattern = r'TRANSACTION\s+DATE[:\s]+(\d{4}-\d{2}-\d{2})'
        matches = re.finditer(transaction_pattern, content, re.IGNORECASE)
        
        for match in matches:
            transactions.append({
                "transaction_date": match.group(1),
                "raw_data": "See full document for details"
            })
        
        return transactions

