import os
import sys
import argparse
import uvicorn
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(
        description="SoverData - A portable, sovereign data platform CLI"
    )
    subparsers = parser.add_subparsers(dest="command", help="System command to execute")

    # serve command
    serve_parser = subparsers.add_parser("serve", help="Launch the local FastAPI web server and background scheduler")
    serve_parser.add_argument(
        "--workspace", "-w",
        default=os.environ.get("SOVERDATA_WORKSPACE", "workspace"),
        help="Target folder containing the workspace structure"
    )
    serve_parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host address to serve UI and API endpoints (default: 127.0.0.1)"
    )
    serve_parser.add_argument(
        "--port", "-p",
        type=int,
        default=8000,
        help="Port to deploy the server listener (default: 8000)"
    )

    # run command
    run_parser = subparsers.add_parser("run", help="Run a Python or SQL pipeline directly via terminal")
    run_parser.add_argument(
        "type",
        choices=["python", "sql"],
        help="Type of the pipeline format"
    )
    run_parser.add_argument(
        "name",
        help="The stem filename of your pipeline (without extension)"
    )
    run_parser.add_argument(
        "--workspace", "-w",
        default=os.environ.get("SOVERDATA_WORKSPACE", "workspace"),
        help="Target folder containing the workspace structure"
    )

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    # Set workspace path in env for child imports / configurations
    workspace_path = str(Path(args.workspace).resolve())
    os.environ["SOVERDATA_WORKSPACE"] = workspace_path

    if args.command == "serve":
        print(f"===============================================================")
        print(f" Starting SoverData on http://{args.host}:{args.port}")
        print(f" Workspace Folder: {workspace_path}")
        print(f" Press Ctrl+C to terminate.")
        print(f"===============================================================")
        
        # Deploy FastAPI via Uvicorn server in-process
        # We point to server.api.main:app
        # Adding current directory to PYTHONPATH so it finds 'server'
        sys.path.append(str(Path(__file__).resolve().parents[1]))
        uvicorn.run("server.api.main:app", host=args.host, port=args.port, reload=False)

    elif args.command == "run":
        print(f"Initializing Runner on Workspace: {workspace_path}")
        # Build query & pipeline imports inline to respect the set environment variable
        sys.path.append(str(Path(__file__).resolve().parents[1]))
        from server.orchestrator.runner import PipelineRunner
        
        runner = PipelineRunner(workspace_path)
        print(f"Executing pipeline '{args.name}' ({args.type})...")
        res = runner.run_pipeline(args.name, args.type)
        
        print("\n---------------- Run Summary ----------------")
        print(f"Status:   {res['status'].upper()}")
        print(f"Started:  {res['started_at']}")
        print(f"Ended:    {res['ended_at']}")
        print(f"Duration: {res['duration']}s")
        if res['error_msg']:
            print(f"Error:    {res['error_msg']}")
            sys.exit(1)
        else:
            print("Completed successfully!")
            sys.exit(0)

if __name__ == "__main__":
    main()
