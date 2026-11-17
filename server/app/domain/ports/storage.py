from pathlib import Path
from typing import Protocol


class FileStorage(Protocol):
    """Resolve caminhos relativos dentro da raiz de armazenamento e remove arquivos."""

    def resolve(self, storage_path: str) -> Path: ...

    def delete(self, storage_path: str) -> None: ...
