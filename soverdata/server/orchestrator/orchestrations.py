"""Sequential orchestration runner for workspace pipelines."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from server.orchestrator.scheduler import run_pipeline
from server.workspace import manager as wm


def _run_id(orchestration_name: str) -> str:
    ts = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    return f"{ts}_{orchestration_name}"


async def run_orchestration(workspace_path: Path, name: str) -> dict:
    """Run an orchestration's pipeline steps one after another."""
    definition = wm.get_orchestration(workspace_path, name)
    steps = definition.get("steps", [])
    if not steps:
        raise ValueError("Orchestration has no steps.")

    run_id = _run_id(name)
    started = datetime.now(tz=timezone.utc)
    run_meta: dict[str, Any] = {
        "id": run_id,
        "orchestration": name,
        "status": "running",
        "started_at": started.isoformat(),
        "finished_at": None,
        "duration_seconds": None,
        "steps": [
            {
                "index": i + 1,
                "name": step.get("name"),
                "type": step.get("type"),
                "status": "pending",
                "run_id": None,
                "started_at": None,
                "finished_at": None,
                "duration_seconds": None,
                "exit_code": None,
            }
            for i, step in enumerate(steps)
        ],
    }
    wm.save_orchestration_run(workspace_path, run_meta)

    status = "success"
    try:
        for i, step in enumerate(steps):
            step_name = step.get("name")
            step_type = step.get("type")
            if not step_name or step_type not in ("python", "sql"):
                raise ValueError(f"Invalid step {i + 1}: expected a pipeline name and type.")

            run_meta["steps"][i].update(
                status="running",
                started_at=datetime.now(tz=timezone.utc).isoformat(),
            )
            wm.save_orchestration_run(workspace_path, run_meta)

            pipeline_run = await run_pipeline(workspace_path, step_name, step_type)
            run_meta["steps"][i].update(
                status=pipeline_run.get("status"),
                run_id=pipeline_run.get("id"),
                finished_at=pipeline_run.get("finished_at"),
                duration_seconds=pipeline_run.get("duration_seconds"),
                exit_code=pipeline_run.get("exit_code"),
            )
            wm.save_orchestration_run(workspace_path, run_meta)

            if pipeline_run.get("status") != "success":
                status = "failed"
                break
    except Exception as exc:
        status = "failed"
        for step in run_meta["steps"]:
            if step.get("status") == "running":
                step["status"] = "failed"
                step["error"] = str(exc)
                step["finished_at"] = datetime.now(tz=timezone.utc).isoformat()
                break

    finished = datetime.now(tz=timezone.utc)
    run_meta.update(
        status=status,
        finished_at=finished.isoformat(),
        duration_seconds=round((finished - started).total_seconds(), 2),
    )
    wm.save_orchestration_run(workspace_path, run_meta)
    return run_meta
