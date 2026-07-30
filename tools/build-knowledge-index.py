#!/usr/bin/env python3
"""Build the server-side NAMA RAG index from the checked-in PDF corpus."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import fitz  # PyMuPDF
except ImportError as error:  # pragma: no cover - dependency failure is actionable CLI feedback
    raise SystemExit("PyMuPDF fehlt. Ausführen mit: uv run --with pymupdf python tools/build-knowledge-index.py") from error

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCES = ROOT / "knowledge" / "source-pdfs"
DEFAULT_OUTPUT = ROOT / "api" / "data" / "knowledge-index.json"
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 512
CHUNK_CHARS = 1_600
CHUNK_OVERLAP = 220
BATCH_SIZE = 32


def is_aggregate_duplicate(relative_path: Path) -> bool:
    """Individual PDFs are indexed instead of duplicate all-in-one collections."""
    name = relative_path.name.lower()
    return "gesamt" in name or name.startswith("alle_")


def clean_text(value: str) -> str:
    value = value.replace("\u00ad", "")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def is_exam_excluded(content: str) -> bool:
    """Omit topics explicitly excluded from the current NAMA exam scope."""
    return bool(re.search(r"\bLkSG\b|Lieferkettensorgfaltspflichtengesetz|Lieferkettengesetz", content, re.IGNORECASE))


def chunk_text(text: str) -> list[str]:
    text = clean_text(text)
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + CHUNK_CHARS)
        if end < len(text):
            split_at = max(text.rfind("\n", start + CHUNK_CHARS // 2, end), text.rfind(". ", start + CHUNK_CHARS // 2, end))
            if split_at > start:
                end = split_at + 1
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start = max(end - CHUNK_OVERLAP, start + 1)
    return chunks


def extract_chunks(source_dir: Path) -> tuple[list[dict], list[dict], list[dict]]:
    chunks: list[dict] = []
    source_reports: list[dict] = []
    skipped_sources: list[dict] = []

    for pdf_path in sorted(source_dir.rglob("*.pdf")):
        relative = pdf_path.relative_to(source_dir)
        source_name = str(relative.with_suffix(""))
        if is_aggregate_duplicate(relative):
            skipped_sources.append({"source": source_name, "reason": "Doppelung: Einzel-PDFs werden indexiert."})
            continue

        document = fitz.open(pdf_path)
        document_chunks = 0
        extracted_pages = 0
        for page_number, page in enumerate(document, start=1):
            page_text = clean_text(page.get_text("text", sort=True))
            page_chunks = [chunk for chunk in chunk_text(page_text) if not is_exam_excluded(chunk)]
            if page_chunks:
                extracted_pages += 1
            for offset, content in enumerate(page_chunks, start=1):
                chunks.append({
                    "id": f"{relative.as_posix()}:{page_number}:{offset}",
                    "source": source_name,
                    "page": page_number,
                    "content": content,
                })
                document_chunks += 1
        document.close()
        from_ocr_cache = False
        if not document_chunks:
            cache_path = source_dir.parent / "ocr-cache" / relative.with_suffix(".json")
            if cache_path.is_file():
                cache = json.loads(cache_path.read_text(encoding="utf-8"))
                for cached_page in cache.get("pages", []):
                    page_number = int(cached_page.get("page", 0))
                    page_chunks = [chunk for chunk in chunk_text(str(cached_page.get("text", ""))) if not is_exam_excluded(chunk)]
                    if page_chunks:
                        extracted_pages += 1
                    for offset, content in enumerate(page_chunks, start=1):
                        chunks.append({
                            "id": f"{relative.as_posix()}:{page_number}:{offset}",
                            "source": source_name,
                            "page": page_number,
                            "content": content,
                        })
                        document_chunks += 1
                from_ocr_cache = bool(document_chunks)
        report = {
            "source": source_name,
            "pages": extracted_pages,
            "chunks": document_chunks,
            "ocr": from_ocr_cache,
        }
        if document_chunks:
            source_reports.append(report)
        else:
            skipped_sources.append({"source": source_name, "reason": "Kein extrahierbarer Text (OCR erforderlich)."})
        state = "OCR" if from_ocr_cache else ("OK" if document_chunks else "MISSING OCR")
        print(f"{state}  {relative} — {document_chunks} Chunks")
    return chunks, source_reports, skipped_sources


def embed_batch(texts: list[str], api_key: str) -> list[list[float]]:
    payload = json.dumps({
        "model": EMBEDDING_MODEL,
        "dimensions": EMBEDDING_DIMENSIONS,
        "input": texts,
    }).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/embeddings",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urlopen(request, timeout=90) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"Embedding API HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Embedding API nicht erreichbar: {error.reason}") from error

    vectors = [entry.get("embedding") for entry in body.get("data", [])]
    if len(vectors) != len(texts) or any(len(vector or []) != EMBEDDING_DIMENSIONS for vector in vectors):
        raise RuntimeError("Embedding API lieferte unvollständige Vektoren.")
    return vectors


def add_embeddings(chunks: list[dict], api_key: str) -> None:
    for start in range(0, len(chunks), BATCH_SIZE):
        batch = chunks[start:start + BATCH_SIZE]
        for attempt in range(2):
            try:
                vectors = embed_batch([item["content"] for item in batch], api_key)
                break
            except RuntimeError:
                if attempt:
                    raise
                time.sleep(2)
        for chunk, vector in zip(batch, vectors):
            chunk["embedding"] = vector
        print(f"EMBED {min(start + len(batch), len(chunks))}/{len(chunks)}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources-dir", type=Path, default=DEFAULT_SOURCES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--dry-run", action="store_true", help="Extract/chunk and report without embedding or writing an index.")
    args = parser.parse_args()

    if not args.sources_dir.is_dir():
        raise SystemExit(f"Quellordner fehlt: {args.sources_dir}")
    chunks, source_reports, skipped_sources = extract_chunks(args.sources_dir)
    if not chunks:
        raise SystemExit("Keine indexierbaren PDF-Texte gefunden.")
    duplicate_count = sum("Doppelung" in item["reason"] for item in skipped_sources)
    ocr_gap_count = len(skipped_sources) - duplicate_count
    print(f"\nIndexierbare Chunks: {len(chunks)} aus {len(source_reports)} Quellen; OCR-Lücken: {ocr_gap_count}; übersprungene Doppelungen: {duplicate_count}")
    if args.dry_run:
        return 0

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY fehlt in der Umgebung.")
    add_embeddings(chunks, api_key)
    index = {
        "version": 1,
        "model": EMBEDDING_MODEL,
        "dimensions": EMBEDDING_DIMENSIONS,
        "createdAt": datetime.now(UTC).isoformat(),
        "chunkCount": len(chunks),
        "sources": source_reports,
        "skippedSources": skipped_sources,
        "chunks": chunks,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\nGeschrieben: {args.output} ({args.output.stat().st_size / 1024 / 1024:.2f} MiB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
