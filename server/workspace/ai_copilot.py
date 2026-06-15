import os
import requests
import json
import logging

logger = logging.getLogger(__name__)

class AICopilot:
    def __init__(self, workspace_path: str):
        self.workspace_path = workspace_path

    def generate_code(self, prompt: str, pipeline_type: str, provider: str = "openai", api_key: str = None, model: str = None) -> dict:
        """
        Generates Python/SQL pipeline codes using bringing-your-own LLM API key
        or falls back to a clever system-prompt generator if offline / keys are empty.
        """
        system_instructions = ""
        if pipeline_type == "python":
            system_instructions = (
                "You are an expert data engineer for the SoverData Portable Data Platform.\n"
                "Return ONLY pure Python executable code. Do NOT enclose in markdown ```python codeblocks.\n"
                "Use the provided `soverdata` pipeline context class to read databases or REST connectors.\n\n"
                "Standard API pattern to include:\n"
                "```python\n"
                "from soverdata import context\n"
                "import pandas as pd\n"
                "# 1. Fetch external\n"
                "# df = context.read_sql('SELECT * FROM source_tbl', 'connection_name')\n"
                "# 2. Ingest REST\n"
                "# df = context.ingest_rest('connection_rest', 'endpoint')\n"
                "# 3. Query internal Delta tables\n"
                "# df = context.query('SELECT * FROM bronze.my_table')\n"
                "# 4. Write Delta\n"
                "# context.write_delta(df, 'bronze', 'table_name')\n"
                "```"
            )
        else:
            system_instructions = (
                "You are an expert SQL engineer for the SoverData DuckDB database engine.\n"
                "Return ONLY standard ANSI SQL queries. Do NOT enclose in markdown codeblocks.\n"
                "Ensure you annotate targets at the very top using: `-- target: silver.table_name`.\n"
                "Query existing levels using schemas: bronze, silver, or gold clusters (e.g. `SELECT * FROM bronze.orders`)."
            )

        if not api_key:
            # Sovereign / air-gapped rule! 
            # If no API key is specified, we offer a very smart rule-based mock compiler or attempt Ollama.
            # Let's try locating Ollama first if it's local
            try:
                ollama_url = "http://localhost:11434/api/chat"
                payload = {
                    "model": model or "llama3",
                    "messages": [
                        {"role": "system", "content": system_instructions},
                        {"role": "user", "content": prompt}
                    ],
                    "stream": False
                }
                res = requests.post(ollama_url, json=payload, timeout=5)
                if res.ok:
                    generated_text = res.json().get("message", {}).get("content", "")
                    # Strip any markdown wrappers
                    generated_text = self._strip_markdown(generated_text)
                    return {"status": "success", "content": generated_text, "source": "ollama"}
            except Exception as e:
                logger.info(f"Ollama local fallback skipped or failed: {e}")

            # Smart offline generator fallback!
            return {
                "status": "success",
                "content": self._offline_smart_fallback(prompt, pipeline_type),
                "source": "offline-rule-compiler",
                "warning": "No cloud API Key provided and local Ollama is offline. Serving template boilerplate."
            }

        # Cloud API Providers
        try:
            if provider == "openai":
                url = "https://api.openai.com/v1/chat/completions"
                headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                model_name = model or "gpt-4o-mini"
                payload = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_instructions},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2
                }
                res = requests.post(url, json=payload, headers=headers, timeout=20)
                res.raise_for_status()
                generated_text = res.json()["choices"][0]["message"]["content"]
                return {"status": "success", "content": self._strip_markdown(generated_text), "source": "openai"}
                
            elif provider == "anthropic":
                # Anthropic Claude console API
                url = "https://api.anthropic.com/v1/messages"
                headers = {
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json"
                }
                model_name = model or "claude-3-5-haiku-20241022"
                payload = {
                    "model": model_name,
                    "max_tokens": 1500,
                    "system": system_instructions,
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2
                }
                res = requests.post(url, json=payload, headers=headers, timeout=20)
                res.raise_for_status()
                generated_text = res.json()["content"][0]["text"]
                return {"status": "success", "content": self._strip_markdown(generated_text), "source": "anthropic"}
                
            else:
                return {"status": "failed", "error_msg": f"Unsupported AI provider: {provider}"}
                
        except Exception as e:
            return {"status": "failed", "error_msg": str(e)}

    def _strip_markdown(self, text: str) -> str:
        """Removes enclosing ```python or ```sql blocks from outputs."""
        lines = text.strip().splitlines()
        # If starts with code block marker, pop first & last
        if lines and (lines[0].startswith("```python") or lines[0].startswith("```sql") or lines[0].startswith("```")):
            lines.pop(0)
            if lines and lines[-1].strip() == "```":
                lines.pop()
        return "\n".join(lines).strip()

    def _offline_smart_fallback(self, prompt: str, pipeline_type: str) -> str:
        words = prompt.lower()
        if pipeline_type == "python":
            # Match keywords
            conn_name = "local_db"
            if "rest" in words or "api" in words:
                return (
                    "from soverdata import context\n"
                    "import pandas as pd\n\n"
                    "# Python REST Ingestion Pipeline crafted Offline\n"
                    "print('Connecting to REST gateway...')\n"
                    "df = context.ingest_rest('rest_api_connection', endpoint='/data')\n\n"
                    "# Basic cleans\n"
                    "df.columns = [c.lower() for c in df.columns]\n\n"
                    "print('Writing parsed dataset into bronze tier...')\n"
                    "context.write_delta(df, 'bronze', 'api_table')\n"
                )
            else:
                # database / file ingest
                table_target = "customers"
                if "sales" in words or "order" in words:
                    table_target = "orders"
                return (
                    "from soverdata import context\n"
                    "import pandas as pd\n\n"
                    "# Python DB Ingestion Pipeline crafted Offline\n"
                    "print('Connecting to sources database...')\n"
                    f"df = context.read_sql('SELECT * FROM {table_target}', '{conn_name}')\n\n"
                    "# Perform custom business logic transformations\n"
                    "df['ingested_at'] = pd.Timestamp.now().isoformat()\n\n"
                    f"print('Writing to bronze medallion lakehouse table: {table_target}...')\n"
                    f"context.write_delta(df, 'bronze', '{table_target}')\n"
                    "print('Pipeline complete!')\n"
                )
        else:
            # SQL transform fallback
            target = "silver_enriched_sales"
            if "gold" in words:
                target = "gold_kpi_dashboard"
                return (
                    f"-- target: gold.{target}\n"
                    "-- Gold aggregated performance metrics\n"
                    "SELECT \n"
                    "    country,\n"
                    "    COUNT(customer_id) AS active_accounts,\n"
                    "    SUM(total_spent) AS gross_gmv\n"
                    "FROM silver.sales_summary\n"
                    "GROUP BY country\n"
                    "ORDER BY gross_gmv DESC;\n"
                )
            return (
                f"-- target: silver.{target}\n"
                "-- Multi-stage join query formulated offline\n"
                "SELECT \n"
                "    o.id AS order_id,\n"
                "    o.customer_id,\n"
                "    c.name AS customer_name,\n"
                "    o.amount,\n"
                "    o.order_date\n"
                "FROM bronze.orders o\n"
                "LEFT JOIN bronze.customers c ON o.customer_id = c.id;\n"
            )
