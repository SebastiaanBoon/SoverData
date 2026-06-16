"""DAG orchestration runner with flow-level and activity-level retries."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from server.orchestrator.scheduler import fire_completion_triggers, run_pipeline
from server.workspace import manager as wm


def _run_id(name: str) -> str:
    ts = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    return f"{ts}_{name}"


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _condition_satisfied(edge: dict, source_status: str) -> bool:
    cond = edge.get("condition", "success")
    if cond == "success":
        return source_status == "success"
    if cond == "failure":
        return source_status == "failed"
    return True


def _condition_can_ever_be_met(edge: dict, source_status: str) -> bool:
    cond = edge.get("condition", "success")
    if cond == "success":
        return source_status == "success"
    if cond == "failure":
        return source_status == "failed"
    return True


async def run_orchestration(workspace_path: Path, name: str) -> dict:
    """Execute an orchestration DAG, retrying the entire flow when configured."""
    definition = wm.get_orchestration(workspace_path, name)
    nodes: list[dict] = definition.get("nodes", [])
    edges: list[dict] = definition.get("edges", [])
    retries = max(0, int(definition.get("retries", 2) or 0))

    if not nodes:
        raise ValueError("Orchestration has no activities.")

    run_id = _run_id(name)
    started = datetime.now(tz=timezone.utc)
    run_meta: dict[str, Any] = {
        "id": run_id,
        "orchestration": name,
        "status": "running",
        "started_at": started.isoformat(),
        "finished_at": None,
        "duration_seconds": None,
        "retries": retries,
        "attempts": 0,
        "current_attempt": 0,
        "steps": [],
        "attempt_history": [],
    }
    wm.save_orchestration_run(workspace_path, run_meta)

    final_status = "failed"
    for attempt in range(retries + 1):
        step_meta = _new_step_meta(nodes, attempt + 1)
        run_meta.update(
            status="running",
            attempts=attempt + 1,
            current_attempt=attempt + 1,
            steps=list(step_meta.values()),
        )
        wm.save_orchestration_run(workspace_path, run_meta)

        def _save() -> None:
            run_meta["steps"] = list(step_meta.values())
            wm.save_orchestration_run(workspace_path, run_meta)

        final_status = await _run_dag(workspace_path, nodes, edges, step_meta, _save)
        run_meta["steps"] = list(step_meta.values())
        run_meta["attempt_history"].append({
            "attempt": attempt + 1,
            "status": final_status,
            "steps": [dict(step) for step in step_meta.values()],
        })
        wm.save_orchestration_run(workspace_path, run_meta)

        if final_status == "success":
            break
        if attempt < retries:
            await asyncio.sleep(1)

    finished = datetime.now(tz=timezone.utc)
    run_meta.update(
        status=final_status,
        finished_at=finished.isoformat(),
        duration_seconds=round((finished - started).total_seconds(), 2),
    )
    wm.save_orchestration_run(workspace_path, run_meta)
    asyncio.create_task(fire_completion_triggers(workspace_path, name, final_status))
    return run_meta


def _new_step_meta(nodes: list[dict], orchestration_attempt: int) -> dict[str, dict[str, Any]]:
    return {
        node["id"]: {
            "node_id": node["id"],
            "name": node.get("name"),
            "type": node.get("type"),
            "status": "pending",
            "run_id": None,
            "started_at": None,
            "finished_at": None,
            "duration_seconds": None,
            "exit_code": None,
            "error": None,
            "retries": int(node.get("retries", 0) or 0),
            "attempts": 0,
            "orchestration_attempt": orchestration_attempt,
        }
        for node in nodes
    }


async def _run_dag(
    workspace_path: Path,
    nodes: list[dict],
    edges: list[dict],
    step_meta: dict[str, dict[str, Any]],
    save: Callable[[], None],
) -> str:
    edges_by_target: dict[str, list[dict]] = {n["id"]: [] for n in nodes}
    for edge in edges:
        edges_by_target.setdefault(edge["target"], []).append(edge)

    node_map = {n["id"]: n for n in nodes}
    all_ids = set(node_map)
    completed: dict[str, str] = {}
    running_tasks: dict[str, asyncio.Task] = {}
    overall_status = "success"

    def ready(nid: str) -> bool:
        for edge in edges_by_target.get(nid, []):
            src_status = completed.get(edge["source"])
            if src_status is None:
                return False
            if not _condition_satisfied(edge, src_status):
                return False
        return True

    def permanently_blocked(nid: str) -> bool:
        for edge in edges_by_target.get(nid, []):
            src_status = completed.get(edge["source"])
            if src_status is None:
                continue
            if not _condition_can_ever_be_met(edge, src_status):
                return True
        return False

    try:
        while len(completed) < len(nodes):
            for nid in all_ids:
                if nid in completed or nid in running_tasks:
                    continue
                if permanently_blocked(nid):
                    completed[nid] = "skipped"
                    step_meta[nid].update(
                        status="skipped",
                        error="Skipped: upstream condition not met",
                        finished_at=_now(),
                    )

            for nid in all_ids:
                if nid in completed or nid in running_tasks:
                    continue
                if ready(nid):
                    step_meta[nid].update(status="running", started_at=_now())
                    running_tasks[nid] = asyncio.create_task(
                        _run_node(workspace_path, node_map[nid], step_meta[nid])
                    )
            save()

            if not running_tasks:
                break

            done, _ = await asyncio.wait(
                running_tasks.values(), return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                nid = next(k for k, v in running_tasks.items() if v == task)
                del running_tasks[nid]
                node_status = step_meta[nid]["status"]
                completed[nid] = node_status
                if node_status == "failed":
                    overall_status = "failed"
            save()
    except Exception as exc:
        overall_status = "failed"
        for nid in list(running_tasks):
            step_meta[nid].update(status="failed", error=str(exc), finished_at=_now())

    if any(s in ("failed", "skipped") for s in completed.values()):
        overall_status = "failed"
    return overall_status


async def _run_node(workspace_path: Path, node: dict, step: dict) -> None:
    retries = max(0, int(node.get("retries", 0) or 0))
    last_error = None
    for attempt in range(retries + 1):
        step.update(status="running", attempts=attempt + 1, error=last_error)
        try:
            target_layer = _node_layer(node) if node.get("type") == "sql" else None
            pipeline_run = await run_pipeline(
                workspace_path,
                node["name"],
                node["type"],
                target_layer=target_layer,
                target_table=_safe_name(node["name"]) if target_layer else None,
            )
            status = pipeline_run.get("status", "failed")
            step.update(
                status=status,
                run_id=pipeline_run.get("id"),
                finished_at=pipeline_run.get("finished_at"),
                duration_seconds=pipeline_run.get("duration_seconds"),
                exit_code=pipeline_run.get("exit_code"),
                error=None if status == "success" else f"Activity attempt {attempt + 1} failed.",
            )
            if status == "success":
                return
            last_error = step.get("error")
        except Exception as exc:
            last_error = str(exc)
            step.update(status="failed", error=last_error, finished_at=_now(), exit_code=1)

        if attempt < retries:
            await asyncio.sleep(1)

    step.update(status="failed", error=last_error or "Activity failed after retries.", finished_at=_now())


def _node_layer(node: dict) -> str | None:
    node_id = str(node.get("id", "")).lower()
    for layer in ("bronze", "silver", "gold"):
        if node_id.startswith(f"{layer}_"):
            return layer
    return None


def _safe_name(value: str) -> str:
    import re
    cleaned = re.sub(r"[^A-Za-z0-9_]+", "_", value.strip().lower()).strip("_")
    return cleaned or "new_table"
