# Planner Agent Tools Architecture

## Overview

The `planner/agent_tools/` folder contains document generation tools that are available to the planner (LLM) for creating nuanced, intelligently formatted documents. This separates concerns:

- **Orchestrator**: Handles deterministic tasks (data fetching, calculations, chart generation)
- **Planner**: Handles intelligent document generation with proper formatting, styling, and chart embedding

## Architecture

```
planner/
├── agent_tools/              # Planner document generation tools
│   ├── content_formatter.py  # Formats financial metrics (percentages, decimals)
│   ├── markdown_formatter.py # Converts data structures to markdown
│   ├── html_document_generator.py  # Generates HTML reports
│   ├── pdf_document_generator.py   # Generates PDF reports
│   └── planner_tools.py      # Tool wrappers (@tool decorated) for planner
│
tools/                        # Orchestrator tools (deterministic)
├── get_multiple_financial_data.py
├── analyze_portfolio_performance.py
├── chart_generator.py
└── ...
```

## Workflow

### Traditional Flow (Orchestrator-only)
1. Planner creates plan
2. Orchestrator executes: get data → analyze → generate chart → generate file
3. File generation is deterministic (no LLM intelligence)

### New Flow (Planner + Orchestrator)
1. Planner creates plan for data/calculations
2. Orchestrator executes: get data → analyze → generate chart (checkpoint)
3. Planner reviews chart at checkpoint
4. Planner uses agent_tools to generate formatted document:
   - `format_financial_metrics_tool` - Format raw decimals
   - `format_portfolio_data_to_markdown_tool` - Convert data to markdown
   - `generate_html_report_tool` or `generate_pdf_report_tool` - Generate document
5. Planner includes document S3 key in response

## Benefits

1. **Intelligent Formatting**: Planner can format content based on context (percentages, decimals, etc.)
2. **Proper Chart Embedding**: Charts are embedded as base64 in HTML, properly sized in PDFs
3. **Template Syntax Removal**: Handlebars/template syntax is stripped from content
4. **Nuanced Documents**: Planner can make intelligent decisions about document structure
5. **Separation of Concerns**: Orchestrator handles deterministic tasks, planner handles intelligence

## Tool Functions

### `format_financial_content(content: str) -> str`
Formats raw decimal values based on context:
- CAGR, Volatility, Drawdown → percentages (29.77%)
- Sharpe Ratio → decimal (0.94)
- Rolling returns → summary text

### `format_markdown_content(data: dict) -> str`
Converts structured portfolio data to formatted markdown with proper tables and sections.

### `generate_html_document(content, title, chart_s3_keys) -> str`
Generates complete HTML document with:
- Decimal formatting
- Chart embedding as base64 data URIs
- Professional styling
- Responsive design

### `generate_pdf_document(content, title, chart_s3_keys) -> bytes`
Generates complete PDF document with:
- Decimal formatting
- Chart embedding
- Proper PDF structure
- Template syntax removal

## Usage in Planner

The planner can call these tools directly:

```python
# Format content
formatted_content = format_financial_metrics_tool(raw_content)

# Generate markdown from data
markdown = format_portfolio_data_to_markdown_tool(portfolio_data_json)

# Generate HTML report
html_s3_key = generate_html_report_tool(
    content=formatted_content,
    title="Portfolio Analysis Report",
    chart_s3_keys="users/.../chart1.png,users/.../chart2.png"
)

# Generate PDF report
pdf_s3_key = generate_pdf_report_tool(
    content=formatted_content,
    title="Portfolio Analysis Report",
    chart_s3_keys="users/.../chart1.png"
)
```

## Integration

These tools are registered in `planner/agent.py`:

```python
from planner.agent_tools.planner_tools import (
    generate_html_report_tool,
    generate_pdf_report_tool,
    format_financial_metrics_tool,
    format_portfolio_data_to_markdown_tool
)

enhanced_tools = [
    generate_html_report_tool,
    generate_pdf_report_tool,
    format_financial_metrics_tool,
    format_portfolio_data_to_markdown_tool
]
```

The planner's system prompt (in `context_aware_agent.py`) informs the LLM about these tools and when to use them.

