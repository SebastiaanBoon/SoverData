"""Quick smoke test for the SoverData API."""
import json
import urllib.request
import urllib.error
import sys

BASE = "http://127.0.0.1:8000"

DEMO_WORKSPACE = r"c:\Users\SebastiaanBoonKaspar\OneDrive - Kasparov Finance & BI\Documenten\SoverData - Claude Sonnet\soverdata\examples\demo-workspace"


def call(method, path, data=None):
    url = BASE + path
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, method=method,
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


ok = True

# 1. Root — should return HTML
req = urllib.request.Request(BASE + "/")
with urllib.request.urlopen(req) as r:
    html = r.read(2000).decode()
    assert "<title>SoverData</title>" in html, f"Root not serving React app. Got: {html[:300]}"
print("✓ Root serves React SPA")

# 2. Workspace — currently null
status, data = call("GET", "/api/workspace")
assert status == 200, f"GET /workspace failed: {status}"
print(f"✓ GET /api/workspace → {status}  (workspace={'open' if data else 'none'})")

# 3. Open demo workspace
status, data = call("POST", "/api/workspace/open", {"path": DEMO_WORKSPACE})
assert status == 200, f"Open workspace failed: {status} {data}"
print(f"✓ POST /api/workspace/open → {status}  name={data.get('name')}")

# 4. Connections
status, data = call("GET", "/api/connections")
assert status == 200, f"GET /connections failed: {status}"
print(f"✓ GET /api/connections → {status}  ({len(data)} connections)")

# 5. Pipelines
status, data = call("GET", "/api/pipelines")
assert status == 200, f"GET /pipelines failed: {status}"
print(f"✓ GET /api/pipelines → {status}  ({len(data)} pipelines)")

# 6. Catalog tables
status, data = call("GET", "/api/catalog/tables")
assert status == 200, f"GET /catalog/tables failed: {status}"
print(f"✓ GET /api/catalog/tables → {status}  ({len(data)} tables)")

# 7. SQL query
status, data = call("POST", "/api/query", {"sql": "SELECT 42 AS answer"})
assert status == 200, f"POST /api/query failed: {status} {data}"
assert data["rows"][0][0] == 42, f"Unexpected result: {data}"
print(f"✓ POST /api/query → {status}  SELECT 42 = {data['rows'][0][0]}")

# 8. Query over lakehouse table
status, data = call("POST", "/api/query", {"sql": "SELECT COUNT(*) AS n FROM bronze__sales"})
if status == 200:
    print(f"✓ Query bronze__sales COUNT = {data['rows'][0][0]}")
else:
    print(f"⚠ Query bronze__sales: {data.get('detail', data)}")

# 9. Runs
status, data = call("GET", "/api/runs")
assert status == 200, f"GET /runs failed: {status}"
print(f"✓ GET /api/runs → {status}  ({len(data)} runs)")

# 10. Branches
status, data = call("GET", "/api/branches")
assert status == 200, f"GET /branches failed: {status}"
print(f"✓ GET /api/branches → {status}  git_available={data.get('git_available')}")

print("\nAll checks passed. App is running at http://127.0.0.1:8000")
