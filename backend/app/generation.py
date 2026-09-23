"""LLM generation layer: provider-agnostic streaming chat with citation-aware
prompting and a confidence-gated "insufficient context" fallback.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator

from app.config import get_settings
from app.retrieval import RetrievedPassage

SYSTEM_PROMPT = (
    "You are a careful research assistant. Answer the user's question using ONLY the "
    "provided context passages. Every factual claim must be traceable to a passage. "
    "When you use information from a passage, cite it inline like [1], [2] referring to "
    "the passage numbers given. If the context does not contain enough information to "
    "answer confidently, say so explicitly instead of guessing."
)


def build_prompt(query: str, passages: list[RetrievedPassage], history: list[dict] | None = None) -> list[dict]:
    context_block = "\n\n".join(
        f"[{i + 1}] (source: {p.metadata.get('source', 'unknown')}, "
        f"page: {p.metadata.get('page', 'n/a')})\n{p.text}"
        for i, p in enumerate(passages)
    )

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in history or []:
        messages.append(turn)

    user_content = (
        f"Context passages:\n{context_block}\n\n"
        f"Question: {query}\n\n"
        "Answer using the context above, citing passage numbers like [1]."
    )
    messages.append({"role": "user", "content": user_content})
    return messages


def has_sufficient_context(passages: list[RetrievedPassage]) -> bool:
    settings = get_settings()
    if not passages:
        return False
    return max(p.score for p in passages) >= settings.min_relevance_score


INSUFFICIENT_CONTEXT_MESSAGE = (
    "I don't have enough relevant information in the ingested documents to answer that "
    "confidently. Try rephrasing your question or uploading a document that covers this topic."
)


async def stream_answer(
    query: str,
    passages: list[RetrievedPassage],
    history: list[dict] | None = None,
) -> AsyncGenerator[str, None]:
    """Yield answer text chunks. Falls back to a fixed message when retrieval
    confidence is too low, without calling the LLM at all (saves cost/latency).
    """
    if not has_sufficient_context(passages):
        yield INSUFFICIENT_CONTEXT_MESSAGE
        return

    messages = build_prompt(query, passages, history)
    settings = get_settings()

    if settings.llm_provider == "gemini":
        async for token in _stream_gemini(messages):
            yield token
    else:
        raise ValueError(f"Unknown llm_provider: {settings.llm_provider}")


async def _stream_gemini(messages: list[dict]) -> AsyncGenerator[str, None]:
    import google.generativeai as genai

    settings = get_settings()
    if not settings.gemini_api_key:
        yield "[Configuration error: GEMINI_API_KEY is not set on the server. Add it in Render Environment settings.]"
        return

    genai.configure(api_key=settings.gemini_api_key)
    system_msg = next((m["content"] for m in messages if m["role"] == "system"), "")
    user_msg = next((m["content"] for m in messages if m["role"] == "user"), "")

    model = genai.GenerativeModel(settings.gemini_model, system_instruction=system_msg)
    response = model.generate_content(
        user_msg,
        generation_config={
            "temperature": settings.llm_temperature,
            "max_output_tokens": settings.llm_max_tokens,
        },
        stream=True,
    )
    for chunk in response:
        if chunk.text:
            yield chunk.text
