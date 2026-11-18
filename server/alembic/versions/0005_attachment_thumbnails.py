"""attachment thumbnails

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Prévia de imagem 480 px gerada no upload (plano-frontend §8.6).
    # Os grants de tabela de 0004 já cobrem a coluna nova.
    op.execute("ALTER TABLE attachments ADD COLUMN thumbnail_path text")


def downgrade() -> None:
    op.execute("ALTER TABLE attachments DROP COLUMN IF EXISTS thumbnail_path")
