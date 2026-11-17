from app.main import create_app
from httpx import ASGITransport, AsyncClient


async def test_health_reports_ok_without_touching_database() -> None:
    app = create_app()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}
