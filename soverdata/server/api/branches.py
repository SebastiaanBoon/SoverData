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


@router.get("")
def list_branches():
    ws = app_state.require_workspace()
    repo = _get_repo(ws)
    if repo is None:
        return {"branches": [], "current": None, "git_available": False}
    try:
        branches = [b.name for b in repo.branches]
        current = repo.active_branch.name if not repo.head.is_detached else None
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
        return {"status": "initialized", "path": str(ws)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
