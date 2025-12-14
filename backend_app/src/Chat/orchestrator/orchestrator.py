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
                # Resolve placeholders in parameters using previous step results
                parameters = self._resolve_placeholders(parameters, results, step_num)
                
                # Report tool starting
                self.status_reporter.report_tool_starting(
                    tool_name, parameters, session_id, user_id, message_id, step_num, len(steps)
                )
                
                # Execute tool
                tool_result = self.tool_executor.execute_tool(tool_name, parameters, session_id, user_id)
                
                # Check if result needs storage (either explicitly requested or if result is large)
                should_store = step.get('store_result', False) or self._is_large_result(tool_result)
                
                if should_store:
                    try:
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
                    except ValueError as e:
                        # S3 bucket not configured - continue without storing
                        logger.warning(f"S3 storage not available for step {step_num}, continuing without storage: {str(e)}")
                        
                        # Report completion without file reference
                        self.status_reporter.report_tool_completed(
                            tool_name, "Completed successfully (data not stored - S3 not configured)", 
                            session_id, user_id, message_id, step_num, len(steps)
                        )
                        
                        # Store result directly (even though it's large, we have no choice)
                        results['results'].append({
                            'step': step_num,
                            'tool': tool_name,
                            'status': 'completed',
                            'result': tool_result,
                            'storage_warning': 'S3 bucket not configured, result not stored'
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
        
        # Set final status
        if results['steps_failed'] == 0:
            results['status'] = 'completed'
        elif results['steps_completed'] > 0:
            results['status'] = 'partial'
        else:
            results['status'] = 'failed'
        
        # Create structured summary for Reasoning LLM
        summary = self._create_execution_summary(plan, results)
        results['summary'] = summary
        
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
    
    def _resolve_placeholders(self, parameters: Dict[str, Any], results: Dict[str, Any], current_step: int) -> Dict[str, Any]:
        """
        Resolve placeholders in parameters using results from previous steps.
        
        Supports placeholders like:
        - {{step_1.result}} - result from step 1
        - {{step_2.s3_key}} - s3_key from file_reference in step 2
        - {{portfolio_tickers_from_step_1}} - extract specific field from step 1 result
        
        Args:
            parameters: Parameters dictionary that may contain placeholders
            results: Execution results from previous steps
            current_step: Current step number (1-indexed)
            
        Returns:
            Parameters with placeholders resolved
        """
        import json
        import re
        
        def resolve_value(value):
            """Recursively resolve placeholders in a value"""
            if isinstance(value, str):
                # Find all placeholders like {{step_N.field}} or {{field_from_step_N}}
                placeholder_pattern = r'\{\{([^}]+)\}\}'
                matches = re.findall(placeholder_pattern, value)
                
                if not matches:
                    return value
                
                resolved_value = value
                for placeholder in matches:
                    placeholder = placeholder.strip()
                    
                    # Try to extract step number and field
                    # Pattern 1: {{step_N.field}} or {{step_N.result}}
                    step_match = re.match(r'step[_\s]*(\d+)[._]?(.*)', placeholder, re.IGNORECASE)
                    if step_match:
                        step_num = int(step_match.group(1))
                        field = step_match.group(2).strip() if step_match.group(2) else 'result'
                        
                        if step_num < current_step:
                            # Get result from previous step
                            step_result = None
                            for result in results.get('results', []):
                                if result.get('step') == step_num:
                                    step_result = result
                                    break
                            
                            if step_result:
                                # Extract field from result
                                if field == 'result' and 'result' in step_result:
                                    replacement = step_result['result']
                                elif field == 's3_key' and 'file_reference' in step_result:
                                    replacement = step_result['file_reference'].get('s3_key', '')
                                elif field in step_result:
                                    replacement = step_result[field]
                                else:
                                    # Try to extract from nested result
                                    if 'result' in step_result and isinstance(step_result['result'], dict):
                                        replacement = step_result['result'].get(field, '')
                                    else:
                                        logger.warning(f"Could not resolve placeholder {{step_{step_num}.{field}}}")
                                        replacement = ''
                                
                                # Convert replacement to string if needed
                                if not isinstance(replacement, str):
                                    replacement = json.dumps(replacement) if replacement else ''
                                
                                # Replace placeholder
                                resolved_value = resolved_value.replace(f'{{{{{placeholder}}}}}', str(replacement))
                                continue
                    
                    # Pattern 2: {{field_from_step_N}} - extract field from step N result
                    field_match = re.match(r'(.+?)[_\s]+from[_\s]+step[_\s]*(\d+)', placeholder, re.IGNORECASE)
                    if field_match:
                        field_name = field_match.group(1).strip()
                        step_num = int(field_match.group(2))
                        
                        if step_num < current_step:
                            # Get result from previous step
                            step_result = None
                            for result in results.get('results', []):
                                if result.get('step') == step_num:
                                    step_result = result
                                    break
                            
                            if step_result and 'result' in step_result:
                                result_data = step_result['result']
                                
                                # Try to extract field from result
                                if isinstance(result_data, dict):
                                    # Look for field in result dict
                                    replacement = result_data.get(field_name, '')
                                    
                                    # If not found, try common variations
                                    if not replacement:
                                        # Try extracting portfolio tickers from context
                                        if 'portfolio' in field_name.lower() or 'ticker' in field_name.lower():
                                            # Look for tickers in context items or session context
                                            if isinstance(result_data, dict):
                                                # Check context_items array
                                                context_items = result_data.get('context_items', [])
                                                for item in context_items:
                                                    if isinstance(item, dict):
                                                        tickers = item.get('tickers', item.get('symbols', item.get('ticker', [])))
                                                        if tickers:
                                                            if isinstance(tickers, list):
                                                                replacement = ','.join(str(t) for t in tickers)
                                                            else:
                                                                replacement = str(tickers)
                                                            break
                                                
                                                # If still not found, check for portfolio data in other fields
                                                if not replacement:
                                                    # Check for portfolio in session_variables or other fields
                                                    portfolio_data = result_data.get('portfolio', result_data.get('holdings', []))
                                                    if portfolio_data and isinstance(portfolio_data, list):
                                                        tickers = [item.get('ticker', item.get('symbol', '')) for item in portfolio_data if isinstance(item, dict)]
                                                        tickers = [t for t in tickers if t]
                                                        if tickers:
                                                            replacement = ','.join(tickers)
                                                    
                                                    # Also check files for portfolio CSV
                                                    files = result_data.get('files', [])
                                                    for file_info in files:
                                                        if isinstance(file_info, dict) and 'portfolio' in file_info.get('filename', '').lower():
                                                            # Could read file, but for now just note it exists
                                                            pass
                                    
                                    if not isinstance(replacement, str):
                                        replacement = json.dumps(replacement) if replacement else ''
                                    
                                    resolved_value = resolved_value.replace(f'{{{{{placeholder}}}}}', str(replacement))
                                    continue
                    
                    # If no pattern matched, log warning
                    logger.warning(f"Could not resolve placeholder: {{{{placeholder}}}}")
                
                return resolved_value
            elif isinstance(value, dict):
                # Recursively resolve placeholders in dict values
                return {k: resolve_value(v) for k, v in value.items()}
            elif isinstance(value, list):
                # Recursively resolve placeholders in list items
                return [resolve_value(item) for item in value]
            else:
                return value
        
        # Resolve all placeholders in parameters
        resolved_params = resolve_value(parameters)
        return resolved_params
    
    def _create_execution_summary(self, plan: Dict[str, Any], results: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a structured summary of the execution for the Reasoning LLM.
        
        Args:
            plan: The original execution plan
            results: Execution results from execute_plan
            
        Returns:
            Structured summary with task_completed, file_references, key_results, table, notes
        """
        import json
        
        # Extract task description from plan
        task_completed = plan.get('query', 'Task execution completed')
        
        # Format file references
        file_references = []
        for file_ref in results.get('file_references', []):
            file_references.append({
                'filename': file_ref.get('filename', 'Unknown'),
                's3_key': file_ref.get('s3_key', ''),
                'type': self._infer_file_type(file_ref.get('filename', '')),
                'description': self._generate_file_description(file_ref, results),
                'size_bytes': file_ref.get('size_bytes', 0),
                'stored_at': file_ref.get('stored_at', '')
            })
        
        # Extract key results from execution
        key_results = {}
        table = []
        notes = []
        
        # Process step results to extract key data
        for step_result in results.get('results', []):
            if step_result.get('status') == 'completed':
                tool_name = step_result.get('tool', '')
                
                # Extract key metrics from results
                if 'result' in step_result:
                    result_data = step_result['result']
                    key_results.update(self._extract_key_metrics(tool_name, result_data))
                    
                    # Create table rows for tabular data
                    table_rows = self._extract_table_data(tool_name, result_data)
                    if table_rows:
                        table.extend(table_rows)
                
                # Add notes about what was accomplished
                if 'file_reference' in step_result:
                    file_ref = step_result['file_reference']
                    notes.append(f"Generated {file_ref.get('filename', 'file')} using {tool_name}")
                else:
                    notes.append(f"Completed {tool_name} successfully")
        
        # Add execution summary notes
        if results['status'] == 'completed':
            notes.insert(0, f"Successfully completed {results['steps_completed']} step(s)")
        elif results['status'] == 'partial':
            notes.insert(0, f"Completed {results['steps_completed']} of {results['steps_completed'] + results['steps_failed']} steps")
        else:
            notes.insert(0, f"Execution failed: {results['steps_failed']} step(s) failed")
        
        # Create summary structure
        summary = {
            'task_completed': task_completed,
            'file_references': file_references,
            'key_results': key_results,
            'table': table,
            'notes': notes,
            'execution_status': results['status'],
            'steps_completed': results['steps_completed'],
            'steps_failed': results['steps_failed']
        }
        
        return summary
    
    def _infer_file_type(self, filename: str) -> str:
        """Infer file type from filename."""
        if not filename:
            return 'unknown'
        
        filename_lower = filename.lower()
        if filename_lower.endswith('.csv') or filename_lower.endswith('.xlsx') or filename_lower.endswith('.xls'):
            return 'csv'
        elif filename_lower.endswith('.pdf'):
            return 'pdf'
        elif filename_lower.endswith('.json'):
            return 'json'
        elif filename_lower.endswith('.txt') or filename_lower.endswith('.md'):
            return 'text'
        elif filename_lower.endswith('.png') or filename_lower.endswith('.jpg') or filename_lower.endswith('.jpeg'):
            return 'image'
        else:
            return 'unknown'
    
    def _generate_file_description(self, file_ref: Dict[str, Any], results: Dict[str, Any]) -> str:
        """Generate a description for a file reference."""
        tool_name = file_ref.get('tool_name', '')
        filename = file_ref.get('filename', '')
        
        # Tool-specific descriptions
        if 'portfolio' in filename.lower() or 'performance' in filename.lower():
            return "Portfolio performance analysis and metrics"
        elif 'chart' in filename.lower() or 'graph' in filename.lower():
            return "Visualization chart or graph"
        elif 'report' in filename.lower():
            return "Analysis report"
        elif tool_name == 'generate_excel_file_tool':
            return "Financial data spreadsheet"
        elif tool_name == 'generate_agent_file_tool':
            return "Generated analysis document"
        else:
            return f"Output from {tool_name}"
    
    def _extract_key_metrics(self, tool_name: str, result_data: Any) -> Dict[str, Any]:
        """Extract key metrics from tool results."""
        key_metrics = {}
        
        try:
            # Handle string results that might be JSON
            if isinstance(result_data, str):
                try:
                    import json
                    result_data = json.loads(result_data)
                except:
                    pass
            
            # Extract metrics based on tool type
            if tool_name == 'python_financial_calculator':
                # Try to extract common financial metrics
                if isinstance(result_data, dict):
                    for key in ['cagr', 'volatility', 'sharpe', 'max_drawdown', 'return', 'correlation']:
                        if key in result_data:
                            key_metrics[key] = result_data[key]
            
            elif tool_name in ['get_financial_data', 'get_multiple_financial_data']:
                # Extract price data summary
                if isinstance(result_data, dict):
                    if 'data' in result_data:
                        data = result_data['data']
                        if isinstance(data, list) and len(data) > 0:
                            key_metrics['data_points'] = len(data)
                            if 'close' in str(data[0]):
                                key_metrics['has_price_data'] = True
            
            elif tool_name == 'generate_chart_tool':
                key_metrics['chart_generated'] = True
            
            # Generic extraction for dict results
            if isinstance(result_data, dict):
                # Look for common metric keys
                metric_keys = ['value', 'result', 'output', 'metric', 'score', 'ratio', 'percentage']
                for key in metric_keys:
                    if key in result_data:
                        key_metrics[key] = result_data[key]
        
        except Exception as e:
            logger.debug(f"Error extracting key metrics: {str(e)}")
        
        return key_metrics
    
    def _extract_table_data(self, tool_name: str, result_data: Any) -> List[Dict[str, Any]]:
        """Extract tabular data from tool results."""
        table_rows = []
        
        try:
            # Handle string results that might be JSON
            if isinstance(result_data, str):
                try:
                    import json
                    result_data = json.loads(result_data)
                except:
                    return table_rows
            
            # Extract table data based on tool type
            if tool_name == 'python_financial_calculator':
                # Try to extract comparison data (portfolio vs benchmark)
                if isinstance(result_data, dict):
                    # Look for comparison metrics
                    if 'portfolio' in str(result_data) and 'benchmark' in str(result_data):
                        for key in result_data:
                            if isinstance(result_data[key], dict):
                                if 'portfolio' in result_data[key] and 'benchmark' in result_data[key]:
                                    table_rows.append({
                                        'metric': key.replace('_', ' ').title(),
                                        'portfolio': result_data[key].get('portfolio', 'N/A'),
                                        'benchmark': result_data[key].get('benchmark', 'N/A')
                                    })
            
            # Generic table extraction for list of dicts
            if isinstance(result_data, list):
                for item in result_data[:10]:  # Limit to first 10 rows
                    if isinstance(item, dict):
                        table_rows.append(item)
        
        except Exception as e:
            logger.debug(f"Error extracting table data: {str(e)}")
        
        return table_rows

