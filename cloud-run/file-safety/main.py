"""Isolated file validation and malware scanning service for StudioCue uploads."""

import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from google.cloud import storage
from pydantic import BaseModel, Field

app = FastAPI(title="StudioCue File Safety")
client = storage.Client()


class ScanRequest(BaseModel):
    bucket: str = Field(min_length=3, max_length=255)
    object_name: str = Field(min_length=1, max_length=1024)
    expected_content_type: str = Field(min_length=3, max_length=160)
    max_bytes: int = Field(gt=0, le=25 * 1024 * 1024)


CONTENT_TYPES_BY_EXTENSION = {
    ".pdf": {"application/pdf", "application/octet-stream"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
    ".doc": {"application/msword", "application/octet-stream"},
    ".docx": {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/octet-stream",
    },
    ".rtf": {"application/rtf", "text/rtf", "application/octet-stream"},
    ".txt": {"text/plain", "application/octet-stream"},
    ".csv": {"text/csv", "text/plain", "application/octet-stream"},
}

MAGIC_BY_EXTENSION = {
    ".pdf": (b"%PDF-",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".doc": (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",),
    ".docx": (b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"),
    ".rtf": (b"{\\rtf",),
}


def valid_signature(
    object_name: str,
    content_type: str,
    header: bytes,
) -> bool:
    extension = Path(object_name).suffix.lower()
    if content_type not in CONTENT_TYPES_BY_EXTENSION.get(extension, set()):
        return False
    signatures = MAGIC_BY_EXTENSION.get(extension)
    if signatures:
        return any(header.startswith(signature) for signature in signatures)
    if extension in {".txt", ".csv"}:
        if b"\x00" in header:
            return False
        try:
            header.decode("utf-8")
        except UnicodeDecodeError:
            return False
        return True
    return False


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "studiohub-file-safety", "status": "ok"}


@app.post("/v1/scan")
def scan(request: ScanRequest) -> dict[str, str | int]:
    blob = client.bucket(request.bucket).blob(request.object_name)
    blob.reload()
    if not blob.size or blob.size > request.max_bytes:
        raise HTTPException(status_code=422, detail="FILE_SIZE_INVALID")
    with tempfile.TemporaryDirectory(prefix="studiohub-scan-") as folder:
        path = Path(folder) / "upload"
        blob.download_to_filename(str(path))
        with path.open("rb") as source:
            header = source.read(4096)
        if not valid_signature(
            request.object_name,
            request.expected_content_type,
            header,
        ):
            raise HTTPException(status_code=422, detail="FILE_SIGNATURE_MISMATCH")
        result = subprocess.run(
            ["clamscan", "--no-summary", str(path)],
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        if result.returncode == 1:
            return {"status": "infected", "engine": "clamav", "size_bytes": blob.size}
        if result.returncode != 0:
            raise HTTPException(status_code=503, detail="MALWARE_ENGINE_UNAVAILABLE")
    return {"status": "clean", "engine": "clamav", "size_bytes": blob.size}
