from pathlib import Path


class LocalDiskStorage:
    def __init__(self, root: Path) -> None:
        self._root = root.resolve()

    def resolve(self, storage_path: str) -> Path:
        target = (self._root / storage_path).resolve()
        # Defesa contra path traversal: nunca sai da raiz.
        if not target.is_relative_to(self._root):
            raise ValueError("storage path inválido")
        return target

    def delete(self, storage_path: str) -> None:
        target = self.resolve(storage_path)
        target.unlink(missing_ok=True)
