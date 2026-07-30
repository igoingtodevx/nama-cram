#!/usr/bin/env python3
"""OCR scanned NAMA PDFs once through OpenAI vision and cache page text in Git."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    import fitz  # PyMuPDF
except ImportError as error:
    raise SystemExit("PyMuPDF fehlt. Ausführen mit: uv run --with pymupdf python tools/ocr-scanned-pdfs.py") from error

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "knowledge" / "source-pdfs"
CACHE_ROOT = ROOT / "knowledge" / "ocr-cache"
OCR_MODEL = os.environ.get("NAMA_OCR_MODEL", "gpt-5.4-mini")

PROMPT = """Transkribiere diese einzelne Seite einer deutschen NAMA-Altklausur vollständig und wortgetreu.
Erfasse Überschriften, Aufgaben, Teilaufgaben, Punkte, Zahlen, Formeln und jede Tabellenzelle.
Gib kompakten Plaintext aus: keine Ausrichtung durch Leerzeichen oder Tabs, keine Bildbeschreibung und keine Lösung. Für Tabellen verwende eine Zeile pro Tabelle mit Spalten durch ` | ` getrennt. Kontrolliere vor dem Antworten, dass auch der untere Seitenbereich vollständig enthalten ist."""


def request_ocr(image_bytes: bytes, api_key: str) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    payload = json.dumps({
        "model": OCR_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}", "detail": "high"}},
            ],
        }],
        "max_completion_tokens": 4_000,
        "temperature": 0,
    }).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/chat/completions",
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
    )
    try:
        with urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"OCR API HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"OCR API nicht erreichbar: {error.reason}") from error
    text = body.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    if not text:
        raise RuntimeError("OCR API lieferte keinen Text.")
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", nargs="*", type=Path, help="Optional relative paths under knowledge/source-pdfs.")
    parser.add_argument("--limit-pages", type=int, default=0, help="For a smoke test, OCR only the first N pages per PDF.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing OCR cache files.")
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY fehlt in der Umgebung.")
    pdfs = [SOURCE_ROOT / path for path in args.pdf] if args.pdf else sorted((SOURCE_ROOT / "Klausuren").glob("SS*.pdf"))
    for pdf_path in pdfs:
        if not pdf_path.is_file():
            raise SystemExit(f"PDF fehlt: {pdf_path}")
        relative = pdf_path.relative_to(SOURCE_ROOT)
        cache_path = CACHE_ROOT / relative.with_suffix(".json")
        if cache_path.exists() and not args.force:
            print(f"CACHE {relative}")
            continue
        document = fitz.open(pdf_path)
        pages = []
        page_count = min(len(document), args.limit_pages) if args.limit_pages else len(document)
        for index in range(page_count):
            page = document[index]
            pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
            print(f"OCR   {relative}, Seite {index + 1}/{page_count}", flush=True)
            pages.append({"page": index + 1, "text": request_ocr(pixmap.tobytes("png"), api_key)})
        document.close()
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"source": str(relative.with_suffix("")), "model": OCR_MODEL, "pages": pages}, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"WRITE {cache_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
