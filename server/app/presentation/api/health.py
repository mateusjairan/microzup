from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import __version__
from app.presentation.deps import SessionDep

router = APIRouter(tags=["health"])


class HealthOut(BaseModel):
    status: str
    version: str


@router.get("/health", response_model=HealthOut)
async def health() -> HealthOut:
    return HealthOut(status="ok", version=__version__)


@router.get("/health/db", response_model=HealthOut)
async def health_db(session: SessionDep) -> HealthOut:
    try:
        await session.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="database unavailable",
        ) from exc
    return HealthOut(status="ok", version=__version__)
