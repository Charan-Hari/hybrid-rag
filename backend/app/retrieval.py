"""Hybrid retrieval: dense (Chroma) + sparse (BM25) fusion, plus optional
cross-encoder re-ranking of the fused candidates.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from rank_bm25 import BM25Okapi

from app.config import get_settings
from app.vectorstore import VectorStore


@dataclass
class RetrievedPassage:
    id: str
    text: str
    metadata: dict
    score: float


def _tokenize(text: str) -> list[str]:
    return text.lower().split()


class HybridRetriever:
    """Builds a BM25 index over the current vector store contents and fuses
    it with dense retrieval results using reciprocal rank fusion (RRF).
    """

    def __init__(self, store: VectorStore):
        self._store = store
        self._bm25: BM25Okapi | None = None
        self._bm25_docs: list[dict] = []
        self._bm25_dirty = True

    def invalidate(self) -> None:
        """Call after new documents are added so the BM25 index rebuilds."""
        self._bm25_dirty = True

    def _ensure_bm25(self) -> None:
        if not self._bm25_dirty and self._bm25 is not None:
            return
        docs = self._store.all_documents()
        self._bm25_docs = docs
        if docs:
            tokenized = [_tokenize(d["text"]) for d in docs]
            self._bm25 = BM25Okapi(tokenized)
        else:
            self._bm25 = None
        self._bm25_dirty = False

    def _sparse_search(self, query: str, top_k: int) -> list[RetrievedPassage]:
        self._ensure_bm25()
        if self._bm25 is None or not self._bm25_docs:
            return []
        scores = self._bm25.get_scores(_tokenize(query))
        ranked = sorted(
            zip(self._bm25_docs, scores), key=lambda pair: pair[1], reverse=True
        )[:top_k]
        return [
            RetrievedPassage(id=d["id"], text=d["text"], metadata=d["metadata"], score=float(s))
            for d, s in ranked
            if s > 0
        ]

    def _dense_search(self, query: str, top_k: int) -> list[RetrievedPassage]:
        results = self._store.query_dense(query, top_k)
        return [
            RetrievedPassage(id=r["id"], text=r["text"], metadata=r["metadata"], score=r["score"])
            for r in results
        ]

    def retrieve(self, query: str) -> list[RetrievedPassage]:
        """Fuse dense + sparse rankings via Reciprocal Rank Fusion (RRF)."""
        settings = get_settings()
        dense = self._dense_search(query, settings.top_k_dense)
        sparse = self._sparse_search(query, settings.top_k_sparse)

        rrf_k = 60  # standard RRF smoothing constant
        fused_scores: dict[str, float] = {}
        passage_lookup: dict[str, RetrievedPassage] = {}

        for rank_list in (dense, sparse):
            for rank, passage in enumerate(rank_list):
                fused_scores[passage.id] = fused_scores.get(passage.id, 0.0) + 1.0 / (
                    rrf_k + rank + 1
                )
                passage_lookup[passage.id] = passage

        fused = sorted(
            passage_lookup.values(), key=lambda p: fused_scores[p.id], reverse=True
        )
        # attach fused score for downstream fallback thresholding
        for p in fused:
            p.score = fused_scores[p.id]

        candidate_pool = fused[: max(settings.top_k_dense, settings.top_k_sparse)]

        if settings.use_reranker and candidate_pool:
            return _rerank(query, candidate_pool)[: settings.top_k_final]

        return candidate_pool[: settings.top_k_final]


@lru_cache
def _get_cross_encoder():
    from sentence_transformers import CrossEncoder

    settings = get_settings()
    return CrossEncoder(settings.reranker_model)


def _rerank(query: str, passages: list[RetrievedPassage]) -> list[RetrievedPassage]:
    import math

    encoder = _get_cross_encoder()
    pairs = [(query, p.text) for p in passages]
    raw_scores = encoder.predict(pairs)
    for p, s in zip(passages, raw_scores):
        # normalize raw cross-encoder logit to (0, 1) via sigmoid so it can be
        # compared against `min_relevance_score` for confidence gating.
        p.score = 1.0 / (1.0 + math.exp(-float(s)))
    return sorted(passages, key=lambda p: p.score, reverse=True)


_retriever_singleton: HybridRetriever | None = None


def get_retriever(store: VectorStore) -> HybridRetriever:
    global _retriever_singleton
    if _retriever_singleton is None:
        _retriever_singleton = HybridRetriever(store)
    return _retriever_singleton
