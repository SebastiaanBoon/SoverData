# SoverData - A portable, sovereign data platform

## Concept

A complete data platform in a single package: lakehouse, pipelines, Python/SQL transforms, orchestration, UI, and versioning. Think of it like Fabric, but **open source, portable, and sovereign**.

The core is a strict separation between two things that are each independently portable:

1. **The app (the shell)** - generic, open source, on GitHub. Anyone clones it and builds their own platform with it. This is the engine, UI, and orchestration. Contains no data.
2. **The workspace (your platform)** - your sources, pipelines, data, versions. Fully file-based, portable, and not tied to a specific app version.

Because of that separation you are **never vendor locked-in**, not even to your own app. Updating the app never touches your data. Moving a workspace to another clone of the app just works.

## The two kinds of portability

| | The app (shell) | The workspace (data + platform) |
|---|---|---|
| What | engine, UI, orchestration, connectors | sources, pipelines, lakehouse, versions, lineage |
| Moved via | `git clone` of the open-source repo | copy the folder / its own git repo |
| Owner | the community / everyone | the user |
| Update | git pull the latest version | independent, at your own pace |
| Contains | no data | no app code |

The app reads a workspace via a path/config. The workspace has no idea which app version is running it, as long as that version understands the open workspace format. That format (folder structure + Delta + yaml) is the actual guarantee against lock-in.

## Run modes (one codebase)

1. **Local (single-user)**: clone the app, start it, work through the browser UI.
2. **On a shared VM (team)**: the app runs as a server on a VM; team members connect from their own computers via the browser. Add sources, run orchestration, work in branches.

Migrating between these = move the workspace folder.

## Core principles

1. **App and data strictly separated.** Two independently portable things.
2. **Open source.** The app is public on GitHub, cloneable, reusable.
3. **Open workspace format.** Folders + Delta + yaml. No proprietary format, so no lock-in.
4. **Sovereign.** Runs fully self-contained; nothing leaves the machine.
5. **File-based, no database server.**
6. **Server + web UI.** Local or on a VM, through the browser.
7. **Python and SQL.** No notebooks required.
8. **Git branches** for teamwork.

## Tech stack

| Component | Choice | Why |
|-----------|--------|-----|
| Backend/server | **FastAPI** (Python) | One process: serves the UI + runs pipelines. Local or VM. |
| Web UI | **React** (or HTMX) | Connections, pipelines, runs, versions, branches in the browser. |
| Query engine | **DuckDB** | A library, runs in-process (like SQLite). Reads directly over Parquet/Delta. No server. |
| Lakehouse format | **Delta Lake via delta-rs** | Versioning + time travel on files, without JVM/Spark. Open format. |
| File access | **fsspec / Arrow** | One interface for local (and optionally cloud later, same code). |
| Orchestration | **Lightweight in-process scheduler** | Pipelines with dependencies, retries, lineage. No external orchestrator. |
| Connections | **SQLAlchemy + connectorx + REST** | Postgres, SQL Server, REST/AFAS-style, SharePoint, files. |
| Code versioning | **Git** (pygit2) | Both the app and the workspace. Branches, merges. |
| Secrets | **OS keychain / encrypted file** | Never plain in the workspace. |

> DuckDB, delta-rs, and fsspec are libraries bundled with the app, not separate downloads.

## Repo structure (the open-source app)

```
soverdata/                      # the public GitHub repo
├── README.md                   # clone & start in 3 steps
├── LICENSE                     # e.g. Apache-2.0 or MIT
├── pyproject.toml
├── server/
│   ├── api/                    # connections, runs, branches, catalog
│   ├── engine/                 # DuckDB + delta-rs + fsspec
│   ├── orchestrator/           # in-process scheduler, lineage
│   └── workspace/              # read/write the open workspace format
├── ui/                         # React web UI
├── cli/                        # soverdata serve / run (headless, for VM)
└── examples/
    └── demo-workspace/         # example so people see something immediately
```

The repo contains **no** real data, only a demo workspace as an example.

## Workspace structure (your platform, independently portable)

```
my-workspace/                   # own folder, own git repo, separate from the app
├── workspace.yaml              # config + format version
├── connections/                # sources (yaml, credentials kept separate)
├── pipelines/
│   ├── python/                 # ingestion + transforms (.py)
│   └── sql/                    # transforms (DuckDB SQL)
├── lakehouse/
│   └── bronze/ silver/ gold/   # Delta tables = folders (parquet + _delta_log)
├── catalog/                    # schemas, lineage, metadata
├── runs/                       # run history, logs
└── .git/                       # branches + versioning
```

`workspace.yaml` holds a **format version** so the app knows whether it can open a workspace. That lets app and data evolve independently.

## How someone uses it

1. `git clone` the app.
2. `soverdata serve` (local) or install as a service on a VM.
3. In the UI: open or create a workspace (a folder somewhere on the machine).
4. Add connections, build pipelines, run orchestration.
5. The workspace is theirs: back it up, move it, put it in its own git.

