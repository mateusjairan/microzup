"""initial schema: sectors

Revision ID: 0001
Revises:
Create Date: 2026-11-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.execute(
        """
        CREATE TABLE sectors (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            name        varchar(60) NOT NULL UNIQUE,
            slug        varchar(80) NOT NULL UNIQUE,
            description varchar(240),
            created_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )

    # O runtime conecta como microzup_app; sem estes grants ele não lê nem escreve.
    op.execute("GRANT USAGE ON SCHEMA public TO microzup_app")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON sectors TO microzup_app")
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE microzup_owner IN SCHEMA public "
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO microzup_app"
    )
    op.execute(
        "ALTER DEFAULT PRIVILEGES FOR ROLE microzup_owner IN SCHEMA public "
        "GRANT USAGE, SELECT ON SEQUENCES TO microzup_app"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS sectors")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
    op.execute("DROP EXTENSION IF EXISTS unaccent")
    op.execute("DROP EXTENSION IF EXISTS citext")
