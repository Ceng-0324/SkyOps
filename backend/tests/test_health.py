from fastapi.testclient import TestClient

from app.main import app


def test_health_check_returns_backend_status() -> None:
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "skyops-agent",
        "mode": "mock",
    }
