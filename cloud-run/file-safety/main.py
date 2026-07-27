"""Isolated file validation and malware scanning service for StudioHub uploads."""

import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException
from google.cloud import storage
from pydantic import BaseModel, Field

app = FastAPI(title="StudioHub File Safety")
client = storage.Client()


class ScanRequest(BaseModel):
    bucket: str = Field(min_length=3, max_length=255)
    object_name: str = Field(min_length=1, max_length=1024)
    expected_content_type: str = Field(min_length=3, max_length=160)
    max_bytes: int = Field(gt=0, le=25 * 1024 * 1024)


MAGIC = {
    "application/pdf": (b"%PDF",),
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b"PK\x03\x04",),
}


@app.get("/health")
def health() -> dict[str, str]:
    return {"service": "studiohub-file-safety", "status": "ok"}


@app.post("/v1/scan")
def scan(request: ScanRequest) -> dict[str, str | int]:
    signatures = MAGIC.get(request.expected_content_type)
    if not signatures:
        raise HTTPException(status_code=422, detail="CONTENT_TYPE_NOT_ALLOWED")
    blob = client.bucket(request.bucket).blob(request.object_name)
    blob.reload()
    if not blob.size or blob.size > request.max_bytes:
        raise HTTPException(status_code=422, detail="FILE_SIZE_INVALID")
    with tempfile.TemporaryDirectory(prefix="studiohub-scan-") as folder:
        path = Path(folder) / "upload"
        blob.download_to_filename(str(path))
        with path.open("rb") as source:
            header = source.read(16)
        if not any(header.startswith(signature) for signature in signatures):
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
