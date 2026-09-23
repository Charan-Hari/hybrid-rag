# Hybrid RAG

A production-minded Retrieval-Augmented Generation (RAG) showcase: **hybrid search
(dense + sparse) + cross-encoder re-ranking + streaming, citation-grounded answers +
confidence-gated fallback**, deployable for free.

This project intentionally goes beyond the classic
["simple-local-rag"](https://github.com/mrdbourke/simple-local-rag) tutorial pattern
(fixed-chunk + single dense vector search + local-only notebook) to demonstrate
production RAG engineering.

## Architecture

```
GitHub Pages (frontend/)              <- static HTML/JS/CSS, no build step
        │  fetch / SSE stream
        ▼
FastAPI backend (backend/)            <- deploy free on Hugging Face Spaces / Render
        │
        ├── Ingestion: PDF / DOCX / Markdown / TXT loaders + recursive chunker
        ├── Embeddings: sentence-transformers (all-MiniLM-L6-v2, free-tier friendly)
        ├── Vector store: Chroma (persistent, local disk)
        ├── Hybrid retrieval: dense (Chroma) + sparse (BM25) fused via
        │                     Reciprocal Rank Fusion (RRF)
        ├── Re-ranking: optional cross-encoder (disabled by default on free tiers)
        ├── Confidence gate: skips LLM call and returns an honest
        │                    "insufficient context" message when
        │                    retrieval relevance is too low
        └── Generation: Groq (Llama 3.3) or Gemini (2.0 Flash) — both have
                         generous free tiers, streamed via Server-Sent Events
```

## Why this is different from the tutorial

| Feature | simple-local-rag | This project |
|---|---|---|
| Retrieval | dense only, in-memory tensor | hybrid dense+sparse, persistent vector DB |
| Precision | none | cross-encoder re-ranking |
| Answer grounding | none | inline citations `[1]`, `[2]` with source + page |
| Hallucination control | none | confidence threshold → explicit fallback |
| Interface | Jupyter/Colab notebook | deployed web UI + REST/streaming API |
| Chunking | fixed sentence count | recursive splitter with overlap |
| Document types | PDF only | PDF, DOCX, Markdown, TXT |
| Evaluation | none | retrieval-hit-rate eval harness (`backend/eval`) |
| Deployment | local GPU only | free-tier cloud (HF Spaces/Render + GitHub Pages) |

## Repository layout

```
hybrid-rag/
├── backend/
│   ├── app/
│   │   ├── main.py          # FastAPI app: /api/ingest, /api/query (SSE), /api/health, /api/reset
│   │   ├── config.py        # env-driven settings (pydantic-settings)
│   │   ├── ingestion.py     # loaders + recursive chunker
│   │   ├── vectorstore.py   # embeddings + Chroma wrapper
│   │   ├── retrieval.py     # hybrid (BM25 + dense) fusion + re-ranking
│   │   └── generation.py    # Groq/Gemini streaming + citation prompt + fallback
│   ├── tests/                # pytest unit + API tests
│   ├── eval/                 # simple retrieval-quality eval harness
│   ├── Dockerfile
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── index.html            # static UI, no build step — deploy as-is to GitHub Pages
│   ├── app.js
│   ├── style.css
│   └── samples/              # five bundled PDF, DOCX, and Markdown demo fixtures
└── .github/workflows/
    ├── backend-ci.yml        # lint + pytest on backend changes
    └── deploy-pages.yml      # auto-deploy frontend/ to GitHub Pages
```

## Getting started locally

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt -r requirements-dev.txt
copy .env.example .env        # PowerShell; then fill in GROQ_API_KEY or GEMINI_API_KEY
uvicorn app.main:app --reload --port 7860
```

Get a **free** API key from one of:
- Groq: https://console.groq.com/keys (fast, free tier, Llama 3.3 70B)
- Gemini: https://aistudio.google.com/apikey (free tier, Gemini 2.0 Flash)

Run tests:
```bash
pytest -v
```

### 2. Frontend

No build step required. Either:
- Open `frontend/index.html` directly in a browser, or
- Serve it locally: `python -m http.server 5500 --directory frontend`

The UI defaults to the current origin when hosted and keeps connection controls under
**Advanced connection settings**. For local development, it automatically uses
`http://localhost:7860`; leave `API_KEY` empty for a frictionless demo. For a public
deployment, set `window.HYBRID_RAG_API_BASE` before `app.js` in `frontend/index.html` to
the deployed backend URL. Use an authentication proxy or short-lived token rather than
exposing a shared administrator key in a browser.

### 3. Try it
1. Choose one of the five bundled samples or add a PDF/DOCX/MD/TXT file using the
   document drop zone. The pack includes a PDF with embedded images/tables, two DOCX
   files with structured tables, and two Markdown references. Samples are kept in
   `frontend/samples/`, so the demo still works if external downloads are unavailable.
2. Ask a question in the chat box — the answer streams in with numbered
   citations `[1]`, `[2]` linking back to source + page.
3. Ask something unrelated to the document — you should see the explicit
   "I don't have enough relevant information..." fallback instead of a
   hallucinated answer.

## API surface

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness and indexed chunk count |
| GET | `/api/documents` | List indexed sources and chunk/page counts |
| POST | `/api/ingest` | Index a PDF, DOCX, Markdown, or TXT file |
| DELETE | `/api/documents/{source}` | Remove one source and its chunks |
| POST | `/api/query` | Stream answer/citations as Server-Sent Events |
| DELETE | `/api/reset` | Clear the complete local index |

`/api/query` emits `citations`, `token`, and `done` events. The frontend consumes this
stream directly, so the answer appears progressively instead of waiting for generation
to finish.

## Deploying for free

**Backend** (pick one):
- **Hugging Face Spaces** (Docker SDK, free CPU tier) — push `backend/` with its
  `Dockerfile`, set `GROQ_API_KEY`/`GEMINI_API_KEY` and `API_KEY` as Space secrets.
- **Render** free web service — point the root at `backend/`, build command
  `pip install -r requirements.txt`, start command
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

**Frontend**:
- GitHub Pages, via the included `.github/workflows/deploy-pages.yml` (auto-deploys
  `frontend/` on push to `main`). After deploying, update the **Backend API base URL**
  field in the UI (the URL is persisted in `localStorage`) to point at your deployed
  backend URL, and set `CORS_ALLOW_ORIGINS` on the backend to the exact Pages origin
  (e.g. `https://charan-hari.github.io`).

### GitHub Pages

The included workflow publishes `frontend/` to:

```text
https://charan-hari.github.io/hybrid-rag/
```

In repository **Settings → Pages**, choose **GitHub Actions** as the source. The
frontend is intentionally static and does not contain an API key.

### Backend deployment checklist

1. Create a Render service or Docker-based Hugging Face Space from `backend/`.
2. Set `LLM_PROVIDER`, `GROQ_API_KEY` or `GEMINI_API_KEY`, and `CORS_ALLOW_ORIGINS`.
   For a free 512 MB service, keep `USE_RERANKER=false` and use
   `EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2`.
3. Set `API_KEY` only when requests are protected by a proper auth layer; do not publish
   a long-lived administrator key in a public client.
4. Use persistent storage for Chroma. Ephemeral free instances lose the index on restart.
5. Copy the backend HTTPS URL into the Pages UI and verify `/api/health`.

## Evaluation

`backend/eval/run_eval.py` runs a set of Q/A pairs against a running instance and
reports a retrieval-hit-rate metric (whether expected sources were cited). Extend
`backend/eval/dataset.json` with your own documents' Q/A pairs, and consider wiring
in [RAGAS](https://github.com/explodinggradients/ragas) for faithfulness/answer-relevance
scoring once you have a golden dataset.

```bash
python -m eval.run_eval --api-base http://localhost:7860 --dataset eval/dataset.json
```

## Security notes

- No secrets are committed. Copy `backend/.env.example` to `backend/.env` (gitignored)
  and fill in your own keys.
- `API_KEY` (optional) gates `/api/ingest`, `/api/query`, `/api/documents`, and `/api/reset`
  via the `X-API-Key` header. Treat it as a server-side integration secret; the UI only
  holds a manually entered key in memory and never persists it.
- Rate limiting (`RATE_LIMIT_PER_MINUTE`) is enabled by default via `slowapi`.
- Uploads are limited by `MAX_UPLOAD_MB` and filenames are normalized before temporary
  storage.

## Roadmap / possible extensions

- Agentic query routing (retrieve vs. direct-answer vs. multi-hop)
- GraphRAG for cross-referenced document sets
- Multi-collection workspaces (per-user or per-project document sets)
- Semantic caching to cut repeated LLM calls
- Full RAGAS faithfulness/answer-relevance scoring in CI

## License

MIT — see [LICENSE](./LICENSE).
