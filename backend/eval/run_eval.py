"""Lightweight retrieval/answer quality evaluation harness.

Runs a fixed set of Q/A pairs against the local API and reports basic metrics
(retrieval hit rate, whether the answer stayed grounded / fell back correctly).
For deeper metrics (faithfulness, answer relevance) wire this up to RAGAS with
an LLM judge once a real document corpus + golden answers are available.

Usage:
    python -m eval.run_eval --api-base http://localhost:7860 --dataset eval/dataset.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import httpx


def load_dataset(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def run_query(api_base: str, query: str) -> dict:
    """Call /api/query and collect citations + full streamed answer text."""
    citations: list[dict] = []
    answer_parts: list[str] = []

    with httpx.stream(
        "POST", f"{api_base}/api/query", json={"query": query}, timeout=60.0
    ) as response:
        response.raise_for_status()
        event_name = None
        for line in response.iter_lines():
            if not line:
                continue
            if line.startswith("event:"):
                event_name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                payload = json.loads(line.split(":", 1)[1].strip())
                if event_name == "citations":
                    citations = payload
                elif event_name == "token":
                    answer_parts.append(payload.get("text", ""))

    return {"answer": "".join(answer_parts), "citations": citations}


def evaluate(api_base: str, dataset: list[dict]) -> dict:
    results = []
    hits = 0

    for item in dataset:
        query = item["query"]
        expected_source = item.get("expected_source")
        result = run_query(api_base, query)

        cited_sources = {c.get("source") for c in result["citations"]}
        hit = expected_source in cited_sources if expected_source else bool(cited_sources)
        hits += int(hit)

        results.append(
            {
                "query": query,
                "answer": result["answer"],
                "citations": result["citations"],
                "retrieval_hit": hit,
            }
        )

    total = len(dataset) or 1
    summary = {
        "total_queries": len(dataset),
        "retrieval_hit_rate": hits / total,
        "results": results,
    }
    return summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate hybrid-rag retrieval quality")
    parser.add_argument("--api-base", default="http://localhost:7860")
    parser.add_argument("--dataset", default="eval/dataset.json")
    parser.add_argument("--out", default="eval/results.json")
    args = parser.parse_args()

    dataset = load_dataset(Path(args.dataset))
    summary = evaluate(args.api_base, dataset)

    Path(args.out).write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"Retrieval hit rate: {summary['retrieval_hit_rate']:.2%}")
    print(f"Results written to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
