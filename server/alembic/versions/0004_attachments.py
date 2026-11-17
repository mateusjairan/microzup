"""attachments

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-17
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE attachments (
            id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            message_id   uuid REFERENCES messages(id),
            uploader_id  uuid NOT NULL REFERENCES users(id),
            filename     varchar(255) NOT NULL,
            mime_type    varchar(120) NOT NULL,
            size_bytes   bigint NOT NULL,
            sha256       varchar(64) NOT NULL UNIQUE,
            storage_path text NOT NULL,
            created_at   timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX ix_attachments_message ON attachments (message_id)")
    op.execute(
        "CREATE INDEX ix_attachments_orphan ON attachments (created_at) WHERE message_id IS NULL"
    )
    op.execute(
        "CREATE INDEX ix_attachments_filename_trgm ON attachments USING gin (filename gin_trgm_ops)"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON attachments TO microzup_app")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS attachments")
