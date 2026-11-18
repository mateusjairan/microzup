from pathlib import Path
from typing import Protocol


class FileStorage(Protocol):
    """Resolve caminhos relativos dentro da raiz de armazenamento e remove arquivos."""

    def resolve(self, storage_path: str) -> Path: ...

    def delete(self, storage_path: str) -> None: ...


class MimeSniffer(Protocol):
    """Descobre o MIME real a partir do conteúdo (magic bytes), não da extensão."""

    def sniff(self, head: bytes) -> str: ...


class Thumbnailer(Protocol):
    """Gera prévia de imagem; devolve None quando a fonte não é uma imagem válida."""

    async def make(self, source: Path, destination: Path, max_edge: int) -> Path | None: ...
