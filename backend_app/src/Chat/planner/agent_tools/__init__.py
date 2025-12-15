"""
Planner Agent Tools - Document generation tools available to the planner

These tools are available to the planner (LLM) for generating nuanced documents.
The orchestrator handles deterministic tasks (data fetching, calculations, charts),
while the planner uses these tools for intelligent document generation.
"""

from .html_document_generator import generate_html_document
from .pdf_document_generator import generate_pdf_document
from .markdown_formatter import format_markdown_content
from .content_formatter import format_financial_content

# Import tool wrappers
from .planner_tools import (
    generate_html_report_tool,
    generate_pdf_report_tool,
    format_financial_metrics_tool,
    format_portfolio_data_to_markdown_tool,
    read_image_tool,
    embed_images_tool,
    read_pdf_tool,
    analyze_pdf_content_tool,
    manipulate_pdf_tool,
    generate_html_template_tool
)

__all__ = [
    'generate_html_document',
    'generate_pdf_document',
    'format_markdown_content',
    'format_financial_content',
    'generate_html_report_tool',
    'generate_pdf_report_tool',
    'format_financial_metrics_tool',
    'format_portfolio_data_to_markdown_tool',
    'read_image_tool',
    'embed_images_tool',
    'read_pdf_tool',
    'analyze_pdf_content_tool',
    'manipulate_pdf_tool',
    'generate_html_template_tool',
]

