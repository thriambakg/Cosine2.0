"""
FEC Campaign Finance Search API

POST /fec-search body actions:
  - search: live openFEC name search (candidates + committees)
  - profile: DynamoDB GetItem CANDIDATE# / COMMITTEE# PROFILE#{cycle}
  - schedules: paginated Schedule A/B/E rows from S3 gzip JSON (committees only)
"""

from __future__ import annotations

import gzip
import json
import logging
import os
import time
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import boto3
from botocore.exceptions import ClientError
from cors_helper import get_cors_headers

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO").upper())

FEC_API_BASE_URL = os.environ.get("FEC_API_BASE_URL", "https://api.open.fec.gov/v1").rstrip("/")
FEC_SECRET_NAME = os.environ.get("FEC_SECRET_NAME", "")
FEC_PROFILES_TABLE_NAME = os.environ.get("FEC_PROFILES_TABLE_NAME", "")
FEC_DATA_S3_BUCKET_NAME = os.environ.get("FEC_DATA_S3_BUCKET_NAME", "")
REQUEST_TIMEOUT = int(os.environ.get("REQUEST_TIMEOUT", "30"))
SEARCH_PER_PAGE = int(os.environ.get("SEARCH_PER_PAGE", "25"))

dynamodb = boto3.resource("dynamodb")
s3_client = boto3.client("s3")
secrets_client = boto3.client("secretsmanager")

profiles_table = (
    dynamodb.Table(FEC_PROFILES_TABLE_NAME) if FEC_PROFILES_TABLE_NAME else None
)

_api_keys: Optional[List[str]] = None
_api_key_index = 0


def build_cors_headers(origin: Optional[str] = None) -> Dict[str, str]:
    return {
        "Content-Type": "application/json",
        **get_cors_headers(origin),
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": (
            "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token"
        ),
    }


def convert_decimal(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, dict):
        return {k: convert_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [convert_decimal(v) for v in obj]
    return obj


def fec_cycle_for_date() -> int:
    from datetime import date

    y = date.today().year
    return y if y % 2 == 0 else y + 1


def _load_api_keys() -> List[str]:
    global _api_keys
    if _api_keys is not None:
        return _api_keys
    if not FEC_SECRET_NAME:
        raise RuntimeError("FEC_SECRET_NAME is not configured")
    resp = secrets_client.get_secret_value(SecretId=FEC_SECRET_NAME)
    payload = json.loads(resp["SecretString"])
    raw = payload.get("api_keys") if isinstance(payload, dict) else payload
    if isinstance(raw, str):
        raw = json.loads(raw)
    if not isinstance(raw, list) or not raw:
        raise RuntimeError("FEC secret api_keys must be a non-empty array")
    _api_keys = [str(k).strip() for k in raw if str(k).strip()]
    return _api_keys


def _next_api_key() -> str:
    global _api_key_index
    keys = _load_api_keys()
    key = keys[_api_key_index % len(keys)]
    _api_key_index += 1
    return key


def _fec_get(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    query = dict(params or {})
    query["api_key"] = _next_api_key()
    url = f"{FEC_API_BASE_URL}{path}?{urlencode(query, doseq=True)}"
    req = Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "Cosine-fec-search/1.0",
        },
    )
    for attempt in range(3):
        try:
            with urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                time.sleep(2.0 * (attempt + 1))
                continue
            raise RuntimeError(f"openFEC HTTP {exc.code}: {path}") from exc
        except (TimeoutError, URLError) as exc:
            if attempt < 2:
                time.sleep(2.0 * (attempt + 1))
                continue
            raise RuntimeError(f"openFEC timeout: {path}") from exc
    raise RuntimeError(f"openFEC failed: {path}")


def _cycle_hint(cycles: List[int], target: int) -> str:
    if not cycles:
        return "cycles unknown"
    if target in cycles:
        return f"active in {target}"
    return f"cycles {min(cycles)}–{max(cycles)} (not {target})"


