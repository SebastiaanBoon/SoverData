import os
import re
from pathlib import Path

class LineageAnalyzer:
    def __init__(self, workspace_path: str):
        self.workspace_path = Path(workspace_path).resolve()

    def generate_lineage(self) -> dict:
        """
        Dynamically analyzes connection files, Python pipelines, and SQL pipelines 
        to detect dependencies and build a lineage graph representing data flow.
        """
        nodes = []
        edges = []
        node_ids = set()

        def add_node(node_id: str, label: str, type: str, metadata: dict = None):
            if node_id not in node_ids:
                nodes.append({
                    "id": node_id,
                    "label": label,
                    "type": type,
                    "metadata": metadata or {}
                })
                node_ids.add(node_id)

        def add_edge(source: str, target: str):
            edge = {"source": source, "target": target}
            if edge not in edges:
                edges.append(edge)

        # 1. Inspect Connections (Sources)
        connections_dir = self.workspace_path / "connections"
        if connections_dir.exists():
            for f in connections_dir.glob("*.yaml"):
                conn_name = f.stem
                add_node(
                    node_id=f"conn_{conn_name}",
                    label=conn_name,
                    type="connection",
                    metadata={"file_path": str(f.relative_to(self.workspace_path))}
                )

        # 2. Inspect Python Pipelines
        py_dir = self.workspace_path / "pipelines" / "python"
        if py_dir.exists():
            for f in py_dir.glob("*.py"):
                pipe_name = f.stem
                pipe_id = f"pipe_py_{pipe_name}"
                add_node(
                    node_id=pipe_id,
                    label=f"{pipe_name}.py",
                    type="pipeline_python",
                    metadata={"file_path": str(f.relative_to(self.workspace_path))}
                )
                
                # Analyze content for connections/tables referenced
                try:
                    with open(f, "r", encoding="utf-8") as file:
                        content = file.read()
                    
                    # Look for: read_sql(..., "connection_name") or ingest_rest("connection_name")
                    # find all read_sql calls where second argument is connection
                    read_sql_conns = re.findall(r'read_sql\s*\(\s*["\'](?:[^"\']+)["\']\s*,\s*["\']([^"\']+)["\']', content)
                    for conn_name in read_sql_conns:
                        add_edge(f"conn_{conn_name}", pipe_id)

                    # find all ingest_rest calls where first argument is connection
                    ingest_conns = re.findall(r'ingest_rest\s*\(\s*["\']([^"\']+)["\']', content)
                    for conn_name in ingest_conns:
                        add_edge(f"conn_{conn_name}", pipe_id)

                    # Look for: write_delta(..., "tier", "table")
                    delta_matches = re.findall(r'write_delta\s*\(.*?,?\s*["\']([^"\']+)["\']\s*,\s*["\']([^"\']+)["\']', content)
                    for tier, table in delta_matches:
                        table_id = f"table_{tier}_{table}"
                        add_node(table_id, f"{tier}.{table}", f"table_{tier}", {"tier": tier, "table": table})
                        add_edge(pipe_id, table_id)
                except Exception as e:
                    pass

        # 3. Inspect SQL Pipelines
        sql_dir = self.workspace_path / "pipelines" / "sql"
        if sql_dir.exists():
            for f in sql_dir.glob("*.sql"):
                pipe_name = f.stem
                pipe_id = f"pipe_sql_{pipe_name}"
                add_node(
                    node_id=pipe_id,
                    label=f"{pipe_name}.sql",
                    type="pipeline_sql",
                    metadata={"file_path": str(f.relative_to(self.workspace_path))}
                )
                
                try:
                    with open(f, "r", encoding="utf-8") as file:
                        content = file.read()
                    
                    # 3a. Find target details from annotations or convention names
                    target_tier = None
                    target_table = None
                    target_match = re.search(r'--\s*target\s*:\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)', content)
                    if target_match:
                        target_tier, target_table = target_match.groups()
                    elif "_" in pipe_name:
                        parts = pipe_name.split("_", 1)
                        if parts[0] in ["bronze", "silver", "gold"]:
                            target_tier = parts[0]
                            target_table = parts[1]
                    
                    if target_tier and target_table:
                        target_id = f"table_{target_tier}_{target_table}"
                        add_node(target_id, f"{target_tier}.{target_table}", f"table_{target_tier}", {"tier": target_tier, "table": target_table})
                        add_edge(pipe_id, target_id)
                    
                    # 3b. Find sources referenced in SQL (e.g. FROM bronze.customers or JOIN bronze.orders)
                    # matches: tier.table_name or tier_table_name
                    from_matches = re.findall(r'(?:FROM|JOIN)\s+([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_-]+))?', content, re.IGNORECASE)
                    for m1, m2 in from_matches:
                        if m2: # tier.table format
                            tier, table = m1.lower(), m2
                        else:  # could be tier_table form
                            if "_" in m1:
                                parts = m1.split("_", 1)
                                if parts[0] in ["bronze", "silver", "gold"]:
                                    tier, table = parts[0], parts[1]
                                else:
                                    continue
                            else:
                                continue
                                
                        if tier in ["bronze", "silver", "gold"]:
                            source_table_id = f"table_{tier}_{table}"
                            add_node(source_table_id, f"{tier}.{table}", f"table_{tier}", {"tier": tier, "table": table})
                            add_edge(source_table_id, pipe_id)
                except Exception as e:
                    pass

        # 4. Check for Orphan Lakehouse Tables that didn't have explicit edges
        lakehouse_dir = self.workspace_path / "lakehouse"
        for tier in ["bronze", "silver", "gold"]:
            tier_dir = lakehouse_dir / tier
            if tier_dir.exists():
                for table_dir in tier_dir.iterdir():
                    if table_dir.is_dir() and (table_dir / "_delta_log").exists():
                        table_name = table_dir.name
                        table_id = f"table_{tier}_{table_name}"
                        add_node(
                            table_id, 
                            f"{tier}.{table_name}", 
                            f"table_{tier}", 
                            {"tier": tier, "table": table_name}
                        )

        return {"nodes": nodes, "edges": edges}
