"""
Pillow Image.open workaround for GHSA-cfh3-3jmp-rvhc (CVE-2026-25990).

When Pillow < 12.1.1 is in use, loading untrusted PSD images can trigger an
out-of-bounds write. This module patches PIL.Image.open so that by default
only safe formats are allowed (PSD excluded). Apply by importing this module
early at application startup.

See: https://github.com/python-pillow/Pillow/security/advisories/GHSA-cfh3-3jmp-rvhc
"""

import logging

# Safe formats: common image types we allow. Explicitly exclude PSD (GHSA-cfh3-3jmp-rvhc).
SAFE_IMAGE_FORMATS = (
    "BMP",
    "GIF",
    "JPEG",
    "PNG",
    "WEBP",
    "TIFF",
    "ICO",
)

_logger = logging.getLogger(__name__)


def _apply_pillow_open_patch() -> None:
    try:
        import inspect
        from PIL import Image

        sig = inspect.signature(Image.open)
        if "formats" not in sig.parameters:
            _logger.debug("Pillow Image.open has no formats parameter; patch skipped (upgrade to 10.3+)")
            return

        _original_open = Image.open

        def _safe_open(fp, mode="r", formats=None, **kwargs):
            if formats is None:
                formats = SAFE_IMAGE_FORMATS
            return _original_open(fp, mode=mode, formats=formats, **kwargs)

        Image.open = _safe_open
        _logger.debug("Pillow Image.open patched to exclude PSD by default (GHSA-cfh3-3jmp-rvhc workaround)")
    except ImportError:
        _logger.debug("PIL not available; Pillow safe-open patch skipped")
    except Exception as e:
        _logger.warning("Could not apply Pillow safe-open patch: %s", e)


_apply_pillow_open_patch()
