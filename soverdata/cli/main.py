"""SoverData CLI — soverdata serve / run commands."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console

app = typer.Typer(name="soverdata", help="SoverData — sovereign data platform")
console = Console()

_ROOT = Path(__file__).parent.parent


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", help="Bind host"),
    port: int = typer.Option(8000, help="Bind port"),
    reload: bool = typer.Option(False, help="Enable hot-reload (development mode)"),
    workspace: Optional[str] = typer.Option(None, help="Open workspace on startup"),
    build_ui: bool = typer.Option(True, help="Auto-build UI if dist/ is missing"),
):
    """Start the SoverData server and open the web UI."""
    _maybe_build_ui(build_ui)

    if workspace:
        # Set workspace before starting the server by patching app_state
        from server.config import app_state
        app_state.set_workspace(workspace)
        console.print(f"[green]Workspace:[/] {workspace}")

    console.print(f"[bold green]SoverData[/] starting on [bold]http://{host}:{port}[/]")
    console.print("Press Ctrl+C to stop.")

    import uvicorn
    uvicorn.run(
        "server.main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )


@app.command()
def run(
    pipeline: str = typer.Argument(..., help="Pipeline name"),
    pipeline_type: str = typer.Option("python", help="Pipeline type: python or sql"),
    workspace: str = typer.Option(..., help="Path to the workspace folder"),
):
    """Run a pipeline from the command line (headless)."""
    import asyncio
    from pathlib import Path
    from server.orchestrator.scheduler import run_pipeline

    ws_path = Path(workspace).resolve()
    console.print(f"Running [bold]{pipeline}[/] ({pipeline_type}) in [dim]{ws_path}[/]")

    async def _run():
        return await run_pipeline(ws_path, pipeline, pipeline_type)

    result = asyncio.run(_run())
    status = result.get("status", "unknown")
    color = "green" if status == "success" else "red"
    console.print(f"Status: [{color}]{status}[/]  Duration: {result.get('duration_seconds')}s")
    if status != "success":
        raise typer.Exit(code=1)


def _maybe_build_ui(enabled: bool) -> None:
    ui_dist = _ROOT / "ui" / "dist"
    ui_src = _ROOT / "ui" / "package.json"

    if ui_dist.exists():
        return  # already built

    if not enabled or not ui_src.exists():
        console.print("[yellow]UI not built.[/] Run: cd ui && npm install && npm run build")
        return

    console.print("[dim]Building UI (first run)...[/]")
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    ui_dir = _ROOT / "ui"
    try:
        subprocess.run([npm, "install"], cwd=ui_dir, check=True)
        subprocess.run([npm, "run", "build"], cwd=ui_dir, check=True)
        console.print("[green]UI built successfully.[/]")
    except subprocess.CalledProcessError as e:
        console.print(f"[red]UI build failed:[/] {e}")
        console.print("Start the UI manually: cd ui && npm install && npm run dev")


if __name__ == "__main__":
    app()
