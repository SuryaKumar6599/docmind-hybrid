import pytest
from fastapi import HTTPException

from app.api import _validate_extension, _validate_size
from app.config import Settings


def _settings(max_mb: int = 25) -> Settings:
    return Settings(
        supabase_url="https://dummy.supabase.co",
        supabase_service_role_key="dummy",
        max_upload_size_mb=max_mb,
    )


def test_oversized_file_rejected() -> None:
    settings = _settings(max_mb=1)
    data = b"x" * (2 * 1024 * 1024)  # 2MB, over a 1MB limit
    with pytest.raises(HTTPException) as exc_info:
        _validate_size(data, settings, "big.pdf")
    assert exc_info.value.status_code == 413


def test_file_within_limit_passes() -> None:
    settings = _settings(max_mb=25)
    data = b"x" * (1024 * 1024)  # 1MB, well under 25MB
    _validate_size(data, settings, "ok.pdf")  # must not raise


def test_file_exactly_at_limit_passes() -> None:
    settings = _settings(max_mb=1)
    data = b"x" * (1 * 1024 * 1024)  # exactly 1MB
    _validate_size(data, settings, "exact.pdf")  # must not raise — "exceeds" means strictly over


def test_unsupported_extension_rejected() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _validate_extension("malware.exe")
    assert exc_info.value.status_code == 422


def test_supported_extension_passes() -> None:
    _validate_extension("resume.pdf")  # must not raise
