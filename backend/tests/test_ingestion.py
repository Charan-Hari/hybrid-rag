from pathlib import Path

from app.ingestion import clean_text, ingest_file, recursive_split


def test_recursive_split_respects_chunk_size():
    text = "Sentence one. " * 200
    chunks = recursive_split(text, chunk_size=200, chunk_overlap=20)
    assert len(chunks) > 1
    assert all(len(c) <= 260 for c in chunks)  # allow small overlap slack


def test_recursive_split_short_text_single_chunk():
    text = "Short text."
    chunks = recursive_split(text, chunk_size=800, chunk_overlap=120)
    assert chunks == ["Short text."]


def test_clean_text_normalizes_whitespace():
    dirty = "Hello\r\n\r\n\r\nworld   foo"
    cleaned = clean_text(dirty)
    assert "\r" not in cleaned
    assert "   " not in cleaned
    assert "\n\n\n" not in cleaned


def test_ingest_file_txt(tmp_path: Path):
    file_path = tmp_path / "sample.txt"
    file_path.write_text("This is a test document. " * 100, encoding="utf-8")

    chunks = ingest_file(file_path, chunk_size=200, chunk_overlap=20)

    assert len(chunks) > 1
    assert all(c.source == "sample.txt" for c in chunks)
    assert all(c.metadata["source"] == "sample.txt" for c in chunks)


def test_ingest_file_unsupported_extension(tmp_path: Path):
    file_path = tmp_path / "sample.xyz"
    file_path.write_text("data", encoding="utf-8")

    try:
        ingest_file(file_path)
        assert False, "expected ValueError"
    except ValueError:
        pass
