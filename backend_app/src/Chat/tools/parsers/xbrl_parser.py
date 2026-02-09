"""
XBRL Parser for extracting structured financial data from XBRL documents
XBRL (eXtensible Business Reporting Language) provides the most accurate structured financial data
"""

import re
import logging
from typing import Dict, Any, Optional, List
import defusedxml.ElementTree as ET
from xml.etree.ElementTree import ParseError  # nosemgrep: python.lang.security.use-defused-xml.use-defused-xml -- only import exception type; parsing uses defusedxml above
from base_parser import BaseParser

logger = logging.getLogger()


class XBRLParser(BaseParser):
    """
    Parser for XBRL documents
    Extracts structured financial data from XBRL taxonomy
    """
    
    def parse(self, s3_key: str, content: bytes, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Parse XBRL document and extract structured financial data
        
        Args:
            s3_key: S3 key of the document
            content: XBRL content (bytes)
            metadata: Optional metadata
            
        Returns:
            Dict with extracted financial data
        """
        try:
            xml_content = self.decode_content(content)
            
            # Parse XML (defusedxml prevents XXE)
            try:
                root = ET.fromstring(xml_content)
            except ParseError:
                # Try with HTML entity handling
                xml_content = self._clean_xml(xml_content)
                root = ET.fromstring(xml_content)
            
            # Extract facts (financial data points)
            facts = self._extract_facts(root)
            
            # Map facts to financial statements
            income_statement = self._map_to_income_statement(facts)
            balance_sheet = self._map_to_balance_sheet(facts)
            cash_flow = self._map_to_cash_flow(facts)
            
            # Extract metadata
            extracted_metadata = self._extract_xbrl_metadata(root, metadata)
            
            # Calculate metrics
            metrics = self._calculate_metrics(income_statement, balance_sheet, cash_flow)
            
            return {
                "success": True,
                "document_type": "xbrl",
                "metadata": extracted_metadata,
                "income_statement": income_statement,
                "balance_sheet": balance_sheet,
                "cash_flow": cash_flow,
                "metrics": metrics,
                "facts_count": len(facts)
            }
            
        except Exception as e:
            logger.error(f"Error parsing XBRL {s3_key}: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return {
                "success": False,
                "error": str(e),
                "document_type": "xbrl"
            }
    
    def _clean_xml(self, xml_content: str) -> str:
        """Clean XML content for parsing"""
        # Remove BOM if present
        if xml_content.startswith('\ufeff'):
            xml_content = xml_content[1:]
        # Handle common encoding issues
        xml_content = xml_content.replace('&nbsp;', ' ')
        return xml_content
    
    def _extract_facts(self, root: ET.Element) -> List[Dict[str, Any]]:
        """
        Extract XBRL facts (financial data points with context)
        
        Args:
            root: XML root element
            
        Returns:
            List of fact dictionaries with context
        """
        facts = []
        
        # Common XBRL namespaces
        namespaces = {
            'xbrli': 'http://www.xbrl.org/2003/instance',
            'us-gaap': 'http://fasb.org/us-gaap/',
            'xbrldi': 'http://xbrl.org/2006/xbrldi',
        }
        
        # Find all facts (numeric and non-numeric)
        # Facts are typically elements with contextRef attribute
        for elem in root.iter():
            # Check if element has a context reference (it's a fact)
            context_ref = elem.get('contextRef')
            unit_ref = elem.get('unitRef')
            
            if context_ref and elem.text:
                fact = {
                    "name": elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag,
                    "value": elem.text.strip(),
                    "context_ref": context_ref,
                    "unit_ref": unit_ref,
                    "namespace": self._extract_namespace(elem.tag)
                }
                
                # Try to parse numeric value
                try:
                    # Remove commas and parse
                    numeric_value = float(elem.text.replace(',', ''))
                    fact["numeric_value"] = numeric_value
                except (ValueError, AttributeError):
                    pass
                
                facts.append(fact)
        
        return facts
    
    def _extract_namespace(self, tag: str) -> str:
        """Extract namespace from XML tag"""
        if '}' in tag:
            return tag.split('}')[0][1:]  # Remove '{'
        return ''
    
    def _extract_xbrl_metadata(self, root: ET.Element, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Extract metadata from XBRL document"""
        result = {}
        if metadata:
            result.update(metadata)
        
        # Extract entity identifier
        entity_elem = root.find('.//{http://www.xbrl.org/2003/instance}entity')
        if entity_elem is not None:
            identifier_elem = entity_elem.find('.//{http://www.xbrl.org/2003/instance}identifier')
            if identifier_elem is not None and identifier_elem.text:
                result["entity_identifier"] = identifier_elem.text.strip()
        
        # Extract period
        period_elem = root.find('.//{http://www.xbrl.org/2003/instance}period')
        if period_elem is not None:
            end_date_elem = period_elem.find('.//{http://www.xbrl.org/2003/instance}endDate')
            if end_date_elem is not None and end_date_elem.text:
                result["period_end"] = end_date_elem.text.strip()
            
            start_date_elem = period_elem.find('.//{http://www.xbrl.org/2003/instance}startDate')
            if start_date_elem is not None and start_date_elem.text:
                result["period_start"] = start_date_elem.text.strip()
        
        return result
    
    def _map_to_income_statement(self, facts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Map XBRL facts to income statement structure"""
        income_statement = {}
        
        # Common XBRL concepts for income statement
        concept_mapping = {
            "revenue": [
                "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
                "SalesRevenueNet", "RevenuesNetOfInterestExpense"
            ],
            "cost_of_goods_sold": [
                "CostOfGoodsAndServicesSold", "CostOfSales", "CostOfRevenue"
            ],
            "gross_profit": [
                "GrossProfit"
            ],
            "operating_expenses": [
                "OperatingExpenses", "CostsAndExpenses"
            ],
            "operating_income": [
                "OperatingIncomeLoss", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"
            ],
            "ebitda": [
                "EarningsBeforeInterestTaxesDepreciationAndAmortization"
            ],
            "interest_expense": [
                "InterestExpense", "InterestExpenseDebt"
            ],
            "net_income": [
                "NetIncomeLoss", "ProfitLoss"
            ],
            "eps": [
                "EarningsPerShareBasic", "EarningsPerShareDiluted"
            ],
        }
        
        for key, concepts in concept_mapping.items():
            for fact in facts:
                fact_name = fact["name"]
                if fact_name in concepts and "numeric_value" in fact:
                    # Apply unit multiplier (thousands, millions, etc.)
                    value = fact["numeric_value"]
                    unit_ref = fact.get("unit_ref", "")
                    value = self._apply_unit_multiplier(value, unit_ref)
                    
                    income_statement[key] = {
                        "value": value,
                        "unit": "USD",
                        "concept": fact_name
                    }
                    break
        
        return income_statement
    
    def _map_to_balance_sheet(self, facts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Map XBRL facts to balance sheet structure"""
        balance_sheet = {}
        
        concept_mapping = {
            "total_assets": [
                "Assets", "AssetsTotal"
            ],
            "current_assets": [
                "AssetsCurrent", "CurrentAssets"
            ],
            "cash": [
                "CashAndCashEquivalentsAtCarryingValue", "Cash"
            ],
            "receivables": [
                "AccountsReceivableNetCurrent", "ReceivablesNetCurrent"
            ],
            "inventory": [
                "InventoryNet", "Inventory"
            ],
            "total_liabilities": [
                "Liabilities", "LiabilitiesTotal"
            ],
            "current_liabilities": [
                "LiabilitiesCurrent", "CurrentLiabilities"
            ],
            "total_debt": [
                "LongTermDebtAndCapitalLeaseObligations", "DebtCurrentAndNoncurrent"
            ],
            "equity": [
                "StockholdersEquity", "Equity"
            ],
        }
        
        for key, concepts in concept_mapping.items():
            for fact in facts:
                fact_name = fact["name"]
                if fact_name in concepts and "numeric_value" in fact:
                    value = fact["numeric_value"]
                    unit_ref = fact.get("unit_ref", "")
                    value = self._apply_unit_multiplier(value, unit_ref)
                    
                    balance_sheet[key] = {
                        "value": value,
                        "unit": "USD",
                        "concept": fact_name
                    }
                    break
        
        return balance_sheet
    
    def _map_to_cash_flow(self, facts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Map XBRL facts to cash flow statement structure"""
        cash_flow = {}
        
        concept_mapping = {
            "operating_cash_flow": [
                "NetCashProvidedByUsedInOperatingActivities", "CashFlowFromOperatingActivities"
            ],
            "investing_cash_flow": [
                "NetCashProvidedByUsedInInvestingActivities", "CashFlowFromInvestingActivities"
            ],
            "financing_cash_flow": [
                "NetCashProvidedByUsedInFinancingActivities", "CashFlowFromFinancingActivities"
            ],
            "net_cash_flow": [
                "NetIncreaseDecreaseInCashAndCashEquivalents", "NetChangeInCashAndCashEquivalents"
            ],
        }
        
        for key, concepts in concept_mapping.items():
            for fact in facts:
                fact_name = fact["name"]
                if fact_name in concepts and "numeric_value" in fact:
                    value = fact["numeric_value"]
                    unit_ref = fact.get("unit_ref", "")
                    value = self._apply_unit_multiplier(value, unit_ref)
                    
                    cash_flow[key] = {
                        "value": value,
                        "unit": "USD",
                        "concept": fact_name
                    }
                    break
        
        # Calculate free cash flow
        if "operating_cash_flow" in cash_flow and "investing_cash_flow" in cash_flow:
            ocf = cash_flow["operating_cash_flow"]["value"]
            icf = cash_flow["investing_cash_flow"]["value"]
            free_cf = ocf + icf if icf < 0 else ocf - abs(icf)
            cash_flow["free_cash_flow"] = {
                "value": free_cf,
                "unit": "USD",
                "calculated": True
            }
        
        return cash_flow
    
    def _apply_unit_multiplier(self, value: float, unit_ref: str) -> float:
        """Apply unit multiplier from XBRL unit reference"""
        # XBRL units are typically in units (not thousands/millions)
        # But we check unit_ref for multipliers
        if 'THOUSANDS' in unit_ref.upper() or 'K' in unit_ref.upper():
            return value * 1_000
        elif 'MILLIONS' in unit_ref.upper() or 'M' in unit_ref.upper():
            return value * 1_000_000
        elif 'BILLIONS' in unit_ref.upper() or 'B' in unit_ref.upper():
            return value * 1_000_000_000
        return value
    
    def _calculate_metrics(self, income_statement: Dict[str, Any], 
                          balance_sheet: Dict[str, Any], 
                          cash_flow: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate financial metrics (same as SECFilingParser)"""
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
        
        if revenue and revenue != 0:
            if net_income:
                metrics["net_margin"] = net_income / revenue
            if gross_profit:
                metrics["gross_margin"] = gross_profit / revenue
            if operating_income:
                metrics["operating_margin"] = operating_income / revenue
        
        if total_debt and equity and equity != 0:
            metrics["debt_to_equity"] = total_debt / equity
        
        if current_assets and current_liabilities and current_liabilities != 0:
            metrics["current_ratio"] = current_assets / current_liabilities
        
        if net_income and equity and equity != 0:
            metrics["roe"] = net_income / equity
        
        if net_income and total_assets and total_assets != 0:
            metrics["roa"] = net_income / total_assets
        
        return metrics

