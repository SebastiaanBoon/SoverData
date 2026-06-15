import threading
import time
import logging
from datetime import datetime, timedelta
from croniter import croniter
from server.orchestrator.runner import PipelineRunner
from server.workspace.manager import WorkspaceManager

logger = logging.getLogger(__name__)

class BackgroundScheduler:
    def __init__(self, workspace_path: str):
        self.workspace_path = workspace_path
        self.workspace_manager = WorkspaceManager(workspace_path)
        self.runner = PipelineRunner(workspace_path)
        self.thread = None
        self.is_running = False
        self.last_runs = {} # track { (pipeline_name, pipeline_type): datetime }

    def start(self):
        """Starts the background scheduling thread."""
        if self.is_running:
            return
        self.is_running = True
        self.thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self.thread.start()
        logger.info("Background pipeline scheduler started.")

    def stop(self):
        """Stops the background scheduling thread."""
        self.is_running = False
        if self.thread:
            self.thread.join(timeout=2.0)
        logger.info("Background pipeline scheduler stopped.")

    def _scheduler_loop(self):
        """Loop that runs every 5 seconds to check if any pipelines are due to run."""
        while self.is_running:
            try:
                # Reload workspace config to fetch schedules dynamically (editor/UI-friendly!)
                config = self.workspace_manager.get_config()
                schedules = config.get("schedules", [])
                
                now = datetime.utcnow()
                
                for sched in schedules:
                    if not sched.get("enabled", True):
                        continue
                        
                    pipeline_name = sched.get("pipeline_name")
                    pipeline_type = sched.get("pipeline_type")
                    cron_expr = sched.get("cron")
                    interval_sec = sched.get("interval_seconds")
                    
                    if not pipeline_name or not pipeline_type:
                        continue
                        
                    # Check if standard CRON schedule matches
                    should_run = False
                    key = (pipeline_name, pipeline_type)
                    last_run = self.last_runs.get(key)
                    
                    if cron_expr:
                        try:
                            # Calculate next run time using croniter
                            # Check if current time is equal or past the expected run time
                            # We evaluate croniter from a reference start or the last run
                            ref_time = last_run if last_run else (now - timedelta(minutes=10))
                            iter_cron = croniter(cron_expr, ref_time)
                            next_run = iter_cron.get_next(datetime)
                            if now >= next_run:
                                should_run = True
                        except Exception as e:
                            logger.error(f"Error parsing cron expression '{cron_expr}' for pipeline '{pipeline_name}': {e}")
                    elif interval_sec:
                        if not last_run or (now - last_run).total_seconds() >= interval_sec:
                            should_run = True
                            
                    if should_run:
                        self.last_runs[key] = now
                        logger.info(f"Scheduler triggering scheduled pipeline {pipeline_name} ({pipeline_type})")
                        # Run the pipeline in a separate thread so it doesn't block the main scheduler loop
                        threading.Thread(
                            target=self._run_task_wrapper,
                            args=(pipeline_name, pipeline_type),
                            daemon=True
                        ).start()
                        
            except Exception as e:
                logger.error(f"Error in scheduler loop: {e}")
                
            time.sleep(5)

    def _run_task_wrapper(self, pipeline_name: str, pipeline_type: str):
        try:
            self.runner.run_pipeline(pipeline_name, pipeline_type)
        except Exception as e:
            logger.error(f"Error executing pipeline {pipeline_name} in scheduler wrapper: {e}")
