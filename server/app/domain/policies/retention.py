"""Retenção opcional de mensagens e arquivos (plano §8).

`MESSAGE_RETENTION_DAYS` e `FILE_RETENTION_DAYS` desligados por padrão (0).
A política devolve o corte temporal (`cutoff`) a partir de um instante
injetado — nunca lê relógio sozinha nem toca persistência.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True, slots=True)
class RetentionPolicy:
    message_retention_days: int = 0
    file_retention_days: int = 0

    def message_cutoff(self, now: datetime) -> datetime | None:
        return _cutoff(self.message_retention_days, now)

    def file_cutoff(self, now: datetime) -> datetime | None:
        return _cutoff(self.file_retention_days, now)

    @property
    def enabled(self) -> bool:
        return self.message_retention_days > 0 or self.file_retention_days > 0


def _cutoff(days: int, now: datetime) -> datetime | None:
    if days <= 0:
        return None
    return now - timedelta(days=days)
