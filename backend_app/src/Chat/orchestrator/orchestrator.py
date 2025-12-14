"""
Orchestrator - Deterministic execution system
Executes plans created by the planner
"""

import logging
import re
import json
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
                logger.debug(f"Resolving placeholders for step {step_num}, parameters before resolution: {parameters}")
                parameters = self._resolve_placeholders(parameters, results, step_num)
                logger.debug(f"Parameters after resolution: {parameters}")
                
                # Check if any placeholders failed to resolve (empty string values that should have been replaced)
                unresolved_placeholders = []
                missing_required_params = []
                
                # Get tool function signature to check required parameters
                try:
                    import inspect
                    tool_func = self.tool_executor._get_tool_function(tool_name)
                    sig = inspect.signature(tool_func)
                    
                    for key, value in parameters.items():
                        param = sig.parameters.get(key)
                        is_required = param and param.default == inspect.Parameter.empty
                        
                        if isinstance(value, str):
                            # Check for unresolved placeholder patterns
                            if re.search(r'\{\{?step[_\s]*\d+[._].*\}\}?', value):
                                unresolved_placeholders.append(f"{key}={value}")
                                if is_required:
                                    missing_required_params.append(key)
                            # Also check if required parameter is empty string (placeholder resolved to empty)
                            elif is_required and value.strip() == '':
                                missing_required_params.append(key)
                                logger.warning(f"Required parameter '{key}' resolved to empty string")
                        elif value is None or value == '':
                            # Check if this is a required parameter
                            if is_required:
                                missing_required_params.append(key)
                                logger.warning(f"Required parameter '{key}' is None or empty")
                    
                    # Check for missing required parameters that weren't provided at all
                    for param_name, param in sig.parameters.items():
                        if param.default == inspect.Parameter.empty and param_name not in parameters:
                            # Skip session_id and user_id as they're added automatically
                            if param_name not in ['session_id', 'user_id']:
                                missing_required_params.append(param_name)
                except Exception as e:
                    logger.warning(f"Could not check tool signature for {tool_name}: {e}")
                
                if unresolved_placeholders:
                    logger.warning(f"Unresolved placeholders in step {step_num}: {unresolved_placeholders}")
                
                if missing_required_params:
                    error_msg = f"Step {step_num} failed: Missing required parameters: {', '.join(missing_required_params)}"
                    if unresolved_placeholders:
                        error_msg += f" (unresolved placeholders: {', '.join(unresolved_placeholders)})"
                    logger.error(error_msg)
                    raise ValueError(error_msg)
                
                # Report tool starting
                self.status_reporter.report_tool_starting(
                    tool_name, parameters, session_id, user_id, message_id, step_num, len(steps)
                )
                
                # Execute tool
                tool_result = self.tool_executor.execute_tool(tool_name, parameters, session_id, user_id)
                
                # Check if tool_result is a JSON string that contains a file_reference (from get_multiple_financial_data)
                # If so, extract the actual data file's S3 key for easier placeholder resolution
                actual_data_s3_key = None
                if isinstance(tool_result, str):
                    try:
                        parsed_result = json.loads(tool_result)
                        if isinstance(parsed_result, dict) and 'file_reference' in parsed_result:
                            file_ref = parsed_result.get('file_reference', {})
                            if isinstance(file_ref, dict) and 's3_key' in file_ref:
                                # This is the actual data file's S3 key
                                actual_data_s3_key = file_ref.get('s3_key')
                    except:
                        pass
                
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
                        
                        # Store both the orchestrator's file_reference and the actual data file's S3 key
                        result_entry = {
                            'step': step_num,
                            'tool': tool_name,
                            'status': 'completed',
                            'file_reference': file_reference
                        }
                        # If we found an actual data file S3 key, store it for easier placeholder resolution
                        if actual_data_s3_key:
                            result_entry['actual_data_s3_key'] = actual_data_s3_key
                        
                        results['results'].append(result_entry)
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
                # Find all placeholders like {{step_N.field}} or {step_N.field} or {{field_from_step_N}}
                # Support both {{...}} and {...} formats
                placeholder_pattern = r'\{\{?([^}]+)\}\}?'
                matches = re.findall(placeholder_pattern, value)
                
                if not matches:
                    return value
                
                resolved_value = value
                for placeholder in matches:
                    placeholder = placeholder.strip()
                    
                    # Try to extract step number and field
                    # Pattern 1: {{step_N.field}} or {{step_N.result}} or {{step_N.result.field}}
                    step_match = re.match(r'step[_\s]*(\d+)[._]?(.*)', placeholder, re.IGNORECASE)
                    if step_match:
                        step_num = int(step_match.group(1))
                        field = step_match.group(2).strip() if step_match.group(2) else 'result'
                        logger.debug(f"Parsed placeholder: step_num={step_num}, field='{field}'")
                        # Handle "result.field" pattern - extract just the field part
                        if field.startswith('result.'):
                            field = field.replace('result.', '', 1)
                            logger.debug(f"Stripped 'result.' prefix, new field='{field}'")
                        replacement = ''  # Initialize replacement at the start
                        
                        if step_num < current_step:
                            # Get result from previous step
                            step_result = None
                            for result in results.get('results', []):
                                if result.get('step') == step_num:
                                    step_result = result
                                    break
                            
                            if step_result:
                                # Extract field from result
                                # Check if we need to read from S3 (when result is stored)
                                needs_s3_read = False
                                s3_key_to_read = None
                                
                                if 'file_reference' in step_result:
                                    s3_key_to_read = step_result['file_reference'].get('s3_key', '')
                                    needs_s3_read = True
                                elif 'actual_data_s3_key' in step_result:
                                    s3_key_to_read = step_result['actual_data_s3_key']
                                    needs_s3_read = True
                                
                                # If field is a nested path (e.g., "result.time_series" or "time_series"), 
                                # we need to read from S3 and extract the nested field
                                if needs_s3_read and ('.' in field or field not in ['result', 's3_key', 'file_reference']):
                                    try:
                                        logger.info(f"Reading from S3 for step {step_num}, field '{field}', s3_key: {s3_key_to_read}")
                                        # Read the actual result from S3
                                        result_data = self.data_storage.retrieve_result({'s3_key': s3_key_to_read})
                                        logger.info(f"Retrieved data from S3, type: {type(result_data)}, keys: {list(result_data.keys()) if isinstance(result_data, dict) else 'Not a dict'}")
                                        
                                        # If field is "result.X", extract X from the result
                                        if field.startswith('result.'):
                                            nested_field = field.replace('result.', '', 1)
                                            logger.info(f"Extracting nested field '{nested_field}' from result")
                                            replacement = self._extract_nested_field(result_data, nested_field)
                                        else:
                                            # Field is directly in the result (e.g., "time_series", "metrics_table")
                                            logger.info(f"Extracting direct field '{field}' from result")
                                            replacement = self._extract_nested_field(result_data, field)
                                        
                                        logger.info(f"Extracted replacement, type: {type(replacement)}, empty: {not replacement if replacement else True}")
                                        
                                        # Convert to JSON string if it's a dict/list
                                        if isinstance(replacement, (dict, list)):
                                            replacement = json.dumps(replacement)
                                            logger.info(f"Converted replacement to JSON string, length: {len(replacement)}")
                                        
                                        if replacement:
                                            # Replace placeholder
                                            placeholder_with_braces = f'{{{{{placeholder}}}}}'
                                            placeholder_single_brace = f'{{{placeholder}}}'
                                            if placeholder_with_braces in resolved_value:
                                                resolved_value = resolved_value.replace(placeholder_with_braces, str(replacement))
                                                logger.info(f"Replaced placeholder {placeholder_with_braces} with data (length: {len(str(replacement))})")
                                            if placeholder_single_brace in resolved_value:
                                                resolved_value = resolved_value.replace(placeholder_single_brace, str(replacement))
                                                logger.info(f"Replaced placeholder {placeholder_single_brace} with data (length: {len(str(replacement))})")
                                            logger.debug(f"Successfully resolved placeholder {placeholder} to field {field}")
                                            continue
                                        else:
                                            logger.warning(f"Field {field} extracted from S3 but is empty or None")
                                    except Exception as e:
                                        logger.error(f"Could not read from S3 or extract field {field}: {e}")
                                        logger.error(f"S3 key attempted: {s3_key_to_read}")
                                        logger.error(f"Step result keys: {list(step_result.keys()) if isinstance(step_result, dict) else 'Not a dict'}")
                                        import traceback
                                        logger.error(f"Traceback: {traceback.format_exc()}")
                                
                                # Handle simple field requests
                                if field == 'result':
                                    # If data was stored in S3, return file_reference or s3_key
                                    # Check for actual_data_s3_key first (from tools that store data themselves)
                                    if 'actual_data_s3_key' in step_result:
                                        replacement = step_result['actual_data_s3_key']
                                    elif 'file_reference' in step_result:
                                        # Return the s3_key so tools can read from S3
                                        replacement = step_result['file_reference'].get('s3_key', '')
                                    elif 'result' in step_result:
                                        replacement = step_result['result']
                                    else:
                                        replacement = ''
                                elif field == 's3_key':
                                    # Check for actual_data_s3_key first (from tools that store data themselves)
                                    if 'actual_data_s3_key' in step_result:
                                        replacement = step_result['actual_data_s3_key']
                                    elif 'file_reference' in step_result:
                                        replacement = step_result['file_reference'].get('s3_key', '')
                                    else:
                                        replacement = ''
                                elif field == 'file_reference' and 'file_reference' in step_result:
                                    replacement = step_result['file_reference']
                                elif field in step_result:
                                    replacement = step_result[field]
                                else:
                                    # Try to extract from nested result
                                    if 'result' in step_result:
                                        result_data = step_result['result']
                                        
                                        # Handle string results (like file content or JSON strings)
                                        if isinstance(result_data, str):
                                            # Try to parse as JSON first
                                            try:
                                                parsed = json.loads(result_data)
                                                if isinstance(parsed, dict):
                                                    # Special handling: if this is a file reference JSON (from get_multiple_financial_data),
                                                    # and we're looking for s3_key or result, extract the actual data file's S3 key
                                                    if field in ['result', 's3_key'] and 'file_reference' in parsed:
                                                        file_ref = parsed.get('file_reference', {})
                                                        if isinstance(file_ref, dict) and 's3_key' in file_ref:
                                                            # This is the actual data file's S3 key
                                                            replacement = file_ref.get('s3_key', '')
                                                            # If we got the s3_key, we're done
                                                            if replacement:
                                                                # Convert replacement to string if needed
                                                                if not isinstance(replacement, str):
                                                                    replacement = json.dumps(replacement) if replacement else ''
                                                                # Replace placeholder
                                                                placeholder_with_braces = f'{{{{{placeholder}}}}}'
                                                                placeholder_single_brace = f'{{{placeholder}}}'
                                                                if placeholder_with_braces in resolved_value:
                                                                    resolved_value = resolved_value.replace(placeholder_with_braces, str(replacement))
                                                                if placeholder_single_brace in resolved_value:
                                                                    resolved_value = resolved_value.replace(placeholder_single_brace, str(replacement))
                                                                continue
                                                    
                                                    # Extract field from parsed JSON (support nested paths)
                                                    replacement = self._extract_nested_field(parsed, field)
                                                    
                                                    # Try common field variations for file S3 keys
                                                    if not replacement and field in ['file_s3_key', 's3_key', 'file_key']:
                                                        # Look in files array
                                                        files = parsed.get('files', [])
                                                        if files and isinstance(files, list) and len(files) > 0:
                                                            # Get first file's S3 key
                                                            first_file = files[0] if isinstance(files[0], dict) else {}
                                                            replacement = first_file.get('s3_key', first_file.get('file_key', ''))
                                                        
                                                        # Also check direct fields
                                                        if not replacement:
                                                            replacement = parsed.get('s3_key', parsed.get('file_key', ''))
                                                    
                                                    # Try portfolio tickers extraction
                                                    if not replacement and ('portfolio' in field.lower() or 'ticker' in field.lower()):
                                                        # Look in files for portfolio CSV
                                                        files = parsed.get('files', [])
                                                        for file_info in files:
                                                            if isinstance(file_info, dict):
                                                                filename = file_info.get('filename', '').lower()
                                                                if 'portfolio' in filename:
                                                                    # This is a portfolio file, return its S3 key for reading
                                                                    replacement = file_info.get('s3_key', '')
                                                                    break
                                                else:
                                                    replacement = ''
                                            except json.JSONDecodeError:
                                                # Not JSON, try to extract from plain text (like get_session_files_tool output)
                                                if field in ['file_s3_key', 's3_key', 'file_key']:
                                                    # Try to extract S3 key from formatted text output
                                                    # Pattern: "S3 Key: files/user_id/session_id/filename"
                                                    s3_key_match = re.search(r'S3 Key:\s*([^\n\r]+)', result_data, re.IGNORECASE)
                                                    if s3_key_match:
                                                        replacement = s3_key_match.group(1).strip()
                                                    else:
                                                        # Try s3:// URL pattern
                                                        s3_key_match = re.search(r's3://[^/\s]+/([^\s]+)', result_data)
                                                        if s3_key_match:
                                                            replacement = s3_key_match.group(1)
                                                        else:
                                                            # Try to find files/ path pattern
                                                            s3_key_match = re.search(r'(files/[^\s\n\r]+)', result_data)
                                                            if s3_key_match:
                                                                replacement = s3_key_match.group(1)
                                                            else:
                                                                replacement = ''
                                                elif 'portfolio' in field.lower() or 'ticker' in field.lower():
                                                    # Try to extract portfolio tickers from text
                                                    # Look for patterns like "tickers: AAPL,MSFT,GOOGL" or similar
                                                    ticker_match = re.search(r'(?:ticker|symbol)[s]?[:\s]+([A-Z,]+)', result_data, re.IGNORECASE)
                                                    if ticker_match:
                                                        replacement = ticker_match.group(1).strip()
                                                    else:
                                                        replacement = ''
                                                else:
                                                    replacement = ''
                                        elif isinstance(result_data, dict):
                                            # Use nested field extraction for dict results too
                                            replacement = self._extract_nested_field(result_data, field)
                                            
                                            # Try common field variations if still not found
                                            if not replacement:
                                                # Try file_s3_key -> s3_key, file_key, etc.
                                                if 'file' in field.lower() and 's3' in field.lower():
                                                    replacement = result_data.get('s3_key', result_data.get('file_key', ''))
                                                # Try portfolio_tickers -> tickers, symbols, etc.
                                                elif 'portfolio' in field.lower() or 'ticker' in field.lower():
                                                    replacement = result_data.get('tickers', result_data.get('symbols', result_data.get('portfolio_tickers', '')))
                                        else:
                                            replacement = ''
                                    
                                    if not replacement:
                                        logger.warning(f"Could not resolve placeholder {{step_{step_num}.{field}}}")
                                        replacement = ''
                            else:
                                # step_result is None - step hasn't completed yet or doesn't exist
                                logger.warning(f"Step {step_num} result not found for placeholder {{step_{step_num}.{field}}}")
                                replacement = ''
                            
                            # Convert replacement to string if needed
                            if not isinstance(replacement, str):
                                replacement = json.dumps(replacement) if replacement else ''
                            
                            # Replace placeholder (handle both {{...}} and {...} formats)
                            placeholder_with_braces = f'{{{{{placeholder}}}}}'
                            placeholder_single_brace = f'{{{placeholder}}}'
                            if placeholder_with_braces in resolved_value:
                                resolved_value = resolved_value.replace(placeholder_with_braces, str(replacement))
                            if placeholder_single_brace in resolved_value:
                                resolved_value = resolved_value.replace(placeholder_single_brace, str(replacement))
                            continue
                    
                    # Pattern 2: {{field_from_step_N}} - extract field from step N result
                    field_match = re.match(r'(.+?)[_\s]+from[_\s]+step[_\s]*(\d+)', placeholder, re.IGNORECASE)
                    if field_match:
                        field_name = field_match.group(1).strip()
                        step_num = int(field_match.group(2))
                        replacement = ''  # Initialize replacement
                        
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
                                    
                                    # Convert replacement to string if needed
                                    if not isinstance(replacement, str):
                                        replacement = json.dumps(replacement) if replacement else ''
                                elif isinstance(result_data, str):
                                    # Try to parse as JSON or extract from text
                                    try:
                                        parsed = json.loads(result_data)
                                        if isinstance(parsed, dict):
                                            replacement = self._extract_nested_field(parsed, field_name)
                                            if not isinstance(replacement, str):
                                                replacement = json.dumps(replacement) if replacement else ''
                                    except:
                                        replacement = ''
                            
                            # Replace placeholder (handle both {{...}} and {...} formats)
                            placeholder_with_braces = f'{{{{{placeholder}}}}}'
                            placeholder_single_brace = f'{{{placeholder}}}'
                            if placeholder_with_braces in resolved_value:
                                resolved_value = resolved_value.replace(placeholder_with_braces, str(replacement))
                            if placeholder_single_brace in resolved_value:
                                resolved_value = resolved_value.replace(placeholder_single_brace, str(replacement))
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
    
    def _extract_nested_field(self, data: Dict[str, Any], field_path: str) -> Any:
        """
        Extract a field from nested dictionary, supporting dot notation and common variations.
        Examples:
        - 'portfolio_time_series' -> data.get('time_series', {}).get('portfolio_values')
        - 'time_series.portfolio_values' -> data.get('time_series', {}).get('portfolio_values')
        - 'portfolio.cagr' -> data.get('portfolio', {}).get('cagr')
        - 'metrics_table' -> data.get('metrics_table')
        """
        if not isinstance(data, dict):
            return ''
        
        # Handle dot notation for nested paths
        if '.' in field_path:
            parts = field_path.split('.')
            current = data
            for part in parts:
                if isinstance(current, dict):
                    current = current.get(part)
                    if current is None:
                        return ''
                else:
                    return ''
            return current
        
        # Direct field access
        replacement = data.get(field_path, '')
        
        # Try common variations for portfolio analysis fields
        if not replacement:
            # portfolio_time_series -> time_series.portfolio_values
            if 'portfolio_time_series' in field_path or 'time_series' in field_path:
                time_series = data.get('time_series', {})
                if isinstance(time_series, dict):
                    replacement = time_series.get('portfolio_values', time_series.get('dates', ''))
            
            # metrics_table -> metrics_table
            elif 'metrics_table' in field_path:
                replacement = data.get('metrics_table', '')
            
            # portfolio.cagr, portfolio.volatility, etc.
            elif field_path in ['cagr', 'volatility', 'max_drawdown', 'sharpe_ratio', 'total_return']:
                portfolio = data.get('portfolio', {})
                if isinstance(portfolio, dict):
                    replacement = portfolio.get(field_path, '')
            
            # rolling_12m_returns
            elif 'rolling' in field_path.lower() or ('returns' in field_path.lower() and '12' in field_path.lower()):
                portfolio = data.get('portfolio', {})
                if isinstance(portfolio, dict):
                    rolling = portfolio.get('rolling_12m_returns', {})
                    if isinstance(rolling, dict):
                        replacement = rolling.get('returns', rolling.get('dates', ''))
        
        return replacement
    
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

