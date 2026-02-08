"""
Single PDF read tool: read PDF from S3 (with optional .cosine decrypt) and return text.
Uses parsers.pdf_parser for deterministic extraction. Agent chooses page_numbers.
"""

import json
import logging
import os
import sys
from typing import List, Optional

logger = logging.getLogger(__name__)

# Strands tool decorator
try:
    from strands.types.tools import ToolResult, ToolUse
    from strands import tool
except ImportError:
    def tool(f):
        return f


def _get_bucket_for_key(s3_key: str, s3_bucket: Optional[str]) -> str:
    """Resolve bucket: use param or S3FileReader logic."""
    if s3_bucket:
        return s3_bucket
    try:
        from s3_file_reader import S3FileReader
    except ImportError:
        tools_dir = os.path.dirname(os.path.abspath(__file__))
        if tools_dir not in sys.path:
            sys.path.insert(0, tools_dir)
        from s3_file_reader import S3FileReader
    return S3FileReader().get_bucket_name(s3_key)


def _get_user_id_from_key(s3_key: str) -> Optional[str]:
    """Extract user_id from users/{user_id}/..."""
    parts = s3_key.split("/")
    if len(parts) >= 2 and parts[0] == "users":
        return parts[1]
    return None


def _get_pdf_bytes(
    s3_key: str,
    s3_bucket: Optional[str],
) -> tuple:
    """
    Fetch PDF bytes from S3. If key is .cosine or content looks encrypted,
    decrypt and follow data.s3_key to underlying file. Returns (bytes, effective_s3_key).
    """
    import boto3
    bucket = _get_bucket_for_key(s3_key, s3_bucket)
    s3_client = boto3.client("s3")
    logger.info("[PDF_TOOL] get_object: bucket=%s key=%s", bucket, s3_key)
    response = s3_client.get_object(Bucket=bucket, Key=s3_key)
    body = response.get("Body")
    content_length = response.get("ContentLength")
    content = body.read(content_length) if content_length is not None else body.read()
    actual_len = len(content)
    logger.info(
        "[PDF_TOOL] S3 read: ContentLength=%s actual_bytes=%s key=%s",
        content_length,
        actual_len,
        s3_key,
    )
    if actual_len == 8192:
        logger.warning(
            "[PDF_TOOL] Exactly 8192 bytes read - likely truncated (upload or S3). key=%s",
            s3_key,
        )
    effective_key = s3_key

    # .cosine or encrypted user file: decrypt and optionally follow underlying key
    is_cosine = s3_key.lower().endswith(".cosine")
    looks_encrypted = len(content) >= 20 and content[:20].startswith(b"gAAAAAB")
    if is_cosine or (looks_encrypted and "/filesys/" in s3_key):
        try:
            if "utils.decryption_helper" in sys.modules:
                from utils.decryption_helper import decrypt_cosine_file
            else:
                try:
                    from utils.decryption_helper import decrypt_cosine_file
                except ImportError:
                    utils_path = os.path.join(os.path.dirname(__file__), "..", "utils")
                    if utils_path not in sys.path:
                        sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
                    from utils.decryption_helper import decrypt_cosine_file
            user_id = _get_user_id_from_key(s3_key)
            if not user_id:
                try:
                    from utils.auth_helper import get_secure_user_id
                    user_id = get_secure_user_id({}, fallback_to_env=True)
                except Exception:
                    user_id = os.environ.get("USER_ID") or os.environ.get("CURRENT_USER_ID")
            if not user_id:
                raise ValueError("Cannot decrypt .cosine file: user_id not found")
            data = decrypt_cosine_file(user_id, content)
            # Underlying file key (tile points to real file)
            inner = data.get("data") if isinstance(data.get("data"), dict) else {}
            underlying = inner.get("s3_key") or data.get("s3_key")
            if underlying and isinstance(underlying, str):
                bucket_under = _get_bucket_for_key(underlying, None)
                logger.info("[PDF_TOOL] Following .cosine underlying key: %s", underlying)
                resp2 = s3_client.get_object(Bucket=bucket_under, Key=underlying)
                body2 = resp2.get("Body")
                cl2 = resp2.get("ContentLength")
                content = body2.read(cl2) if cl2 is not None else body2.read()
                actual_len2 = len(content)
                logger.info(
                    "[PDF_TOOL] S3 read (underlying): ContentLength=%s actual_bytes=%s key=%s",
                    cl2,
                    actual_len2,
                    underlying,
                )
                if actual_len2 == 8192:
                    logger.warning(
                        "[PDF_TOOL] Exactly 8192 bytes from underlying key - likely truncated. key=%s",
                        underlying,
                    )
                effective_key = underlying
        except Exception as e:
            logger.warning("Decryption or follow for %s failed: %s", s3_key, e)
            raise ValueError(f"Failed to decrypt or read underlying file: {e}") from e

    logger.info("[PDF_TOOL] _get_pdf_bytes returning: effective_key=%s len(content)=%s", effective_key, len(content))
    return content, effective_key


