"""
Government Contracts (USAspending) Autocomplete tool for the chat agent.
Invokes the USAspending Autocomplete Lambda to get exact values for search filters
before calling search_govt_contracts. The Lambda supports many autocomplete types;
use the type that matches the search filter you need.

Supported autocomplete_type values (from the Lambda):
- recipient          -> use in search_govt_contracts recipient_name (e.g. "university", "Lockheed")
- awarding_agency    -> use in awarding_agency_name (alias for awarding_agency_office)
- funding_agency     -> use in funding_agency_name (alias for funding_agency_office)
- city               -> recipient city
- location           -> location autocomplete
- cfda               -> use in cfda_number (program numbers)
- naics              -> use in naics_code (industry codes)
- psc                -> use in psc_code (product/service codes)
- program_activity   -> program activity
- glossary           -> USAspending term definitions
- accounts_*         -> TAS/account components (accounts_a, accounts_aid, accounts_ata, etc.)
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, Optional
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

logger = logging.getLogger(__name__)
try:
    from agent_logger import get_agent_logger
    agent_logger = get_agent_logger()
except Exception:
    agent_logger = logger

try:
    from strands import tool
except ImportError:
    def tool(f):
        return f

lambda_client = boto3.client('lambda')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'staging')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'cosine')
USASPENDING_AUTOCOMPLETE_LAMBDA_NAME = f"{PROJECT_NAME}-usaspending-autocomplete-{ENVIRONMENT}"


def invoke_govt_contracts_autocomplete(
    autocomplete_type: str,
    search_text: str,
    limit: int = 10
) -> Dict[str, Any]:
    """
    Invoke the USAspending Autocomplete Lambda (direct invocation).
    autocomplete_type can be: recipient, awarding_agency, funding_agency, city,
    location, cfda, naics, psc, program_activity, glossary, or any accounts_* type.
    """
    if not search_text or not str(search_text).strip():
        return {"success": False, "error": "search_text is required", "results": []}
    try:
        payload = {
            "autocomplete_type": autocomplete_type,
            "search_text": str(search_text).strip(),
            "limit": min(max(1, limit), 50),
        }
        response = lambda_client.invoke(
            FunctionName=USASPENDING_AUTOCOMPLETE_LAMBDA_NAME,
            InvocationType='RequestResponse',
            Payload=json.dumps(payload),
        )
        if 'FunctionError' in response:
            err = json.loads(response['Payload'].read())
            return {"success": False, "error": err.get('errorMessage', str(err)), "results": []}
        body = json.loads(response['Payload'].read())
        if isinstance(body.get('body'), str):
            out = json.loads(body['body'])
        else:
            out = body
        return {
            "success": out.get('success', True),
            "results": out.get('results', []),
            "error": out.get('error'),
            "metadata": out.get('metadata'),
        }
    except Exception as e:
        logger.exception("Govt contracts autocomplete Lambda invoke failed")
        return {"success": False, "error": str(e), "results": []}


@tool
def govt_contracts_autocomplete(
    search_text: str,
    autocomplete_type: str = "recipient",
    limit: int = 10
) -> str:
    """
    Get exact values for government contract search filters from USAspending autocomplete.
    Use this BEFORE search_govt_contracts whenever the user gives a generic or natural-language
    term for a filter; the search index uses exact/normalized values.

    Supported autocomplete_type (use the one that matches your search filter):
    - recipient: recipient_name (e.g. "university", "Lockheed") -> exact recipient names
    - awarding_agency: awarding_agency_name (e.g. "Department of Energy", "Defense")
    - funding_agency: funding_agency_name
    - cfda: cfda_number (e.g. "81.122" program numbers)
    - naics: naics_code (industry codes)
    - psc: psc_code (product/service codes)
    - city, location: recipient location
    - program_activity, glossary: program/term lookup
    - accounts_a, accounts_aid, etc.: TAS account components

    Workflow for comparing contracts (e.g. ASU DOE report):
    1. Identify the contract in context (e.g. Arizona State University, DOE).
    2. Call govt_contracts_autocomplete("university", "recipient", 10) to get exact
       recipient names (e.g. "ARIZONA STATE UNIVERSITY", "UNIVERSITY OF TEXAS AT AUSTIN").
    3. Pick a few comparables (same region, same type public/private, or similar scale).
    4. Call search_govt_contracts with recipient_name set to those exact names (list or single).
    5. Summarize or generate report from the search results; avoid reading huge S3 JSON into context.

    For agency, CFDA, NAICS, or PSC: use autocomplete_type "awarding_agency", "cfda", "naics", or "psc"
    with a natural-language search_text, then use the exact values from results in the corresponding filter.

    Args:
        search_text: Query (e.g. "university", "Department of Energy", "energy efficiency").
        autocomplete_type: recipient (default), awarding_agency, funding_agency, cfda, naics, psc, city, location, program_activity, glossary, or accounts_*.
        limit: Max suggestions (default 10, max 50).

    Returns:
        JSON with success, results (list of objects; field names vary by type), and optional error.
        Use the exact value strings from results in the corresponding search_govt_contracts filter.
    """
    try:
        agent_logger.info(f"Govt contracts autocomplete: type={autocomplete_type}, query='{search_text}', limit={limit}")
        result = invoke_govt_contracts_autocomplete(
            autocomplete_type=autocomplete_type,
            search_text=search_text,
            limit=limit,
        )
        return json.dumps(result, default=str)
    except Exception as e:
        agent_logger.exception("Govt contracts autocomplete failed")
        return json.dumps({"success": False, "error": str(e), "results": []}, default=str)
