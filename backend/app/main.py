"""FastAPI application: document upload, hybrid-RAG streaming query, and health checks."""
from __future__ import annotations

import json
import tempfile
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import get_settings
from app.generation import stream_answer
from app.ingestion import ingest_file
from app.retrieval import get_retriever
from app.vectorstore import get_vector_store

settings = get_settings()
allowed_origins = [o.strip() for o in settings.cors_allow_origins.split(",") if o.strip()]
allow_credentials = "*" not in allowed_origins

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="hybrid-rag", version="0.1.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins or ["*"],
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".md", ".markdown", ".txt"}


def require_api_key(request: Request) -> None:
    """Optional API key gate. No-op if API_KEY is not configured server-side."""
    if not settings.api_key:
        return
    provided = request.headers.get("X-API-Key")
    if provided != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


class QueryRequest(BaseModel):
    query: str
    history: list[dict] | None = None
    source: str | None = None


class IngestResponse(BaseModel):
    filename: str
    chunks_added: int


class HealthResponse(BaseModel):
    status: str
    documents_indexed: int


class DocumentResponse(BaseModel):
    source: str
    chunks: int
    pages: list[int]


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    store = get_vector_store()
    return HealthResponse(status="ok", documents_indexed=store.count())


@app.get(
    "/api/documents",
    response_model=list[DocumentResponse],
    dependencies=[Depends(require_api_key)],
)
def documents() -> list[DocumentResponse]:
    return [DocumentResponse(**document) for document in get_vector_store().documents()]


@app.post("/api/ingest", response_model=IngestResponse, dependencies=[Depends(require_api_key)])
@limiter.limit(f"{settings.rate_limit_per_minute}/minute")
async def ingest(request: Request, file: UploadFile = File(...)) -> IngestResponse:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Supported: {sorted(SUPPORTED_EXTENSIONS)}",
        )

    max_bytes = settings.max_upload_mb * 1024 * 1024
    safe_name = Path(file.filename or "upload").name
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir) / f"{uuid.uuid4().hex}-{safe_name}"
        with tmp_path.open("wb") as f:
            total = 0
            while chunk := file.file.read(1024 * 1024):
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File exceeds the {settings.max_upload_mb} MB upload limit",
                    )
                f.write(chunk)

        chunks = ingest_file(tmp_path, settings.chunk_size, settings.chunk_overlap)
        for chunk in chunks:
            chunk.source = file.filename or "upload"
            chunk.metadata["source"] = chunk.source
        store = get_vector_store()
        added = store.add_chunks(chunks)
        get_retriever(store).invalidate()

    return IngestResponse(filename=file.filename or "upload", chunks_added=added)


@app.delete(
    "/api/documents/{source}",
    dependencies=[Depends(require_api_key)],
)
async def delete_document(request: Request, source: str) -> dict:
    deleted = get_vector_store().delete_source(source)
    get_retriever(get_vector_store()).invalidate()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"source": source, "chunks_deleted": deleted}


@app.post("/api/query", dependencies=[Depends(require_api_key)])
@limiter.limit(f"{settings.rate_limit_per_minute}/minute")
async def query(request: Request, body: QueryRequest) -> StreamingResponse:
    store = get_vector_store()
    retriever = get_retriever(store)
    passages = retriever.retrieve(body.query, body.source)

    async def event_stream():
        citations = [
            {
                "index": i + 1,
                "source": p.metadata.get("source"),
                "page": p.metadata.get("page"),
                "score": round(p.score, 4),
                "excerpt": p.text[:300],
            }
            for i, p in enumerate(passages)
        ]
        yield f"event: citations\ndata: {json.dumps(citations)}\n\n"

        async for token in stream_answer(body.query, passages, body.history):
            yield f"event: token\ndata: {json.dumps({'text': token})}\n\n"

        yield "event: done\ndata: {}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.delete("/api/reset", dependencies=[Depends(require_api_key)])
async def reset(request: Request) -> dict:
    store = get_vector_store()
    store.reset()
    get_retriever(store).invalidate()
    return {"status": "reset"}
