# Checkpoint System Implementation

## Overview
The checkpoint system enables the orchestrator to pause execution at key points and send intermediate results to the planner for validation. The planner can then decide to continue, rework the plan, or provide updates to the user.

## Flow

```
User Query
    ↓
Planner creates plan
    ↓
Orchestrator executes plan
    ↓
[Checkpoint Triggered] → Orchestrator pauses
    ↓
Planner validates checkpoint
    ↓
Planner decision:
  - continue: Orchestrator proceeds
  - rework: Orchestrator updates plan and continues
  - update_user: Send message, then continue
    ↓
Orchestrator continues execution
    ↓
Final results → Reasoning LLM
```

## Checkpoint Triggers

Checkpoints are automatically triggered after:
1. **Chart generation** (`generate_chart_tool`)
2. **Document generation** (`generate_html_file_tool`, `generate_pdf_tool`)
3. **File uploads** (`upload_file_tool`)
4. **Portfolio analysis** (`analyze_portfolio_performance`)
5. **Mid-point of long plans** (5+ steps)

## Planner Validation Tools

The planner has access to these tools during checkpoint validation:
- `read_s3_file_tool(s3_key)` - Read files from S3
- `read_image_tool(s3_key)` - Read and validate images
- `read_pdf_tool(s3_key)` - Read and analyze PDFs

## Implementation Files

### New Files Created
1. **`orchestrator/checkpoint_manager.py`** - Manages checkpoint logic
2. **`tools/image_reader.py`** - Tool for planner to read/validate images
3. **`tools/image_embedder.py`** - Embeds images into various formats
4. **`tools/markdown_converter.py`** - Converts markdown to HTML
5. **`tools/html_template_generator.py`** - Generates HTML document structure
6. **`tools/pdf_generator.py`** - Generates PDF documents
7. **`tools/file_uploader.py`** - Uploads files to S3

### Modified Files
1. **`orchestrator/orchestrator.py`** - Added checkpoint logic after tool execution
2. **`planner/planner.py`** - Added `validate_checkpoint()` method
3. **`lambda_handler.py`** - Passes planner and checkpoint_manager to orchestrator

## Planner Validation Decision Format

```json
{
  "action": "continue" | "rework" | "update_user",
  "reason": "Brief explanation",
  "updated_plan": {...} (only if action is "rework"),
  "message": "..." (only if action is "update_user")
}
```

## Benefits

1. **Quality Control**: Planner can validate intermediate results before proceeding
2. **Dynamic Adaptation**: Plan can be modified mid-execution based on results
3. **User Updates**: Progress updates can be sent at checkpoints
4. **Error Prevention**: Catch issues early before completing entire plan
5. **Flexibility**: Planner can inspect files, images, PDFs before deciding

## Example Checkpoint Flow

1. Orchestrator executes `generate_chart_tool`
2. Chart is generated and uploaded to S3
3. Checkpoint triggered
4. Planner receives checkpoint data with S3 key
5. Planner uses `read_image_tool` to inspect chart
6. Planner validates chart looks correct
7. Planner returns `{"action": "continue"}`
8. Orchestrator proceeds with next step

## Dynamic Plan Reworking

If planner returns `{"action": "rework", "updated_plan": {...}}`:
- Orchestrator replaces remaining steps with new plan
- Execution continues with updated plan
- Allows for adaptive workflows based on intermediate results

