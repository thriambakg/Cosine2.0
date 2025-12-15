# PDF Tools Enhancement & Orchestrator Refactoring Summary

## Overview
This refactoring implements advanced PDF manipulation capabilities and cleans up the orchestrator by removing all JSON parsing logic, delegating data parsing to tools themselves.

## Changes Made

### 1. Enhanced PDF Generator Tool (`tools/pdf_generator.py`)
- **Added S3 Integration**: Tool now reads images directly from S3 when S3 keys are referenced in content
- **Automatic Chart Embedding**: Detects chart S3 keys from:
  - Direct S3 key strings: `users/.../agent-files/...png`
  - JSON objects: `{"s3_key": "users/.../agent-files/...png"}`
  - Markdown syntax: `![Chart](users/.../agent-files/...png)`
- **JSON Parsing**: Tool handles its own JSON parsing internally using `_extract_chart_s3_keys()`

### 2. New PDF Manipulator Tool (`tools/pdf_manipulator.py`)
Implements advanced PDF manipulation using **pypdf** library:

#### Operations Supported:
- **merge**: Merge multiple PDFs into one
- **split**: Split PDF into multiple files by page ranges
- **extract**: Extract specific pages from PDF
- **rotate**: Rotate specific pages (90°, 180°, 270°)
- **delete_pages**: Delete specific pages from PDF
- **add_content**: Add new text/content at specified coordinates on a page
- **fill_form**: Fill PDF form fields with data
- **encrypt**: Password-protect PDF
- **decrypt**: Remove password protection from PDF

#### Features:
- Reads PDFs from S3
- Writes results back to S3
- Handles all JSON parsing internally
- Returns S3 key of output PDF

### 3. JSON Parser Helper (`tools/json_parser_helper.py`)
New utility class for tools to parse JSON data consistently:

- `parse_json_data()`: Parses JSON from S3 keys, JSON strings, or dicts
- `extract_nested_field()`: Extracts nested fields using dot notation
- `extract_multiple_fields()`: Extracts multiple fields at once
- Handles file references automatically

### 4. Orchestrator Simplification (`orchestrator/orchestrator.py`)

#### Removed:
- ❌ All nested field extraction logic
- ❌ `_extract_nested_field()` method
- ❌ Complex JSON parsing in placeholder resolution
- ❌ Field variation matching (portfolio_tickers, etc.)

#### Simplified:
- ✅ Only extracts `s3_key` or raw `result` from step results
- ✅ For nested fields (e.g., `{{step_2.result.metrics_table}}`), passes S3 key instead
- ✅ Tools receive full results and parse them themselves
- ✅ Clean separation: Orchestrator = file movement, Tools = data parsing

#### Placeholder Support:
- `{{step_N.s3_key}}` → Returns S3 key string
- `{{step_N.result}}` → Returns raw result (S3 key or data)
- `{{step_N.result.field}}` → **DEPRECATED** - Tool receives S3 key and parses itself

### 5. Tool Updates

#### Portfolio Analysis Tool (`tools/portfolio_analysis_tool.py`)
- Now uses `JSONParserHelper.parse_json_data()` for consistent parsing
- Handles all JSON parsing internally

#### Tool Executor (`orchestrator/tool_executor.py`)
- Added wrapper for `generate_pdf_tool`
- Added wrapper for `manipulate_pdf_tool`
- All tools that expect `ToolUse` objects are properly wrapped

### 6. Tool Specifications (`planner/tool_specifications.py`)
- Added `manipulate_pdf_tool` specification
- Updated `generate_pdf_tool` description to mention automatic chart embedding
- Added to `worker_tools` category

### 7. Dependencies (`requirements.txt`)
- Added `pypdf>=3.0.0` for advanced PDF manipulation

## Benefits

### 1. Clean Separation of Concerns
- **Orchestrator**: Only handles S3 file movement
- **Tools**: Handle their own data parsing and processing
- **No Contamination**: Orchestrator doesn't risk corrupting data through parsing

### 2. Advanced PDF Capabilities
- Merge multiple PDFs
- Split, extract, rotate, delete pages
- Add content at specific coordinates
- Fill form fields
- Encrypt/decrypt PDFs

### 3. Better Maintainability
- Tools are self-contained and testable
- JSON parsing logic is centralized in `JSONParserHelper`
- Easier to debug and extend

### 4. Improved Chart Embedding
- PDF generator automatically detects and embeds charts from S3
- Supports multiple reference formats (direct keys, JSON, markdown)
- No manual image embedding required

## Migration Notes

### For Tools:
Tools that previously relied on orchestrator for nested field extraction should:
1. Use `JSONParserHelper.parse_json_data()` to parse input data
2. Use `JSONParserHelper.extract_nested_field()` for nested field access
3. Handle S3 key strings by reading from S3 themselves

### For Planner:
- Use `{{step_N.s3_key}}` to get S3 keys
- Use `{{step_N.result}}` to get raw results
- **Avoid** nested placeholders like `{{step_N.result.metrics_table}}` - tools will parse the full result

## Example Usage

### PDF Manipulation:
```json
{
  "tool": "manipulate_pdf_tool",
  "parameters": {
    "operation": "merge",
    "source_pdf_s3_keys": ["{{step_1.s3_key}}", "{{step_2.s3_key}}"],
    "output_filename": "merged_report.pdf"
  }
}
```

### Chart Embedding in PDF:
```json
{
  "tool": "generate_pdf_tool",
  "parameters": {
    "content": "## Report\n\n![Chart]({{step_3.s3_key}})\n\nMetrics: ...",
    "filename": "report.pdf"
  }
}
```

The PDF generator will automatically detect the chart S3 key and embed it.

## Testing Checklist
- [ ] PDF generation with chart embedding
- [ ] PDF merge operation
- [ ] PDF page extraction
- [ ] PDF rotation
- [ ] PDF form filling
- [ ] PDF encryption/decryption
- [ ] Placeholder resolution with S3 keys
- [ ] Tools parsing JSON from S3 correctly

