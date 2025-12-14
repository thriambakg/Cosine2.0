"""
Orchestrator - Deterministic execution system
Executes plans created by the planner
"""

import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

class Orchestrator:
    """
    Deterministic orchestrator that executes plans step-by-step.
    No LLM calls - purely deterministic execution.
    """
    
    def __init__(self, tool_executor, data_storage, status_reporter):
        """
        Initialize the orchestrator.
        
        Args:
            tool_executor: ToolExecutor instance for executing tools
            data_storage: DataStorage instance for storing large data
            status_reporter: StatusReporter instance for WebSocket status updates
        """
        self.tool_executor = tool_executor
        self.data_storage = data_storage
        self.status_reporter = status_reporter
        logger.info("Orchestrator initialized")
    
    def execute_plan(self, plan: Dict[str, Any], session_id: str, user_id: str, message_id: str) -> Dict[str, Any]:
        """
        Execute an execution plan step-by-step.
        
        Args:
            plan: The execution plan to execute
            session_id: Session ID for status reporting
            user_id: User ID for status reporting
            message_id: Message ID for status reporting
            
        Returns:
            Execution results with file references for large data
        """
        logger.info(f"Executing plan with {len(plan.get('steps', []))} steps")
        
        results = {
            'plan_id': plan.get('plan_id', 'unknown'),
            'steps_completed': 0,
            'steps_failed': 0,
            'results': [],
            'file_references': []
        }
        
        steps = plan.get('steps', [])
        
        for i, step in enumerate(steps):
            step_num = i + 1
            tool_name = step.get('tool')
            parameters = step.get('parameters', {})
            
            logger.info(f"Executing step {step_num}/{len(steps)}: {tool_name}")
            
            try:
                # Report tool starting
                self.status_reporter.report_tool_starting(
                    tool_name, parameters, session_id, user_id, message_id, step_num, len(steps)
                )
                
                # Execute tool
                tool_result = self.tool_executor.execute_tool(tool_name, parameters, session_id, user_id)
                
                # Check if result is large and needs storage
                if self._is_large_result(tool_result):
                    # Store in S3 and return file reference
                    file_reference = self.data_storage.store_result(
                        tool_result, tool_name, session_id, user_id
                    )
                    results['file_references'].append(file_reference)
                    
                    # Report completion with file reference
                    self.status_reporter.report_tool_completed(
                        tool_name, f"Data stored in {file_reference['filename']}", 
                        session_id, user_id, message_id, step_num, len(steps)
                    )
                    
                    results['results'].append({
                        'step': step_num,
                        'tool': tool_name,
                        'status': 'completed',
                        'file_reference': file_reference
                    })
                else:
                    # Return result directly (small data)
                    self.status_reporter.report_tool_completed(
                        tool_name, "Completed successfully", 
                        session_id, user_id, message_id, step_num, len(steps)
                    )
                    
                    results['results'].append({
                        'step': step_num,
                        'tool': tool_name,
                        'status': 'completed',
                        'result': tool_result
                    })
                
                results['steps_completed'] += 1
                
            except Exception as e:
                logger.error(f"Step {step_num} failed: {str(e)}")
                
                # Report failure
                self.status_reporter.report_tool_failed(
                    tool_name, str(e), session_id, user_id, message_id, step_num, len(steps)
                )
                
                results['results'].append({
                    'step': step_num,
                    'tool': tool_name,
                    'status': 'failed',
                    'error': str(e)
                })
                
                results['steps_failed'] += 1
                
                # Decide whether to continue or stop on error
                if step.get('critical', False):
                    logger.error(f"Critical step {step_num} failed, stopping execution")
                    break
        
        logger.info(f"Plan execution completed: {results['steps_completed']} succeeded, {results['steps_failed']} failed")
        return results
    
    def _is_large_result(self, result: Any) -> bool:
        """
        Check if a result is large enough to require S3 storage.
        
        Args:
            result: Tool result to check
            
        Returns:
            True if result should be stored in S3
        """
        # Threshold: 10KB (10,000 characters)
        LARGE_RESULT_THRESHOLD = 10000
        
        if isinstance(result, str):
            return len(result) > LARGE_RESULT_THRESHOLD
        elif isinstance(result, dict):
            import json
            result_str = json.dumps(result)
            return len(result_str) > LARGE_RESULT_THRESHOLD
        elif isinstance(result, (list, tuple)):
            import json
            result_str = json.dumps(result)
            return len(result_str) > LARGE_RESULT_THRESHOLD
        
        return False

