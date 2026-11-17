"""users, sessions and audit_log

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE users (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            username      citext NOT NULL UNIQUE,
            display_name  varchar(80) NOT NULL,
            password_hash text NOT NULL,
            role          varchar(10) NOT NULL DEFAULT 'member'
                          CHECK (role IN ('admin','member')),
            sector_id     uuid REFERENCES sectors(id),
            is_active     boolean NOT NULL DEFAULT true,
            created_at    timestamptz NOT NULL DEFAULT now(),
            updated_at    timestamptz NOT NULL DEFAULT now(),
            last_seen_at  timestamptz
        )
        """
    )
    op.execute(
        """
        CREATE TABLE sessions (
            id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id            uuid NOT NULL REFERENCES users(id),
            refresh_token_hash varchar(64) NOT NULL UNIQUE,
            device_name        varchar(120),
            ip                 inet,
            user_agent         text,
            created_at         timestamptz NOT NULL DEFAULT now(),
            last_used_at       timestamptz NOT NULL DEFAULT now(),
            revoked_at         timestamptz
        )
        """
    )
    op.execute("CREATE INDEX sessions_user_idx ON sessions (user_id)")

    op.execute(
        """
        CREATE TABLE audit_log (
            id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            actor_id    uuid REFERENCES users(id),
            action      varchar(80) NOT NULL,
            entity_type varchar(40) NOT NULL,
            entity_id   varchar(80),
            metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
            ip          inet,
            created_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX audit_log_actor_time_idx ON audit_log (actor_id, created_at DESC)")

    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON users TO microzup_app")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO microzup_app")
    op.execute("GRANT SELECT, INSERT ON audit_log TO microzup_app")
    # Append-only garantido pelo banco: runtime não altera nem remove auditoria.
    op.execute("REVOKE UPDATE, DELETE ON audit_log FROM microzup_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS audit_log")
    op.execute("DROP TABLE IF EXISTS sessions")
    op.execute("DROP TABLE IF EXISTS users")
