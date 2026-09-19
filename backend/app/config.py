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

    # --- Embeddings ---
    embedding_model: str = "BAAI/bge-small-en-v1.5"

    # --- Chunking ---
    chunk_size: int = 800
    chunk_overlap: int = 120

    # --- Retrieval ---
    top_k_dense: int = 8
    top_k_sparse: int = 8
    top_k_final: int = 5
    use_reranker: bool = True
    reranker_model: str = "BAAI/bge-reranker-base"
    min_relevance_score: float = 0.15  # below this, trigger "insufficient context" fallback

    # --- LLM provider ---
    # one of: "groq", "gemini"
    llm_provider: str = "groq"
    groq_api_key: str | None = None
    groq_model: str = "llama-3.3-70b-versatile"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.0-flash"
    llm_temperature: float = 0.2
    llm_max_tokens: int = 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
