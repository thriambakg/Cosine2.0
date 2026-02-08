"""
Deterministic PDF parser: extract text from PDF bytes with optional page selection.
Single source of truth for PDF text extraction; no analysis or S3 logic outside this module.
"""

import logging
import os
from io import BytesIO
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# PyPDF2 is the only dependency for extraction
try:
    import PyPDF2  # noqa: F401
except ImportError:
    PyPDF2 = None


def extract_text(
    pdf_content: bytes,
    page_numbers: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """
    Extract text from PDF content. Deterministic: same input -> same output.

    Args:
        pdf_content: Raw PDF bytes.
        page_numbers: 1-indexed page numbers to extract (e.g. [1, 3, 5]).
                      None or empty = all pages.

    Returns:
        Dict with:
            - success: bool
            - text: str (extracted text for requested pages)
            - total_pages: int
            - pages_read: list of 1-indexed page numbers actually read
            - error: str (if success is False)
    """
    if PyPDF2 is None:
        return {
            "success": False,
            "text": "",
            "total_pages": 0,
            "pages_read": [],
            "error": "PyPDF2 not available",
        }
    if not pdf_content or len(pdf_content) < 100:
        return {
            "success": False,
            "text": "",
            "total_pages": 0,
            "pages_read": [],
            "error": "PDF content too short or empty",
        }
    try:
        reader = PyPDF2.PdfReader(BytesIO(pdf_content))
        total_pages = len(reader.pages)
        if total_pages == 0:
            return {
                "success": True,
                "text": "",
                "total_pages": 0,
                "pages_read": [],
                "error": None,
            }

        if page_numbers is None or len(page_numbers) == 0:
            pages_to_read = list(range(1, total_pages + 1))
        else:
            # Normalize: 1-indexed, clamp to valid range, unique, sorted
            pages_to_read = sorted(
                set(
                    p for p in page_numbers
                    if isinstance(p, int) and 1 <= p <= total_pages
                )
            )
            if not pages_to_read:
                return {
                    "success": False,
                    "text": "",
                    "total_pages": total_pages,
                    "pages_read": [],
                    "error": f"No valid page numbers in {page_numbers}. PDF has {total_pages} pages (1-indexed).",
                }

        parts = []
        for p in pages_to_read:
            page = reader.pages[p - 1]
            part = page.extract_text()
            if part:
                parts.append(part)
        text = "\n\n".join(parts).strip()

        return {
            "success": True,
            "text": text,
            "total_pages": total_pages,
            "pages_read": pages_to_read,
            "error": None,
        }
    except Exception as e:
        err_msg = str(e)
        logger.error("Error extracting text from PDF: %s", err_msg)
        if "EOF marker not found" in err_msg or "EOF" in err_msg:
            logger.warning(
                "PDF may be truncated or corrupted (length=%s bytes)",
                len(pdf_content),
            )
        return {
            "success": False,
            "text": "",
            "total_pages": 0,
            "pages_read": [],
            "error": f"Error extracting text: {err_msg}",
        }


def get_pdf_page_count(pdf_content: bytes) -> int:
    """Return number of pages in PDF bytes. Returns 0 on error."""
    if not PyPDF2 or not pdf_content:
        return 0
    try:
        reader = PyPDF2.PdfReader(BytesIO(pdf_content))
        return len(reader.pages)
    except Exception:
        return 0


def get_pdf_bytes_from_s3(s3_key: str, s3_bucket: Optional[str] = None) -> bytes:
    """
    Fetch object from S3 and return raw bytes. Used when parser is called with
    content=None (e.g. large-file path). Default bucket is CHAT_FILES_BUCKET_NAME.

    Args:
        s3_key: S3 key.
        s3_bucket: Bucket name. If None, uses CHAT_FILES_BUCKET_NAME.

    Returns:
        Raw bytes from S3.

    Raises:
        ValueError: If bucket is missing or key cannot be read.
    """
    import boto3
    bucket = s3_bucket or os.environ.get("CHAT_FILES_BUCKET_NAME")
    if not bucket:
        raise ValueError("CHAT_FILES_BUCKET_NAME not set and s3_bucket not provided")
    client = boto3.client("s3")
    response = client.get_object(Bucket=bucket, Key=s3_key)
    body = response.get("Body")
    content_length = response.get("ContentLength")
    if content_length is not None:
        return body.read(content_length)
    return body.read()
