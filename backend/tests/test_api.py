from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "documents_indexed" in body


def test_ingest_rejects_unsupported_extension(tmp_path):
    file_path = tmp_path / "bad.xyz"
    file_path.write_text("data")

    with file_path.open("rb") as f:
        response = client.post(
            "/api/ingest",
            files={"file": ("bad.xyz", f, "application/octet-stream")},
        )
    assert response.status_code == 400


def test_documents_endpoint_returns_inventory():
    response = client.get("/api/documents")
    assert response.status_code == 200
    assert isinstance(response.json(), list)
