"""DAG orchestration runner — parallel execution with per-edge conditions."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from server.orchestrator.scheduler import run_pipeline, fire_completion_triggers
from server.workspace import manager as wm


def _run_id(name: str) -> str:
    ts = datetime.now(tz=timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    return f"{ts}_{name}"


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


# ── Edge condition helpers ────────────────────────────────────────

def _condition_satisfied(edge: dict, source_status: str) -> bool:
    """Return True if edge condition is met given the source node's final status."""
    cond = edge.get("condition", "success")
    if cond == "success":
        return source_status == "success"
    if cond == "failure":
        return source_status == "failed"
    return True  # completion — any status counts


def _condition_can_ever_be_met(edge: dict, source_status: str) -> bool:
    """Return False if the source is done and the condition can never be satisfied."""
    cond = edge.get("condition", "success")
    if cond == "success":
        return source_status == "success"
    if cond == "failure":
        return source_status == "failed"
    return True  # completion always satisfiable once source finishes


# ── Runner ────────────────────────────────────────────────────────

async def run_orchestration(workspace_path: Path, name: str) -> dict:
    """Execute an orchestration DAG. Edges carry success/failure/completion conditions."""
    definition = wm.get_orchestration(workspace_path, name)

    nodes: list[dict] = definition.get("nodes", [])
    edges: list[dict] = definition.get("edges", [])

    if not nodes:
        raise ValueError("Orchestration has no pipeline blocks.")

    run_id = _run_id(name)
    started = datetime.now(tz=timezone.utc)

    step_meta: dict[str, dict[str, Any]] = {
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
        }
        for node in nodes
    }

    run_meta: dict[str, Any] = {
        "id": run_id,
        "orchestration": name,
        "status": "running",
        "started_at": started.isoformat(),
        "finished_at": None,
        "duration_seconds": None,
        "steps": list(step_meta.values()),
    }
    wm.save_orchestration_run(workspace_path, run_meta)

    def _save() -> None:
        run_meta["steps"] = list(step_meta.values())
        wm.save_orchestration_run(workspace_path, run_meta)

    # Index edges by target for quick lookup
    edges_by_target: dict[str, list[dict]] = {n["id"]: [] for n in nodes}
    for edge in edges:
        edges_by_target[edge["target"]].append(edge)

    node_map = {n["id"]: n for n in nodes}
    all_ids = set(node_map)

    completed: dict[str, str] = {}   # node_id -> 'success' | 'failed' | 'skipped'
    running_tasks: dict[str, asyncio.Task] = {}
    overall_status = "success"

    def _ready(nid: str) -> bool:
        """All incoming edges have their conditions satisfied."""
        for edge in edges_by_target[nid]:
            src_status = completed.get(edge["source"])
            if src_status is None:
                return False
            if not _condition_satisfied(edge, src_status):
                return False
        return True

    def _permanently_blocked(nid: str) -> bool:
        """At least one incoming edge can never be satisfied."""
        for edge in edges_by_target[nid]:
            src_status = completed.get(edge["source"])
            if src_status is None:
                continue  # source not yet done
            if not _condition_can_ever_be_met(edge, src_status):
                return True
        return False

    try:
        while len(completed) < len(nodes):
            # Mark nodes that are permanently blocked (condition can never be met)
            for nid in all_ids:
                if nid in completed or nid in running_tasks:
                    continue
                if _permanently_blocked(nid):
                    completed[nid] = "skipped"
                    step_meta[nid].update(
                        status="skipped",
                        error="Skipped: upstream condition not met",
                        finished_at=_now(),
                    )

            # Launch all nodes whose conditions are now satisfied
            for nid in all_ids:
                if nid in completed or nid in running_tasks:
                    continue
                if _ready(nid):
                    step_meta[nid].update(status="running", started_at=_now())
                    running_tasks[nid] = asyncio.create_task(
                        _run_node(workspace_path, node_map[nid], step_meta[nid])
                    )
            _save()

            if not running_tasks:
                break  # nothing left to wait for

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
            _save()

    except Exception as exc:
        overall_status = "failed"
        for nid in list(running_tasks):
            step_meta[nid].update(status="failed", error=str(exc), finished_at=_now())

    # If any node failed or was skipped due to a condition, mark overall as failed
    if any(s in ("failed", "skipped") for s in completed.values()):
        overall_status = "failed"

    finished = datetime.now(tz=timezone.utc)
    run_meta.update(
        status=overall_status,
        finished_at=finished.isoformat(),
        duration_seconds=round((finished - started).total_seconds(), 2),
    )
    _save()
    asyncio.create_task(fire_completion_triggers(workspace_path, name, overall_status))
    return run_meta


async def _run_node(workspace_path: Path, node: dict, step: dict) -> None:
    try:
        pipeline_run = await run_pipeline(workspace_path, node["name"], node["type"])
        step.update(
            status=pipeline_run.get("status", "failed"),
            run_id=pipeline_run.get("id"),
            finished_at=pipeline_run.get("finished_at"),
            duration_seconds=pipeline_run.get("duration_seconds"),
            exit_code=pipeline_run.get("exit_code"),
        )
    except Exception as exc:
        step.update(status="failed", error=str(exc), finished_at=_now())
