"""Global application state."""
from pathlib import Path
from typing import Optional


class AppState:
    """Holds runtime state for the server (e.g. which workspace is open)."""

    def __init__(self) -> None:
        self.workspace_path: Optional[Path] = None

    def set_workspace(self, path: str) -> None:
        self.workspace_path = Path(path).resolve()

    def get_workspace(self) -> Optional[Path]:
        return self.workspace_path

    def is_open(self) -> bool:
        return self.workspace_path is not None and self.workspace_path.exists()

    def require_workspace(self) -> Path:
        """Return the workspace path or raise if none is open."""
        if not self.is_open():
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="No workspace is open. Open or create a workspace first.")
        return self.workspace_path  # type: ignore[return-value]


app_state = AppState()
