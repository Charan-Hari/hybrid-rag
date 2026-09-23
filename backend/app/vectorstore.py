"""Embedding model wrapper + Chroma-backed persistent vector store."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.config import get_settings
from app.ingestion import Chunk


@lru_cache
def get_embedder():
    """Lazily load the sentence-transformers embedding model (cached singleton)."""
    from sentence_transformers import SentenceTransformer

    settings = get_settings()
    return SentenceTransformer(settings.embedding_model)


def embed_texts(texts: list[str]) -> list[list[float]]:
    model = get_embedder()
    return model.encode(texts, normalize_embeddings=True, show_progress_bar=False).tolist()


class VectorStore:
    """Thin wrapper around a persistent Chroma collection."""

    def __init__(self, persist_dir: str | None = None, collection_name: str | None = None):
        settings = get_settings()
        self._persist_dir = persist_dir or settings.chroma_persist_dir
        self._collection_name = collection_name or settings.collection_name
        Path(self._persist_dir).mkdir(parents=True, exist_ok=True)

        self._client = chromadb.PersistentClient(
            path=self._persist_dir,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        self._collection = self._client.get_or_create_collection(
            name=self._collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    def add_chunks(self, chunks: list[Chunk]) -> int:
        if not chunks:
            return 0
        embeddings = embed_texts([c.text for c in chunks])
        self._collection.add(
            ids=[c.id for c in chunks],
            documents=[c.text for c in chunks],
            embeddings=embeddings,
            metadatas=[c.metadata for c in chunks],
        )
        return len(chunks)

    def query_dense(self, query: str, top_k: int) -> list[dict]:
        """Dense similarity search. Returns list of {id, text, metadata, score}."""
        if self._collection.count() == 0:
            return []
        query_emb = embed_texts([query])[0]
        result = self._collection.query(
            query_embeddings=[query_emb],
            n_results=min(top_k, self._collection.count()),
        )
        out = []
        ids = result.get("ids", [[]])[0]
        docs = result.get("documents", [[]])[0]
        metas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]
        for id_, doc, meta, dist in zip(ids, docs, metas, distances):
            # cosine distance -> similarity score
            score = 1.0 - dist
            out.append({"id": id_, "text": doc, "metadata": meta, "score": score})
        return out

    def all_documents(self) -> list[dict]:
        """Return all stored documents (for building the BM25 sparse index)."""
        if self._collection.count() == 0:
            return []
        result = self._collection.get(include=["documents", "metadatas"])
        out = []
        for id_, doc, meta in zip(result["ids"], result["documents"], result["metadatas"]):
            out.append({"id": id_, "text": doc, "metadata": meta})
        return out

    def count(self) -> int:
        return self._collection.count()

    def documents(self) -> list[dict]:
        """Return a compact document inventory grouped by source filename."""
        documents = self.all_documents()
        grouped: dict[str, dict] = {}
        for item in documents:
            source = str(item["metadata"].get("source") or "unknown")
            entry = grouped.setdefault(
                source,
                {"source": source, "chunks": 0, "pages": set()},
            )
            entry["chunks"] += 1
            page = item["metadata"].get("page")
            if page:
                entry["pages"].add(page)

        return [
            {
                "source": item["source"],
                "chunks": item["chunks"],
                "pages": sorted(item["pages"]),
            }
            for item in sorted(grouped.values(), key=lambda value: value["source"].lower())
        ]

    def delete_source(self, source: str) -> int:
        """Delete all chunks belonging to a source filename."""
        matches = self._collection.get(where={"source": source}, include=["metadatas"])
        ids = matches.get("ids", [])
        if ids:
            self._collection.delete(ids=ids)
        return len(ids)

    def reset(self) -> None:
        self._client.delete_collection(self._collection_name)
        self._collection = self._client.get_or_create_collection(
            name=self._collection_name,
            metadata={"hnsw:space": "cosine"},
        )


@lru_cache
def get_vector_store() -> VectorStore:
    return VectorStore()
