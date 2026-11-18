import asyncio
from pathlib import Path

import magic
from PIL import Image, UnidentifiedImageError

_GENERIC_MIME = "application/octet-stream"


class LibmagicMimeSniffer:
    """MIME real por magic bytes via libmagic (python-magic; DLL do python-magic-bin no Windows)."""

    def sniff(self, head: bytes) -> str:
        try:
            detected = magic.from_buffer(head, mime=True)
        except Exception:
            return _GENERIC_MIME
        return detected or _GENERIC_MIME


class PillowImageThumbnailer:
    """Prévia JPEG limitada ao maior lado (`max_edge`), preservando proporção."""

    def make_sync(self, source: Path, destination: Path, max_edge: int) -> Path | None:
        try:
            with Image.open(source) as image:
                image.thumbnail((max_edge, max_edge))
                destination.parent.mkdir(parents=True, exist_ok=True)
                image.convert("RGB").save(destination, format="JPEG", quality=80)
            return destination
        except (UnidentifiedImageError, OSError, ValueError):
            return None

    async def make(self, source: Path, destination: Path, max_edge: int) -> Path | None:
        # Decodificação é CPU-bound: fora do event loop.
        return await asyncio.to_thread(self.make_sync, source, destination, max_edge)
