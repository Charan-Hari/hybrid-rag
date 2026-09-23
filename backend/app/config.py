"""Application configuration.

All secrets/config are loaded from environment variables (see .env.example).
Never hardcode API keys or credentials here.
"""
from __future__ import annotations

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- App ---
    app_name: str = "hybrid-rag"
    environment: str = "development"
    cors_allow_origins: str = "*"  # comma-separated list in production, e.g. https://you.github.io

    # --- Security ---
    api_key: str | None = None  # if set, required via `X-API-Key` header on protected routes
    rate_limit_per_minute: int = 30

    # --- Storage ---
    chroma_persist_dir: str = "./data/chroma"
    upload_dir: str = "./data/uploads"
    collection_name: str = "documents"
    max_upload_mb: int = 20

    # --- Embeddings ---
    # The default embedder is a small stdlib feature hash, so free containers
    # do not need to load PyTorch or a transformer model.
    embedding_dimension: int = 384

    # --- Chunking ---
    chunk_size: int = 800
    chunk_overlap: int = 120

    # --- Retrieval ---
    top_k_dense: int = 8
    top_k_sparse: int = 8
    top_k_final: int = 5
    # The default lightweight lexical reranker does not load another model.
    use_reranker: bool = False
    min_relevance_score: float = 0.15  # below this, trigger "insufficient context" fallback

    # --- LLM provider ---
    # Gemini is the supported hosted provider for this deployment.
    llm_provider: str = "gemini"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.6-flash"
    llm_temperature: float = 0.2
    llm_max_tokens: int = 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
