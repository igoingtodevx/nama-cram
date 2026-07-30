# NAMA knowledge base

## Source PDFs

`source-pdfs/` contains the local NAMA materials that the knowledge index is built from. They are deliberately included in Git for reproducibility, but excluded from Vercel deployments through `.vercelignore`.

## Build / rebuild

```bash
set -a; . /home/deploy/.hermes/.env; set +a
uv run --with pymupdf python tools/build-knowledge-index.py
```

The script extracts text page-by-page, omits redundant aggregate PDFs where equivalent individual PDFs exist, chunks text, creates 512-dimensional OpenAI `text-embedding-3-small` vectors, and writes `index.json`.

`index.json` is the only knowledge artifact shipped to the serverless chat endpoint. Sources with no extractable text are reported under `skippedSources` for later OCR.
