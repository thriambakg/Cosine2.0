"""
Orchestrator - Executes deterministic plans step-by-step
"""

import logging
import json
from typing import Dict, Any, List

logger = logging.getLogger(__name__)


class Orchestrator:
    """
    Deterministic orchestrator that executes plans step-by-step.
    No LLM calls - purely deterministic execution.
    """
    
    def __init__(self, tool_executor, data_storage):
        """
        Initialize the orchestrator.
        
        Args:
            tool_executor: ToolExecutor instance
            data_storage: DataStorage instance for S3 operations
        """
        self.tool_executor = tool_executor
        self.data_storage = data_storage
        logger.info("Orchestrator initialized")
    
    def execute_plan(self, plan: Dict[str, Any], session_id: str, user_id: str) -> Dict[str, Any]:
        """
        Execute an execution plan step-by-step.
        
        Args:
            plan: The execution plan
            session_id: Session ID
            user_id: User ID
            
        Returns:
            Execution results
        """
        logger.info(f"Executing plan with {len(plan.get('steps', []))} steps")
        
        results = {
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
                # Resolve placeholders in parameters
                parameters = self._resolve_placeholders(parameters, results, step_num)
                
                # Execute tool
                tool_result = self.tool_executor.execute_tool(tool_name, parameters, session_id, user_id)
                
                # Check if result needs storage
                should_store = step.get('store_result', False) or self._is_large_result(tool_result)
                
                if should_store:
                    # Store in S3
                    file_reference = self.data_storage.store_result(
                        tool_result, tool_name, session_id, user_id
                    )
                    results['file_references'].append(file_reference)
                    
                    results['results'].append({
                        'step': step_num,
                        'tool': tool_name,
                        'status': 'completed',
                        'file_reference': file_reference
                    })
                else:
                    # Return result directly
                    results['results'].append({
                        'step': step_num,
                        'tool': tool_name,
                        'status': 'completed',
                        'result': tool_result
                    })
                
                results['steps_completed'] += 1
                
            except Exception as e:
                logger.error(f"Step {step_num} failed: {str(e)}")
                results['results'].append({
                    'step': step_num,
                    'tool': tool_name,
                    'status': 'failed',
                    'error': str(e)
                })
                results['steps_failed'] += 1
                
                # Stop on critical failures
                if step.get('critical', False):
                    break
        
        # Create summary
        results['summary'] = self._create_summary(plan, results)
        
        return results
    
    def _resolve_placeholders(self, parameters: Dict[str, Any], results: Dict[str, Any], current_step: int) -> Dict[str, Any]:
        """Resolve placeholders like {{step_1.result}} in parameters"""
        import re
        
        def resolve_value(value):
            if isinstance(value, str):
                # Find placeholders like {{step_N.result}}
                placeholder_pattern = r'\{\{step_(\d+)\.result\}\}'
                matches = re.findall(placeholder_pattern, value)
                
                for step_num_str in matches:
                    step_num = int(step_num_str)
                    if step_num < current_step:
                        # Get result from previous step
                        for result in results.get('results', []):
                            if result.get('step') == step_num:
                                if 'file_reference' in result:
                                    # Return S3 key for file references
                                    return result['file_reference'].get('s3_key', '')
                                elif 'result' in result:
                                    return result['result']
                                break
                
                return value
            elif isinstance(value, dict):
                return {k: resolve_value(v) for k, v in value.items()}
            elif isinstance(value, list):
                return [resolve_value(item) for item in value]
            else:
                return value
        
        return resolve_value(parameters)
    
    def _is_large_result(self, result: Any) -> bool:
        """Check if result is large enough to require S3 storage"""
        if isinstance(result, str):
            return len(result) > 10000  # 10KB threshold
        return False
    
    def _create_summary(self, plan: Dict[str, Any], results: Dict[str, Any]) -> Dict[str, Any]:
        """Create execution summary"""
        return {
            'task': plan.get('query', 'Task completed'),
            'steps_completed': results['steps_completed'],
            'steps_failed': results['steps_failed'],
            'file_references': results['file_references']
        }
