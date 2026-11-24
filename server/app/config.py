import sys
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-insecure-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["development", "test", "production"] = "development"
    host: str = "0.0.0.0"
    port: int = 8666
    log_level: str = "INFO"

    database_url: str = (
        "postgresql+psycopg://microzup_app:microzup_dev_app@localhost:55432/microzup"
    )
    migration_database_url: str | None = None

    jwt_secret: str = DEV_JWT_SECRET
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    ws_ticket_ttl_seconds: int = 30
    login_max_attempts: int = 5
    login_lockout_seconds: int = 300

    # Rate limit em memória (plano §8: login, upload e envio de mensagem).
    rate_limit_login_per_minute: int = 10
    rate_limit_upload_per_minute: int = 20
    rate_limit_message_per_minute: int = 30

    # O SPA é servido pela própria API (mesma origem): CORS fica vazio por
    # padrão. Só preencha para um front externo (dev fora do proxy do Vite).
    cors_origins: str = ""

    # Pasta do build do SPA (web/dist). Relativa à raiz do repositório.
    web_dist_dir: Path = Path("web/dist")

    # Cookie do refresh token: HttpOnly + SameSite=Strict. `Secure` exige TLS;
    # fica desligado por padrão porque o piloto roda em HTTP na LAN.
    cookie_secure: bool = False

    storage_dir: Path = Path("./data")
    max_upload_mb: int = 100
    max_attachments_per_message: int = 5
    orphan_attachment_ttl_hours: int = 24
    message_max_chars: int = 8000

    # Timeouts por conexão no engine (plano §8).
    statement_timeout_ms: int = 15000
    idle_in_transaction_session_timeout_ms: int = 30000

    # Logs estruturados com rotação diária (plano §8).
    log_dir: Path = Path("./data/logs")
    log_retention_days: int = 14

    message_retention_days: int = 0
    file_retention_days: int = 0
    # Intervalo da task de retenção no lifespan (plano §8); 0 desliga a task
    # (a CLI `retention-run` continua disponível para operação explícita).
    retention_interval_seconds: int = 3600

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def web_dist_path(self) -> Path:
        """Resolve `WEB_DIST_DIR`: absoluto, ao lado do exe (PyInstaller) ou na raiz do repo."""
        if self.web_dist_dir.is_absolute():
            return self.web_dist_dir
        base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
        return base / self.web_dist_dir

    @model_validator(mode="after")
    def _guard_production_secret(self) -> "Settings":
        if self.app_env == "production" and self.jwt_secret == DEV_JWT_SECRET:
            raise ValueError("JWT_SECRET precisa ser definido em produção (>= 32 bytes).")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
