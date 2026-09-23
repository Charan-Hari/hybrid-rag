# Hybrid RAG

Upload a document, ask a question, and inspect a streamed answer with the
supporting source passages.

![Hybrid RAG walkthrough](docs/demo.gif)

## Included

- PDF, DOCX, Markdown, and TXT upload
- Five bundled samples in [`frontend/samples/`](frontend/samples/)
- File insight card with format, content, and suggested question
- DOCX table extraction and PDF page metadata
- Hybrid retrieval: lightweight feature hashing + BM25
- Gemini streaming with source/page citations
- New-chat reset and document-scoped questions
- Static frontend for GitHub Pages and FastAPI backend for Render

## Run locally

Backend:

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 7860
```

Set `GEMINI_API_KEY` in `backend/.env`. The default model is
`gemini-3.6-flash`.

Frontend:

```bash
python -m http.server 5500 --directory frontend
```

Open `http://localhost:5500`.

## Deploy

### Render backend

Use `backend/` as the Docker service root and `/api/health` as the health
check. Add these Render environment variables:

```text
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_actual_key
GEMINI_MODEL=gemini-3.6-flash
CORS_ALLOW_ORIGINS=https://charan-hari.github.io
MAX_UPLOAD_MB=20
RATE_LIMIT_PER_MINUTE=30
```

Keep the Gemini key only in Render. Never commit it or place it in frontend
files.

### GitHub Pages frontend

The included workflow deploys `frontend/`. Its backend URL is configured in
[`frontend/index.html`](frontend/index.html).

## API

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Service status and indexed section count |
| GET | `/api/documents` | Indexed document inventory |
| POST | `/api/ingest` | Index a supported file |
| POST | `/api/query` | Stream citations and answer tokens |
| DELETE | `/api/documents/{source}` | Remove one document |
| DELETE | `/api/reset` | Clear the index |

## Project structure

```text
backend/app/       FastAPI, ingestion, retrieval, generation
backend/tests/     Backend tests
frontend/          Static UI and bundled samples
docs/demo.gif      Short product walkthrough
```

## License

MIT
