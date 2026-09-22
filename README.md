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
        ├── Embeddings: sentence-transformers (BAAI/bge-small-en-v1.5, CPU-friendly)
        ├── Vector store: Chroma (persistent, local disk)
        ├── Hybrid retrieval: dense (Chroma) + sparse (BM25) fused via
        │                     Reciprocal Rank Fusion (RRF)
        ├── Re-ranking: cross-encoder (BAAI/bge-reranker-base)
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
│   └── style.css
└── .github/workflows/
    ├── backend-ci.yml        # lint + pytest on backend changes
    └── deploy-pages.yml      # auto-deploy frontend/ to GitHub Pages
```

## Getting started (local)

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env          # then fill in GROQ_API_KEY or GEMINI_API_KEY
uvicorn app.main:app --reload --port 7860
```

Get a **free** API key from one of:
- Groq: https://console.groq.com/keys (fast, free tier, Llama 3.3 70B)
- Gemini: https://aistudio.google.com/apikey (free tier, Gemini 2.0 Flash)

### 2. Frontend

No build step required. Either:
- Open `frontend/index.html` directly in a browser, or
- Serve it locally: `python -m http.server 5500 --directory frontend`


### 3. Try it
1. Upload a PDF/DOCX/MD/TXT file via "Upload & Index".
2. Ask a question in the chat box — the answer streams in with numbered
   citations `[1]`, `[2]` linking back to source + page.
3. Ask something unrelated to the document — you should see the explicit
   "I don't have enough relevant information..." fallback instead of a
   hallucinated answer.

## Deploying for free

**Backend** (pick one):
- **Hugging Face Spaces** (Docker SDK, free CPU tier) — push `backend/` with its
  `Dockerfile`, set `GROQ_API_KEY`/`GEMINI_API_KEY` and `API_KEY` as Space secrets.
- **Render** free web service — point at `backend/`, build command
  `pip install -r requirements.txt`, start command
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

**Frontend**:
- GitHub Pages, via the included `.github/workflows/deploy-pages.yml` (auto-deploys
  `frontend/` on push to `main`). After deploying, update the **Backend API base URL**
  field in the UI (persisted in `localStorage`) to point at your deployed backend URL,
  and set `CORS_ALLOW_ORIGINS` on the backend to your Pages URL
  (e.g. `https://charan-hari.github.io`).

## Evaluation

`backend/eval/run_eval.py` runs a set of Q/A pairs against a running instance and
reports a retrieval-hit-rate metric (whether expected sources were cited). Extend
`backend/eval/dataset.json` with your own documents' Q/A pairs, and consider wiring
in [RAGAS](https://github.com/explodinggradients/ragas) for faithfulness/answer-relevance
scoring once you have a golden dataset.

## Security notes

- No secrets are committed. Copy `backend/.env.example` to `backend/.env` (gitignored)
  and fill in your own keys.
- `API_KEY` (optional) gates `/api/ingest`, `/api/query`, and `/api/reset` via the
  `X-API-Key` header — set it before deploying publicly to prevent abuse of your
  free-tier LLM quota.
- Rate limiting (`RATE_LIMIT_PER_MINUTE`) is enabled by default via `slowapi`.

## Roadmap / possible extensions

- Agentic query routing (retrieve vs. direct-answer vs. multi-hop)
- GraphRAG for cross-referenced document sets
- Multi-collection workspaces (per-user or per-project document sets)
- Semantic caching to cut repeated LLM calls
- Full RAGAS faithfulness/answer-relevance scoring in CI


MIT — see [LICENSE](./LICENSE).
