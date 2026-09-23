"""Document ingestion: loaders for PDF/DOCX/Markdown/TXT + recursive chunking."""
from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Chunk:
    """A single chunk of text ready for embedding, with traceable metadata."""

    id: str
    text: str
    source: str
    page: int | None
    chunk_index: int
    metadata: dict = field(default_factory=dict)


def load_text_from_file(path: Path) -> list[tuple[str, int | None]]:
    """Load raw text from a supported file, returning (text, page_number) pairs.

    page_number is None for formats without a native page concept (md/txt/docx).
    """
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        return _load_pdf(path)
    if suffix == ".docx":
        return [(_load_docx(path), None)]
    if suffix in (".md", ".markdown", ".txt"):
        return [(path.read_text(encoding="utf-8", errors="ignore"), None)]

    raise ValueError(f"Unsupported file type: {suffix}")


def _load_pdf(path: Path) -> list[tuple[str, int | None]]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    pages: list[tuple[str, int | None]] = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        if text.strip():
            pages.append((text, i))
    return pages


def _load_docx(path: Path) -> str:
    from docx import Document

    doc = Document(str(path))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def clean_text(text: str) -> str:
    """Normalize whitespace and strip control characters."""
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def recursive_split(
    text: str,
    chunk_size: int = 800,
    chunk_overlap: int = 120,
    separators: list[str] | None = None,
) -> list[str]:
    """Recursively split text on a hierarchy of separators, falling back to
    hard character splits, while keeping chunks near `chunk_size` with overlap.

    This is a lightweight re-implementation of LangChain's
    RecursiveCharacterTextSplitter idea, with no external dependency.
    """
    separators = separators or ["\n\n", "\n", ". ", " ", ""]

    def split_on(sep: str, s: str) -> list[str]:
        return s.split(sep) if sep else list(s)

    def _split(s: str, seps: list[str]) -> list[str]:
        if len(s) <= chunk_size:
            return [s] if s.strip() else []
        if not seps:
            # hard split
            return [s[i : i + chunk_size] for i in range(0, len(s), chunk_size)]

        sep, rest = seps[0], seps[1:]
        parts = split_on(sep, s)
        chunks: list[str] = []
        buf = ""
        for part in parts:
            candidate = (buf + sep + part) if buf else part
            if len(candidate) <= chunk_size:
                buf = candidate
            else:
                if buf:
                    chunks.append(buf)
                if len(part) > chunk_size:
                    chunks.extend(_split(part, rest))
                    buf = ""
                else:
                    buf = part
        if buf:
            chunks.append(buf)
        return chunks

    raw_chunks = [c.strip() for c in _split(text, separators) if c.strip()]

    if chunk_overlap <= 0 or len(raw_chunks) <= 1:
        return raw_chunks

    # Add overlap by pulling trailing characters from the previous chunk.
    overlapped: list[str] = []
    for i, chunk in enumerate(raw_chunks):
        if i == 0:
            overlapped.append(chunk)
            continue
        prev_tail = raw_chunks[i - 1][-chunk_overlap:]
        overlapped.append((prev_tail + " " + chunk).strip())
    return overlapped


def ingest_file(
    path: Path,
    chunk_size: int = 800,
    chunk_overlap: int = 120,
) -> list[Chunk]:
    """Load a file, clean and chunk it, returning Chunk objects with source metadata."""
    pages = load_text_from_file(path)
    chunks: list[Chunk] = []
    global_index = 0

    for text, page_num in pages:
        text = clean_text(text)
        if not text:
            continue
        for piece in recursive_split(text, chunk_size, chunk_overlap):
            chunks.append(
                Chunk(
                    id=str(uuid.uuid4()),
                    text=piece,
                    source=path.name,
                    page=page_num,
                    chunk_index=global_index,
                    metadata={"source": path.name, "page": page_num or 0},
                )
            )
            global_index += 1

    return chunks