def search_entities(
    query: str, cycle: int, limit: int = SEARCH_PER_PAGE
) -> Dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"success": True, "results": [], "count": 0}

    hits: List[Dict[str, Any]] = []
    seen: set[str] = set()

    try:
        data = _fec_get("/names/candidates/", {"q": q})
        for row in data.get("results") or []:
            cid = row.get("id") or ""
            if not cid or cid in seen:
                continue
            seen.add(cid)
            hits.append(
                {
                    "entity_type": "candidate",
                    "entity_id": cid,
                    "name": row.get("name") or cid,
                    "subtitle": f"Office sought: {row.get('office_sought') or '—'}",
                    "cycles": [],
                }
            )
    except Exception as exc:
        logger.warning("names/candidates failed: %s", exc)

    try:
        data = _fec_get(
            "/candidates/search/",
            {"q": q, "cycle": cycle, "per_page": limit, "sort": "name"},
        )
        for row in data.get("results") or []:
            cid = row.get("candidate_id") or ""
            if not cid or cid in seen:
                continue
            seen.add(cid)
            cycles = [int(x) for x in (row.get("cycles") or [])]
            office = row.get("office_full") or row.get("office") or "—"
            state = row.get("state") or "—"
            party = row.get("party_full") or row.get("party") or "—"
            hits.append(
                {
                    "entity_type": "candidate",
                    "entity_id": cid,
                    "name": row.get("name") or cid,
                    "subtitle": f"{office} · {state} · {party} · {_cycle_hint(cycles, cycle)}",
                    "cycles": cycles,
                    "party": party,
                    "state": state,
                    "office": office,
                }
            )
    except Exception as exc:
        logger.warning("candidates/search failed: %s", exc)

    try:
        data = _fec_get(
            "/committees/",
            {"q": q, "cycle": cycle, "per_page": limit, "sort": "name"},
        )
        for row in data.get("results") or []:
            cid = row.get("committee_id") or ""
            if not cid or cid in seen:
                continue
            seen.add(cid)
            cycles = [int(x) for x in (row.get("cycles") or [])]
            hits.append(
                {
                    "entity_type": "committee",
                    "entity_id": cid,
                    "name": row.get("name") or cid,
                    "subtitle": (
                        f"{row.get('committee_type_full') or row.get('committee_type') or '—'}"
                        f" · {_cycle_hint(cycles, cycle)}"
                    ),
                    "cycles": cycles,
                    "committee_type": row.get("committee_type"),
                }
            )
    except Exception as exc:
        logger.warning("committees search failed: %s", exc)

    hits.sort(key=lambda h: (0 if cycle in (h.get("cycles") or []) else 1, h.get("name", "")))
    results = hits[:limit]
    return {"success": True, "results": results, "count": len(results), "cycle": cycle}


def get_profile(entity_type: str, entity_id: str, cycle: int) -> Dict[str, Any]:
    if not profiles_table:
        raise RuntimeError("FEC_PROFILES_TABLE_NAME is not configured")
    et = entity_type.strip().lower()
    if et not in ("candidate", "committee"):
        raise ValueError("entity_type must be candidate or committee")
    pk = f"{'CANDIDATE' if et == 'candidate' else 'COMMITTEE'}#{entity_id}"
    sk = f"PROFILE#{cycle}"
    resp = profiles_table.get_item(Key={"PK": pk, "SK": sk})
    item = resp.get("Item")
    if not item:
        return {
            "success": True,
            "result": None,
            "count": 0,
            "error": f"No profile for {et} {entity_id} cycle {cycle}",
        }
    profile = convert_decimal(item)
    return {"success": True, "result": profile, "count": 1}


def _schedule_s3_key(cycle: int, committee_id: str, schedule: str) -> str:
    return f"{cycle}/committee/{committee_id}/{schedule}.json.gz"


def _load_schedule_rows(s3_key: str) -> List[Dict[str, Any]]:
    if not FEC_DATA_S3_BUCKET_NAME:
        raise RuntimeError("FEC_DATA_S3_BUCKET_NAME is not configured")
    resp = s3_client.get_object(Bucket=FEC_DATA_S3_BUCKET_NAME, Key=s3_key)
    body = gzip.decompress(resp["Body"].read())
    data = json.loads(body.decode("utf-8"))
    if isinstance(data, list):
        return data
    return data.get("results") or []