def _is_pdf(content: bytes, effective_key: str) -> bool:
    if content[:5] == b"%PDF-":
        return True
    if effective_key.lower().endswith(".pdf"):
        return True
    return False


@tool
def read_pdf_tool(
    s3_key: str,
    page_numbers: Optional[List[int]] = None,
    s3_bucket: Optional[str] = None,
) -> str:
    """
    Read text from a PDF in S3. Use for PDFs from context items or user uploads.
    Handles .cosine encrypted files (decrypts and reads underlying PDF).
    You choose which pages to read (1-indexed). Omit page_numbers to read all pages.

    Args:
        s3_key: S3 key of the PDF (or .cosine wrapper, e.g. users/user_id/filesys/...).
        page_numbers: Optional list of 1-indexed page numbers to read (e.g. [1, 2, 5]).
                      Omit or pass None to read the entire PDF.
        s3_bucket: Optional bucket name when the key is in a specific bucket (e.g. from context).

    Returns:
        Extracted text and metadata (total pages, pages read).
    """
    if not s3_key or not s3_key.strip():
        return "Error: s3_key is required."

    logger.info("[PDF_TOOL] read_pdf_tool called: s3_key=%s page_numbers=%s s3_bucket=%s", s3_key, page_numbers, s3_bucket)
    try:
        content, effective_key = _get_pdf_bytes(s3_key, s3_bucket)
    except ValueError as e:
        return f"Error: {e}"
    except Exception as e:
        logger.exception("Failed to get PDF bytes for %s", s3_key)
        return f"Error reading file: {e}"

    if not _is_pdf(content, effective_key):
        return (
            "Error: File is not a PDF (or decrypted content is not a PDF). "
            "Use read_s3_file_tool for other file types."
        )

    logger.info("[PDF_TOOL] Calling extract_text: len(content)=%s effective_key=%s", len(content), effective_key)
    try:
        from parsers.pdf_parser import extract_text
    except ImportError:
        import sys as _sys
        tools_dir = os.path.dirname(os.path.abspath(__file__))
        if tools_dir not in _sys.path:
            _sys.path.insert(0, tools_dir)
        from parsers.pdf_parser import extract_text

    result = extract_text(content, page_numbers=page_numbers)
    if not result.get("success"):
        logger.warning("[PDF_TOOL] extract_text failed: %s", result.get("error"))
        return f"Error extracting PDF text: {result.get('error', 'Unknown error')}"

    total = result.get("total_pages", 0)
    pages_read = result.get("pages_read", [])
    text = result.get("text", "")

    lines = [
        f"PDF: {effective_key}",
        f"Total pages: {total}",
        f"Pages read: {pages_read if pages_read else 'all'}",
        "",
        "--- Text ---",
        text or "(no text extracted)",
    ]
    return "\n".join(lines)
