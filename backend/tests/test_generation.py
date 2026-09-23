from app.generation import has_sufficient_context, build_prompt
from app.retrieval import RetrievedPassage


def _passage(score: float, text: str = "some text", source: str = "doc.pdf", page: int = 1):
    return RetrievedPassage(
        id="id1", text=text, metadata={"source": source, "page": page}, score=score
    )


def test_has_sufficient_context_true_above_threshold():
    passages = [_passage(0.5)]
    assert has_sufficient_context(passages) is True


def test_has_sufficient_context_false_below_threshold():
    passages = [_passage(0.01)]
    assert has_sufficient_context(passages) is False


def test_has_sufficient_context_false_when_empty():
    assert has_sufficient_context([]) is False


def test_build_prompt_includes_citations_and_query():
    passages = [_passage(0.9, text="Vitamins are essential nutrients.")]
    messages = build_prompt("What are vitamins?", passages)

    assert messages[0]["role"] == "system"
    user_msg = messages[-1]["content"]
    assert "What are vitamins?" in user_msg
    assert "[1]" in user_msg
    assert "Vitamins are essential nutrients." in user_msg