def get_schedules(
    committee_id: str,
    cycle: int,
    schedule: str,
    page: int = 1,
    per_page: int = 100,
) -> Dict[str, Any]:
    schedule = schedule.strip().lower().replace("-", "_")
    if schedule not in ("schedule_a", "schedule_b", "schedule_e"):
        raise ValueError("schedule must be schedule_a, schedule_b, or schedule_e")

    s3_key = _schedule_s3_key(cycle, committee_id, schedule)
    try:
        rows = _load_schedule_rows(s3_key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") not in ("NoSuchKey", "404"):
            raise
        return {
            "success": True,
            "results": [],
            "count": 0,
            "page": page,
            "per_page": per_page,
            "total_rows": 0,
            "total_pages": 0,
            "s3_key": s3_key,
            "error": "Schedule file not found in S3 (index the committee first)",
        }
    except Exception as exc:
        logger.error("S3 schedule read failed: %s", exc, exc_info=True)
        raise

    total = len(rows)
    per_page = max(1, min(per_page, 500))
    page = max(1, page)
    start = (page - 1) * per_page
    end = start + per_page
    page_rows = rows[start:end]
    total_pages = (total + per_page - 1) // per_page if total else 0

    return {
        "success": True,
        "results": page_rows,
        "count": len(page_rows),
        "page": page,
        "per_page": per_page,
        "total_rows": total,
        "total_pages": total_pages,
        "has_more": page < total_pages,
        "s3_key": s3_key,
        "schedule": schedule,
    }


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    body = event.get("body", {})
    if isinstance(body, str):
        try:
            return json.loads(body) if body else {}
        except json.JSONDecodeError:
            return {}
    return body if isinstance(body, dict) else {}


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    headers_in = event.get("headers") or {}
    origin = headers_in.get("Origin") or headers_in.get("origin")
    cors = build_cors_headers(origin)

    if event.get("httpMethod") == "OPTIONS":
        return {"statusCode": 200, "headers": cors, "body": json.dumps({"ok": True})}

    try:
        body = _parse_body(event)
        action = (body.get("action") or "").strip().lower()

        # Profile lookup (also when entity_type + entity_id without action)
        entity_type = (body.get("entity_type") or "").strip().lower()
        entity_id = (body.get("entity_id") or "").strip()
        cycle_raw = body.get("cycle")
        cycle = int(cycle_raw) if cycle_raw not in (None, "") else fec_cycle_for_date()

        if action == "schedules" or body.get("schedule"):
            if not entity_id:
                raise ValueError("entity_id (committee_id) is required for schedules")
            result = get_schedules(
                committee_id=entity_id,
                cycle=cycle,
                schedule=body.get("schedule") or "schedule_a",
                page=int(body.get("page") or 1),
                per_page=int(body.get("per_page") or 100),
            )
            return {"statusCode": 200, "headers": cors, "body": json.dumps(result, default=str)}

        if action == "profile" or (entity_type and entity_id and action != "search"):
            if not entity_type or not entity_id:
                raise ValueError("entity_type and entity_id are required for profile")
            result = get_profile(entity_type, entity_id, cycle)
            return {"statusCode": 200, "headers": cors, "body": json.dumps(result, default=str)}

        # Default: search
        filters = body.get("filters") or {}
        query = filters.get("q") or body.get("q") or ""
        limit = int(body.get("limit") or filters.get("limit") or SEARCH_PER_PAGE)
        search_cycle = int(filters.get("cycle") or cycle)
        result = search_entities(query, search_cycle, limit=limit)
        return {"statusCode": 200, "headers": cors, "body": json.dumps(result, default=str)}

    except ValueError as exc:
        return {
            "statusCode": 400,
            "headers": cors,
            "body": json.dumps({"success": False, "error": str(exc)}),
        }
    except Exception as exc:
        logger.error("FEC search error: %s", exc, exc_info=True)
        return {
            "statusCode": 500,
            "headers": cors,
            "body": json.dumps({"success": False, "error": "Internal server error", "message": str(exc)}),
        }
