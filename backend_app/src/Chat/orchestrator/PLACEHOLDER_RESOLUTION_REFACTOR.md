# Placeholder Resolution Refactoring Plan

## Current State
The orchestrator currently does extensive JSON parsing and field extraction in `_resolve_placeholders()`. This violates separation of concerns - the orchestrator should only handle file movement, not data parsing.

## New Approach
1. **Orchestrator**: Only passes S3 keys or raw result strings to tools
2. **Tools**: Handle their own JSON parsing when they receive data

## Placeholder Resolution Simplification

### Simple Placeholders (Keep These)
- `{{step_N.s3_key}}` → Returns S3 key string
- `{{step_N.result}}` → Returns raw result (string or dict) - let tool parse it

### Complex Placeholders (Remove These)
- `{{step_N.result.field}}` → **REMOVE** - Tool should receive full result and parse itself
- `{{step_N.result.nested.field}}` → **REMOVE** - Tool should receive full result and parse itself

### Migration Strategy
1. Update tools to accept S3 keys or raw JSON strings
2. Tools parse JSON themselves using helper methods
3. Simplify orchestrator placeholder resolution to only extract:
   - `s3_key` from step results
   - Raw `result` from step results
   - No nested field extraction

## Benefits
- Cleaner separation of concerns
- Tools are self-contained and testable
- Orchestrator stays simple and focused
- No risk of data contamination in orchestrator

