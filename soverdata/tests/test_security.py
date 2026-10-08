"""Security regressions: CORS, path traversal and secrets in error messages."""
import importlib
import sys
import types

import pytest
from fastapi.testclient import TestClient

import server.main as main_module
from server.config import app_state
from server.workspace import manager as wm


@pytest.fixture
def client(tmp_path, monkeypatch):
    root = tmp_path / "workspaces"
    root.mkdir()
    monkeypatch.setattr(app_state, "workspaces_root", root)
    ws = root / "demo"
    wm.create_workspace(str(ws), "demo")
    app_state.set_workspace(str(ws))
    yield TestClient(main_module.app)
    app_state.workspace_path = None


def test_no_wildcard_cors_by_default(client):
    res = client.get("/api/workspace", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in res.headers

    pre = client.options(
        "/api/pipelines",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"},
    )
    assert "access-control-allow-origin" not in pre.headers


def test_cors_only_for_configured_origins(monkeypatch):
    monkeypatch.setenv("SOVERDATA_CORS_ORIGINS", "https://ui.example")
    reloaded = importlib.reload(main_module)
    try:
        c = TestClient(reloaded.app)
        ok = c.get("/api/workspace", headers={"Origin": "https://ui.example"})
        assert ok.headers.get("access-control-allow-origin") == "https://ui.example"
        evil = c.get("/api/workspace", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in evil.headers
    finally:
        monkeypatch.delenv("SOVERDATA_CORS_ORIGINS")
        importlib.reload(main_module)


@pytest.mark.parametrize("name", ["../escape", "../../escape", "sub/name", "..", "a\\b"])
def test_names_cannot_escape_workspace(client, tmp_path, name):
    conn = client.post("/api/connections", json={"name": name, "type": "csv", "config": {}})
    pipe = client.post("/api/pipelines", json={"name": name, "type": "sql", "code": "select 1"})
    orch = client.post("/api/orchestrations", json={"name": name})

    assert conn.status_code == 400
    assert pipe.status_code == 400
    assert orch.status_code == 400
    assert not list(tmp_path.glob("escape*"))
    assert not list((tmp_path / "workspaces").glob("escape*"))


def test_normal_names_still_work(client):
    assert client.post("/api/connections", json={"name": "sales_db", "type": "csv", "config": {"path": "x.csv"}}).status_code == 200
    assert client.post("/api/pipelines", json={"name": "load-sales.v2", "type": "sql", "code": "select 1"}).status_code == 200
    assert client.get("/api/pipelines/sql/load-sales.v2").json()["code"] == "select 1"


def test_open_workspace_restricted_to_root(client, tmp_path):
    outside = tmp_path / "outside"
    wm.create_workspace(str(outside), "outside")

    assert client.post("/api/workspace/open", json={"path": str(outside)}).status_code == 400
    assert client.post("/api/workspace/open", json={"path": "/"}).status_code == 400
    inside = app_state.workspaces_root / "demo"
    assert client.post("/api/workspace/open", json={"path": str(inside)}).status_code == 200


def test_connection_errors_do_not_leak_secrets(client, monkeypatch):
    secret_url = "postgresql://admin:S3cr%40t-pw@db.internal:5432/sales"

    class ArgumentError(Exception):
        pass

    def create_engine(url):
        raise ArgumentError(f"Could not parse SQLAlchemy URL from string '{url}' (password S3cr@t-pw)")

    fake = types.SimpleNamespace(create_engine=create_engine, text=lambda s: s)
    monkeypatch.setitem(sys.modules, "sqlalchemy", fake)

    client.post("/api/connections", json={"name": "pg", "type": "postgres", "config": {"connection_string": secret_url}})
    tested = client.post("/api/connections/pg/test").json()
    queried = client.post("/api/connections/pg/query", json={"sql": "select 1"})

    for text in (tested["message"], queried.json()["detail"]):
        assert "S3cr" not in text
        assert "********" in text
    assert client.get("/api/connections/pg").json()["config"]["connection_string"] == "********"
