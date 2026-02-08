"""
Deterministic test script for parsing Tesla 10-Q filing
Extracts financial data from inline XBRL (iXBRL) tags using BeautifulSoup + lxml
Mirrors the production parser approach: router → parser → facts
"""

from bs4 import BeautifulSoup
import re
from collections import defaultdict
from pathlib import Path
import json


def format_number(value, decimals=0):
    """
    Format number for display
    Values in iXBRL are typically already in thousands or millions
    We'll format assuming values > 1000 are in millions (common for large companies)
    """
    if value is None:
        return "N/A"
    if isinstance(value, (int, float)):
        # For large values (> 1000), assume already in millions
        # Format as millions with comma separators
        if abs(value) >= 1_000:
            # Already in millions, just format with commas
            return f"${value:,.0f}M" if decimals == 0 else f"${value:,.{decimals}f}M"
        elif abs(value) >= 1:
            # Thousands or raw millions
            return f"${value:,.0f}" if decimals == 0 else f"${value:,.{decimals}f}"
        else:
            return f"${value:.{decimals}f}"
    return str(value)


def main():
    """Main parsing function - deterministic extraction from iXBRL"""
    FILE_PATH = Path(__file__).parent / "0001628280-25-045968_9e6a49ae.txt"
    
    print(f"📄 Parsing Tesla 10-Q filing: {FILE_PATH.name}")
    print(f"📊 File size: {FILE_PATH.stat().st_size / (1024*1024):.2f} MB\n")
    
    # --- Step 1: Load document ---
    print("="*60)
    print("STEP 1: Loading Document")
    print("="*60)
    
    with open(FILE_PATH, "r", encoding="utf-8", errors="ignore") as f:
        soup = BeautifulSoup(f, "lxml")
    
    print(f"✅ Document loaded")
    
    # --- Step 2: Sanity checks (router logic) ---
    print("\n" + "="*60)
    print("STEP 2: Document Type Detection")
    print("="*60)
    
    has_ixbrl = soup.find("ix:nonfraction") is not None
    has_accession = re.search(r"\d{10}-\d{2}-\d{6}", soup.text) is not None
    
    print(f"   Contains iXBRL tags: {has_ixbrl}")
    print(f"   Contains accession number: {has_accession}")
    
    assert has_ixbrl, "Not an iXBRL filing"
    assert has_accession, "No accession number found"
    
    # Extract metadata
    accession_match = re.search(r"(\d{10}-\d{2}-\d{6})", soup.text)
    accession = accession_match.group(1) if accession_match else "N/A"
    
    # Extract company name
    company_match = re.search(r'COMPANY CONFORMED NAME[:\s]+([^\n]+)', soup.text, re.IGNORECASE)
    company_name = company_match.group(1).strip() if company_match else "N/A"
    
    # Extract CIK
    cik_match = re.search(r'CENTRAL INDEX KEY[:\s]+(\d+)', soup.text, re.IGNORECASE)
    cik = cik_match.group(1) if cik_match else "N/A"
    
    # Extract form type and period
    form_match = re.search(r'FORM TYPE[:\s]+(\d+-?[A-Z]?)', soup.text, re.IGNORECASE)
    form_type = form_match.group(1) if form_match else "N/A"
    
    period_match = re.search(r'CONFORMED PERIOD OF REPORT[:\s]+(\d{8})', soup.text, re.IGNORECASE)
    period_end = period_match.group(1) if period_match else "N/A"
    if period_end != "N/A":
        # Format: YYYYMMDD -> YYYY-MM-DD
        period_end = f"{period_end[:4]}-{period_end[4:6]}-{period_end[6:8]}"
    
    print(f"\n   Metadata:")
    print(f"     Company: {company_name}")
    print(f"     CIK: {cik}")
    print(f"     Form: {form_type}")
    print(f"     Period End: {period_end}")
    print(f"     Accession: {accession}")
    
    # --- Step 3: Extract all numeric XBRL facts ---
    print("\n" + "="*60)
    print("STEP 3: Extracting iXBRL Facts")
    print("="*60)
    
    facts = []
    for tag in soup.find_all("ix:nonfraction"):
        name = tag.get("name")
        context = tag.get("contextref") or tag.get("contextRef", "")
        unit = tag.get("unitref") or tag.get("unitRef", "")
        value = tag.text.strip().replace(",", "")
        
        try:
            value = float(value)
        except ValueError:
            continue
        
        facts.append({
            "tag": name,
            "context": context,
            "unit": unit,
            "value": value
        })
    
    print(f"   ✅ Extracted {len(facts):,} numeric facts from iXBRL tags")
    
    # --- Step 4: Index facts by tag ---
    print("\n" + "="*60)
    print("STEP 4: Indexing Facts by Tag")
    print("="*60)
    
    by_tag = defaultdict(list)
    for fact in facts:
        by_tag[fact["tag"]].append(fact)
    
    print(f"   ✅ Indexed {len(by_tag)} unique tags")
    
    # Show sample tags
    sample_tags = list(by_tag.keys())[:10]
    print(f"\n   Sample tags found:")
    for tag in sample_tags:
        count = len(by_tag[tag])
        print(f"     - {tag}: {count} facts")
    
    # --- Step 5: Pull key financials ---
    print("\n" + "="*60)
    print("STEP 5: Extracting Key Financials")
    print("="*60)
    
    def latest(tag_pattern):
        """Get the latest (first) fact matching tag pattern"""
        for tag in by_tag:
            if tag_pattern.lower() in tag.lower():
                # Return the first fact's value (usually latest period)
                return by_tag[tag][0]["value"]
        return None
    
    financials = {}
    
    # Income Statement
    financials["revenue"] = (
        latest("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax") or
        latest("us-gaap:Revenues") or
        latest("Revenue")
    )
    
    financials["cost_of_revenue"] = (
        latest("us-gaap:CostOfRevenue") or
        latest("CostOfRevenue")
    )
    
    financials["gross_profit"] = (
        latest("us-gaap:GrossProfit") or
        latest("GrossProfit")
    )
    
    financials["operating_income"] = (
        latest("us-gaap:OperatingIncomeLoss") or
        latest("OperatingIncome")
    )
    
    financials["net_income"] = (
        latest("us-gaap:NetIncomeLoss") or
        latest("us-gaap:ProfitLoss") or
        latest("NetIncome")
    )
    
    # Cash Flow
    financials["operating_cash_flow"] = (
        latest("us-gaap:NetCashProvidedByUsedInOperatingActivities") or
        latest("OperatingCashFlow")
    )
    
    financials["investing_cash_flow"] = (
        latest("us-gaap:NetCashProvidedByUsedInInvestingActivities") or
        latest("InvestingCashFlow")
    )
    
    financials["financing_cash_flow"] = (
        latest("us-gaap:NetCashProvidedByUsedInFinancingActivities") or
        latest("FinancingCashFlow")
    )
    
    # Balance Sheet
    financials["cash"] = (
        latest("us-gaap:CashAndCashEquivalentsAtCarryingValue") or
        latest("us-gaap:Cash") or
        latest("CashAndCashEquivalents")
    )
    
    financials["total_assets"] = (
        latest("us-gaap:Assets") or
        latest("us-gaap:AssetsTotal") or
        latest("TotalAssets")
    )
    
    financials["current_debt"] = (
        latest("us-gaap:DebtCurrent") or
        latest("CurrentDebt")
    )
    
    financials["long_term_debt"] = (
        latest("us-gaap:LongTermDebtNoncurrent") or
        latest("us-gaap:LongTermDebt") or
        latest("LongTermDebt")
    )
    
    # --- Step 6: Derived metrics ---
    print("\n" + "="*60)
    print("STEP 6: Calculating Derived Metrics")
    print("="*60)
    
    metrics = {}
    
    if financials.get("revenue") and financials.get("cost_of_revenue"):
        if not financials.get("gross_profit"):
            financials["gross_profit"] = financials["revenue"] - financials["cost_of_revenue"]
        
        if financials["revenue"] != 0:
            metrics["gross_margin"] = financials["gross_profit"] / financials["revenue"]
    
    if financials.get("revenue") and financials.get("net_income"):
        if financials["revenue"] != 0:
            metrics["net_margin"] = financials["net_income"] / financials["revenue"]
    
    if financials.get("revenue") and financials.get("operating_income"):
        if financials["revenue"] != 0:
            metrics["operating_margin"] = financials["operating_income"] / financials["revenue"]
    
    if financials.get("current_debt") and financials.get("long_term_debt"):
        financials["total_debt"] = financials["current_debt"] + financials["long_term_debt"]
    
    # --- Step 7: Output Results ---
    print("\n" + "="*60)
    print("STEP 7: Financial Results")
    print("="*60)
    
    print(f"\n📋 METADATA")
    print(f"   Company: {company_name}")
    print(f"   CIK: {cik}")
    print(f"   Form: {form_type}")
    print(f"   Period End: {period_end}")
    
    print(f"\n💰 INCOME STATEMENT")
    if financials.get("revenue"):
        print(f"   Total Revenue: {format_number(financials['revenue'])}")
    if financials.get("cost_of_revenue"):
        print(f"   Cost of Revenue: {format_number(financials['cost_of_revenue'])}")
    if financials.get("gross_profit"):
        print(f"   Gross Profit: {format_number(financials['gross_profit'])}")
    if metrics.get("gross_margin"):
        print(f"   Gross Margin: {metrics['gross_margin']:.1%}")
    if financials.get("operating_income"):
        print(f"   Operating Income: {format_number(financials['operating_income'])}")
    if financials.get("net_income"):
        print(f"   Net Income: {format_number(financials['net_income'])}")
    if metrics.get("net_margin"):
        print(f"   Net Margin: {metrics['net_margin']:.1%}")
    
    print(f"\n💵 CASH FLOW")
    if financials.get("operating_cash_flow"):
        print(f"   Operating Cash Flow: {format_number(financials['operating_cash_flow'])}")
    if financials.get("investing_cash_flow"):
        print(f"   Investing Cash Flow: {format_number(financials['investing_cash_flow'])}")
    if financials.get("financing_cash_flow"):
        print(f"   Financing Cash Flow: {format_number(financials['financing_cash_flow'])}")
    
    print(f"\n💼 BALANCE SHEET")
    if financials.get("cash"):
        print(f"   Cash & Cash Equivalents: {format_number(financials['cash'])}")
    if financials.get("total_assets"):
        print(f"   Total Assets: {format_number(financials['total_assets'])}")
    if financials.get("current_debt"):
        print(f"   Current Debt: {format_number(financials['current_debt'])}")
    if financials.get("long_term_debt"):
        print(f"   Long-Term Debt: {format_number(financials['long_term_debt'])}")
    if financials.get("total_debt"):
        print(f"   Total Debt: {format_number(financials['total_debt'])}")
    
    # --- Step 8: Save Results ---
    output_file = Path(__file__).parent / "parse_results.json"
    results = {
        "metadata": {
            "company_name": company_name,
            "cik": cik,
            "form_type": form_type,
            "period_end": period_end,
            "accession": accession
        },
        "financials": financials,
        "metrics": metrics,
        "facts_count": len(facts),
        "tags_count": len(by_tag)
    }
    
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    
    print(f"\n💾 Results saved to: {output_file.name}")
    print("\n✅ Parsing completed successfully!")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n❌ Error during parsing: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
