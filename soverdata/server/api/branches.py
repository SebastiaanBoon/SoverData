"""Branches API — git branch management for the workspace."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from server.config import app_state

router = APIRouter()


def _get_repo(ws):
    try:
        import git
        return git.Repo(str(ws))
    except Exception:
        return None


def _has_commits(repo) -> bool:
    try:
        repo.git.rev_parse("--verify", "HEAD")
        return True
    except Exception:
        return False


def _ensure_initial_commit(repo) -> None:
    if _has_commits(repo):
        return

    with repo.git.custom_environment(
        GIT_AUTHOR_NAME="SoverData",
        GIT_AUTHOR_EMAIL="soverdata@local",
        GIT_COMMITTER_NAME="SoverData",
        GIT_COMMITTER_EMAIL="soverdata@local",
    ):
        repo.git.commit("--allow-empty", "-m", "Initial workspace commit")


@router.get("")
def list_branches():
    ws = app_state.require_workspace()
    repo = _get_repo(ws)
    if repo is None:
        return {"branches": [], "current": None, "git_available": False}
    try:
        branches = [b.name for b in repo.branches]
        current = repo.active_branch.name if _has_commits(repo) and not repo.head.is_detached else None
        return {"branches": branches, "current": current, "git_available": True}
    except Exception as e:
        return {"branches": [], "current": None, "git_available": False, "error": str(e)}


class CreateBranchRequest(BaseModel):
    name: str


@router.post("")
def create_branch(req: CreateBranchRequest):
    ws = app_state.require_workspace()
    repo = _get_repo(ws)
    if repo is None:
        raise HTTPException(status_code=400, detail="Workspace is not a git repository. Run 'git init' inside it first.")
    try:
        _ensure_initial_commit(repo)
        repo.create_head(req.name)
        return {"status": "created", "branch": req.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class CheckoutRequest(BaseModel):
    name: str


@router.post("/checkout")
def checkout_branch(req: CheckoutRequest):
    ws = app_state.require_workspace()
    repo = _get_repo(ws)
    if repo is None:
        raise HTTPException(status_code=400, detail="Workspace is not a git repository.")
    try:
        _ensure_initial_commit(repo)
        repo.git.checkout(req.name)
        return {"status": "ok", "branch": req.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/init")
def init_git():
    ws = app_state.require_workspace()
    try:
        import git
        repo = git.Repo.init(str(ws))
        _ensure_initial_commit(repo)
        return {"status": "initialized", "path": str(ws)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