Updating the app = `git pull` in the app repo. The workspace is untouched.

## Lakehouse (file-based, no database)

- A table = a **folder** with Parquet files + `_delta_log/`.
- Writing = new Parquet + log entry. Old files remain → version history (time travel).
- Querying = DuckDB reads directly over the files via a SQL endpoint in the UI. No import, no server.
- Medallion bronze/silver/gold as a folder structure.

## Pipelines & orchestration (can be simple)

- A pipeline = a set of Python and/or SQL steps with dependencies.
- The in-process scheduler runs them in order, with retries and logging to `runs/`.
- Trigger via UI (manual), schedule (cron-style within the process), or CLI for headless.
- Lineage is recorded in `catalog/` so you can see what depends on what.

## Python and SQL

- **Python**: REST APIs, SharePoint, custom logic. No notebooks; just `.py` files in `pipelines/python/`.
- **SQL**: DuckDB SQL over Delta/Parquet and external sources.
- Define connections once in the UI and reuse them by name.

## Versioning & branches (the team part)

- **Workspace = git repo.** Pipelines, SQL, connection config, and workspace settings are all code.
- **Branches**: a team member creates a branch, builds/changes pipelines and sources, merges to main. Via the UI or plain git.
- **Data isolation per branch** (trade-off, see risks): either a separate data path per branch (`lakehouse/_branches/<name>/`), or branches share data and only code differs. Start with code branches on shared data; data branching later.
- **Data versions**: Delta time travel per table. A git tag can pin a data version for reproducible runs.

## AI assist (generating pipelines)

Goal: nobody has to type everything by hand. The AI writes the Python/SQL pipelines. This runs along two tracks, because the workspace is just a folder of `.py`/`.sql` + git and can therefore be edited by both the app and an external editor.

### Track 1 - In the app (UI), for the non-technical user

The user describes in natural language what they want; the app generates the pipeline.

Authentication: **bring-your-own API key** or a **local model**. Using a Pro/Max subscription inside the app is not possible: Anthropic does not allow Claude.ai login or subscription credentials in third-party apps, and has been actively blocking that since early 2026. Therefore:
- **Own API key** (Anthropic Console or a cloud provider): top quality. Key, billing, and usage belong to the user; the app maker is not in the middle. The only scalable model for open source.
- **Local model** (e.g. via Ollama): fully sovereign, offline, no account, nothing leaves the machine. Lower code quality, but maximally consistent with the sovereignty principle.
- Keys go in the secrets store (OS keychain/encrypted), never plain in the workspace.

### Track 2 - Local development with Claude Code (VS Code)

Because the workspace is a normal folder, you open it in VS Code and use **Claude Code** in the terminal. Here your Pro/Max subscription is allowed: Claude Code is an official Anthropic tool, not a third-party app, and is exactly the permitted exception for subscription auth.

Flow: open the workspace folder in VS Code, run `claude` in the integrated terminal, Claude Code writes the pipelines on your subscription. The app picks up the changes because it is the same workspace and the same git.

### Why this fits

- **Two profiles served**: business user via UI, developer via VS Code + Claude Code.
- **Not vendor-locked to the AI**: generated code is readable `.py`/`.sql`, versioned, reviewable, and runnable without AI.
- **Provider-agnostic**: build the in-app AI layer behind a small interface so Anthropic, another provider, or a local model are interchangeable.

### Design requirement that follows

The workspace must be **filesystem-first and editor-friendly**: no hidden state in the app process, everything that matters lives as a file on disk. That way the app sees changes made by Claude Code or a manual edit. Implement a file watcher or reload-on-run so external changes come along automatically.

## Build phases

1. **Engine core + workspace format**: DuckDB + delta-rs + fsspec; define the open workspace format and read/write with time travel. CLI first.
2. **Connections + ingestion**: framework, metadata-driven bronze load, Python + SQL.
3. **Orchestration**: in-process scheduler, medallion, lineage.
4. **Server + web UI**: FastAPI serves React; everything through the browser. Local and VM.
5. **Git/branches in the UI** + data isolation strategy.
6. **Open-source release**: README, license, demo workspace, per-OS installer, headless service mode.

## Risks & trade-offs

- **Format stability is sacred.** Because the workspace lives separately from the app, the format must be documented and version-driven. Breaking changes need a migration path. This is what truly prevents lock-in, so it deserves care.
- **Write concurrency on a VM**: file-based Delta wants one writer per table. The orchestrator must serialize writes per table (lock/queue).
- **Data branching**: branching code is free (git), branching data is not. Start simple.
- **Secrets when moving**: never plain in the workspace; OS keychain or encrypted store.
- **Single-node limit**: DuckDB handles tens to hundreds of GB fine; TB workloads with heavy shuffles are the deliberate limit of going Spark-free.
- **Bundling Python/native wheels** (DuckDB/delta-rs) per OS/arch is the bulk of the installer work.
- **Open-source maintenance**: a public repo means issues, PRs, docs. Plan for this once it gets serious.
