"""Workspace-scoped Python dependency management."""
from __future__ import annotations

import asyncio
import hashlib
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

REQUIREMENTS_FILE = "requirements.txt"
STATE_DIR = ".soverdata"
PACKAGES_DIR = "python_packages"
META_FILE = "packages.yaml"
STDOUT_FILE = "packages_stdout.log"
STDERR_FILE = "packages_stderr.log"
INSTALL_TIMEOUT_SECONDS = 15 * 60

_INSTALL_LOCKS: dict[str, asyncio.Lock] = {}


def get_dependency_info(root: Path) -> dict[str, Any]:
    """Return requirements and install status for a workspace."""
    requirements = read_requirements(root)
    req_hash = _requirements_hash(requirements)
    meta = _read_meta(root)
    packages_path = python_packages_path(root)
    has_requirements = _has_installable_requirements(requirements)

    last_hash = meta.get("requirements_hash")
    last_status = meta.get("status")
    installed = (
        has_requirements
        and packages_path.exists()
        and last_hash == req_hash
        and last_status == "success"
    )

    if not has_requirements:
        status = "empty"
    elif installed:
        status = "installed"
    elif last_status == "failed" and last_hash == req_hash:
        status = "failed"
    elif last_hash and last_hash != req_hash:
        status = "stale"
    else:
        status = "not_installed"

    return {
        "requirements": requirements,
        "requirements_path": REQUIREMENTS_FILE,
        "packages_path": str(packages_path.relative_to(root)),
        "status": status,
        "has_requirements": has_requirements,
        "installed": installed,
        "stale": status == "stale",
        "current_hash": req_hash,
        "last_hash": last_hash,
        "last_installed_at": meta.get("installed_at"),
        "last_finished_at": meta.get("finished_at"),
        "last_exit_code": meta.get("exit_code"),
        "stdout": _read_text(_state_path(root, STDOUT_FILE)),
        "stderr": _read_text(_state_path(root, STDERR_FILE)),
    }


def read_requirements(root: Path) -> str:
    return _read_text(root / REQUIREMENTS_FILE)


def save_requirements(root: Path, requirements: str) -> dict[str, Any]:
    _ensure_workspace_gitignore(root)
    normalized = requirements.replace("\r\n", "\n").replace("\r", "\n").rstrip()
    if normalized:
        normalized += "\n"
    (root / REQUIREMENTS_FILE).write_text(normalized, encoding="utf-8")
    return get_dependency_info(root)


async def install_requirements(root: Path, force: bool = False) -> dict[str, Any]:
    """Install workspace requirements into the workspace package target."""
    lock = _lock_for(root)
    async with lock:
        info = get_dependency_info(root)
        if not info["has_requirements"]:
            return {**info, "installed_now": False}
        if info["status"] == "installed" and not force:
            return {**info, "installed_now": False}

        _ensure_workspace_gitignore(root)
        state_dir = _state_path(root)
        state_dir.mkdir(parents=True, exist_ok=True)
        packages_path = python_packages_path(root)
        packages_path.mkdir(parents=True, exist_ok=True)

        env = os.environ.copy()
        env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
        env["PYTHONUNBUFFERED"] = "1"

        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-input",
            "--upgrade",
            "--target",
            str(packages_path),
            "--requirement",
            str(root / REQUIREMENTS_FILE),
            cwd=str(root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(),
                timeout=INSTALL_TIMEOUT_SECONDS,
            )
            stdout = stdout_bytes.decode("utf-8", errors="replace")
            stderr = stderr_bytes.decode("utf-8", errors="replace")
            exit_code = proc.returncode or 0
        except asyncio.TimeoutError:
            proc.kill()
            stdout_bytes, stderr_bytes = await proc.communicate()
            stdout = stdout_bytes.decode("utf-8", errors="replace")
            stderr = stderr_bytes.decode("utf-8", errors="replace")
            stderr += (
                f"\nPackage installation timed out after "
                f"{INSTALL_TIMEOUT_SECONDS} seconds.\n"
            )
            exit_code = 124
        success = exit_code == 0
        now = _now()

        _state_path(root, STDOUT_FILE).write_text(stdout, encoding="utf-8")
        _state_path(root, STDERR_FILE).write_text(stderr, encoding="utf-8")
        _write_meta(
            root,
            {
                "status": "success" if success else "failed",
                "requirements_hash": info["current_hash"],
                "installed_at": now if success else info.get("last_installed_at"),
                "finished_at": now,
                "exit_code": exit_code,
            },
        )

        updated = get_dependency_info(root)
        return {
            **updated,
            "installed_now": True,
            "stdout": stdout,
            "stderr": stderr,
            "last_exit_code": exit_code,
        }


async def ensure_requirements_installed(root: Path) -> dict[str, Any]:
    """Install requirements when needed and return the latest status."""
    return await install_requirements(root, force=False)


def python_packages_path(root: Path) -> Path:
    return _state_path(root, PACKAGES_DIR)


def add_packages_to_env(root: Path, env: dict[str, str]) -> dict[str, str]:
    """Add workspace-installed packages to a Python subprocess environment."""
    packages_path = python_packages_path(root)
    if not packages_path.exists() or not _has_installable_requirements(read_requirements(root)):
        return env

    python_paths = [str(packages_path)]
    if env.get("PYTHONPATH"):
        python_paths.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(python_paths)

    path_entries = [
        str(packages_path / "bin"),
        str(packages_path / "Scripts"),
    ]
    if env.get("PATH"):
        path_entries.append(env["PATH"])
    env["PATH"] = os.pathsep.join(path_entries)
    env["SOVERDATA_PYTHON_PACKAGES"] = str(packages_path)
    return env


def _has_installable_requirements(requirements: str) -> bool:
    for line in requirements.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            return True
    return False


def _requirements_hash(requirements: str) -> str:
    return hashlib.sha256(requirements.encode("utf-8")).hexdigest()


def _lock_for(root: Path) -> asyncio.Lock:
    key = str(root.resolve())
    if key not in _INSTALL_LOCKS:
        _INSTALL_LOCKS[key] = asyncio.Lock()
    return _INSTALL_LOCKS[key]


def _state_path(root: Path, *parts: str) -> Path:
    return root / STATE_DIR / Path(*parts)


def _read_meta(root: Path) -> dict[str, Any]:
    path = _state_path(root, META_FILE)
    if not path.exists():
        return {}
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _write_meta(root: Path, data: dict[str, Any]) -> None:
    path = _state_path(root, META_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True)


def _read_text(path: Path) -> str:
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def _ensure_workspace_gitignore(root: Path) -> None:
    path = root / ".gitignore"
    entry = f"{STATE_DIR}/"
    if path.exists():
        text = path.read_text(encoding="utf-8")
        entries = {line.strip() for line in text.splitlines()}
        if entry in entries or STATE_DIR in entries:
            return
        suffix = "" if text.endswith("\n") or not text else "\n"
        path.write_text(f"{text}{suffix}{entry}\n", encoding="utf-8")
    else:
        path.write_text(f"{entry}\n", encoding="utf-8")


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()
