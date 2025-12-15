"""
Checkpoint Manager - Manages execution checkpoints for planner validation
"""

import logging
from typing import Dict, Any, List, Optional, Set

logger = logging.getLogger(__name__)

class CheckpointManager:
    """
    Manages checkpoints during plan execution.
    At checkpoints, execution pauses and sends intermediate results to planner for validation.
    """
    
    # Tools that trigger checkpoints (require validation)
    CHECKPOINT_TOOLS: Set[str] = {
        'generate_chart_tool',
        'generate_html_file_tool',
        'generate_pdf_tool',
        'upload_file_tool',
        'analyze_portfolio_performance'
    }
    
    def __init__(self):
        """Initialize checkpoint manager"""
        self.checkpoints_enabled = True
        logger.info("CheckpointManager initialized")
    
    def should_checkpoint(self, tool_name: str, step_num: int, total_steps: int) -> bool:
        """
        Determine if execution should checkpoint after this tool.
        
        Args:
            tool_name: Name of the tool that just executed
            step_num: Current step number
            total_steps: Total number of steps in plan
            
        Returns:
            True if should checkpoint, False otherwise
        """
        if not self.checkpoints_enabled:
            return False
        
        # Checkpoint on specific tools
        if tool_name in self.CHECKPOINT_TOOLS:
            return True
        
        # Checkpoint at mid-point of long plans (5+ steps)
        if total_steps >= 5 and step_num == (total_steps // 2):
            return True
        
        return False
    
    def create_checkpoint_data(self, step_num: int, tool_name: str, tool_result: Any, 
                               results: Dict[str, Any], plan: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create checkpoint data to send to planner for validation.
        
        Args:
            step_num: Step number that just completed
            tool_name: Name of tool that executed
            tool_result: Result from tool execution
            results: All results so far
            plan: Original plan
            
        Returns:
            Checkpoint data dictionary
        """
        checkpoint = {
            "checkpoint_type": "intermediate_validation",
            "step_number": step_num,
            "tool_name": tool_name,
            "tool_result": self._format_result_for_planner(tool_result),
            "execution_summary": {
                "steps_completed": step_num,
                "total_steps": len(plan.get('steps', [])),
                "steps_remaining": len(plan.get('steps', [])) - step_num
            },
            "available_results": self._summarize_results(results),
            "next_steps": plan.get('steps', [])[step_num:] if step_num < len(plan.get('steps', [])) else []
        }
        
        return checkpoint
    
    def _format_result_for_planner(self, tool_result: Any) -> Dict[str, Any]:
        """
        Format tool result for planner consumption.
        Extracts key information and S3 keys.
        """
        import json
        
        formatted = {
            "type": type(tool_result).__name__,
            "raw": str(tool_result)[:500] if len(str(tool_result)) > 500 else str(tool_result)
        }
        
        # Try to extract structured data
        if isinstance(tool_result, str):
            try:
                parsed = json.loads(tool_result)
                if isinstance(parsed, dict):
                    formatted["parsed"] = parsed
                    # Extract S3 keys for easy access
                    if 's3_key' in parsed:
                        formatted["s3_key"] = parsed['s3_key']
                    if 'file_reference' in parsed and isinstance(parsed['file_reference'], dict):
                        if 's3_key' in parsed['file_reference']:
                            formatted["s3_key"] = parsed['file_reference']['s3_key']
            except (json.JSONDecodeError, ValueError):
                pass
        
        return formatted
    
    def _summarize_results(self, results: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Summarize all results so far for planner review.
        """
        summary = []
        
        for i, result in enumerate(results.get('results', []), 1):
            summary.append({
                "step": i,
                "tool": result.get('tool', 'unknown'),
                "status": result.get('status', 'unknown'),
                "has_s3_key": 's3_key' in str(result.get('result', '')),
                "result_preview": str(result.get('result', ''))[:200]
            })
        
        return summary

