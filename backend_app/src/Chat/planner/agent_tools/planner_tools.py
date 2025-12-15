"""
Planner Tools - Tool wrappers for the planner to use document generation

These are decorated with @tool and available to the planner (LLM) for generating documents.
They wrap the agent_tools functions to make them callable by the planner.
"""

import logging
import os
import boto3
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# Import Strands tool decorator
try:
    from strands.tools import tool
except ImportError:
    # Fallback if Strands not available
    def tool(func):
        return func

from .html_document_generator import generate_html_document
from .pdf_document_generator import generate_pdf_document
from .content_formatter import format_financial_content
from .markdown_formatter import format_markdown_content, format_rolling_returns_table

# Import moved tools
from .image_reader import read_image_tool as _read_image_tool_impl
from .image_embedder import embed_images_tool as _embed_images_tool_impl
from .pdf_reader import read_pdf_tool as _read_pdf_tool_impl, analyze_pdf_content_tool as _analyze_pdf_content_tool_impl
from .pdf_manipulator import manipulate_pdf_tool as _manipulate_pdf_tool_impl
from .html_template_generator import generate_html_template_tool as _generate_html_template_tool_impl

# Import Strands types for tool wrappers
try:
    from strands.types.tools import ToolUse
except ImportError:
    ToolUse = dict


@tool
def generate_html_report_tool(
    content: str,
    title: str,
    chart_s3_keys: str = None,
    filename: str = None
) -> str:
    """
    Generate an HTML report with proper formatting and embedded charts.
    
    This tool is available to the planner for generating nuanced HTML documents.
    It automatically formats decimal values, embeds charts as base64, and applies styling.
    
    Args:
        content: Markdown or text content for the report
        title: Document title
        chart_s3_keys: Comma-separated list of S3 keys for chart images (optional, will be extracted from content if not provided)
        filename: Optional filename (without .html extension)
        
    Returns:
        S3 key of the uploaded HTML file
    """
    try:
        # Parse chart_s3_keys if provided as string
        chart_keys_list = None
        if chart_s3_keys:
            chart_keys_list = [k.strip() for k in chart_s3_keys.split(',') if k.strip()]
        
        # Generate HTML
        html_content = generate_html_document(
            content=content,
            title=title,
            chart_s3_keys=chart_keys_list,
            format_decimals=True
        )
        
        # Upload to S3
        user_id = os.environ.get('USER_ID')
        session_id = os.environ.get('SESSION_ID')
        
        if not user_id or not session_id:
            return f"Error: Missing USER_ID or SESSION_ID environment variables"
        
        # Use filename or generate from title
        if not filename:
            filename = title.lower().replace(' ', '_').replace('/', '_')[:50]
        if not filename.endswith('.html'):
            filename = f"{filename}.html"
        
        # Upload using unified file upload
        try:
            from lambda_invocation import upload_file_and_notify
            
            result = upload_file_and_notify(
                content=html_content,
                filename=filename,
                user_id=user_id,
                session_id=session_id,
                file_type='html',
                content_type='text/html',
                folder="agent-files",
                metadata={
                    'generated_by': 'planner_html_report_tool',
                    'title': title[:200]  # Truncate for metadata
                }
            )
            
            # Extract S3 key from result
            if isinstance(result, dict):
                return result.get('s3_key', result.get('message', 'Uploaded successfully'))
            return result
        except ImportError:
            return "Error: File upload module not available"
            
    except Exception as e:
        logger.error(f"Error in generate_html_report_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"Error generating HTML report: {str(e)}"


@tool
def generate_pdf_report_tool(
    content: str,
    title: str,
    chart_s3_keys: str = None,
    filename: str = None
) -> str:
    """
    Generate a PDF report with proper formatting and embedded charts.
    
    This tool is available to the planner for generating nuanced PDF documents.
    It automatically formats decimal values, embeds charts, and applies proper PDF structure.
    
    Args:
        content: Markdown or text content for the report
        title: Document title
        chart_s3_keys: Comma-separated list of S3 keys for chart images (optional, will be extracted from content if not provided)
        filename: Optional filename (without .pdf extension)
        
    Returns:
        S3 key of the uploaded PDF file
    """
    try:
        # Parse chart_s3_keys if provided as string
        chart_keys_list = None
        if chart_s3_keys:
            chart_keys_list = [k.strip() for k in chart_s3_keys.split(',') if k.strip()]
        
        # Generate PDF
        pdf_bytes = generate_pdf_document(
            content=content,
            title=title,
            chart_s3_keys=chart_keys_list,
            format_decimals=True
        )
        
        # Upload to S3
        user_id = os.environ.get('USER_ID')
        session_id = os.environ.get('SESSION_ID')
        
        if not user_id or not session_id:
            return f"Error: Missing USER_ID or SESSION_ID environment variables"
        
        # Use filename or generate from title
        if not filename:
            filename = title.lower().replace(' ', '_').replace('/', '_')[:50]
        if not filename.endswith('.pdf'):
            filename = f"{filename}.pdf"
        
        # Upload using unified file upload
        try:
            from lambda_invocation import upload_file_and_notify
            
            result = upload_file_and_notify(
                content=pdf_bytes,
                filename=filename,
                user_id=user_id,
                session_id=session_id,
                file_type='pdf',
                content_type='application/pdf',
                folder="agent-files",
                metadata={
                    'generated_by': 'planner_pdf_report_tool',
                    'title': title[:200]  # Truncate for metadata
                }
            )
            
            # Extract S3 key from result
            if isinstance(result, dict):
                return result.get('s3_key', result.get('message', 'Uploaded successfully'))
            return result
        except ImportError:
            return "Error: File upload module not available"
            
    except Exception as e:
        logger.error(f"Error in generate_pdf_report_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"Error generating PDF report: {str(e)}"


@tool
def format_financial_metrics_tool(content: str) -> str:
    """
    Format financial content with proper decimal/percentage formatting.
    
    This tool helps the planner format raw financial data into human-readable content.
    It automatically formats CAGR, volatility, drawdown as percentages, Sharpe ratio as decimal, etc.
    
    Args:
        content: Raw content string with unformatted decimals
        
    Returns:
        Formatted content string
    """
    try:
        return format_financial_content(content)
    except Exception as e:
        logger.error(f"Error in format_financial_metrics_tool: {str(e)}")
        return f"Error formatting content: {str(e)}"


@tool
def format_portfolio_data_to_markdown_tool(data: str) -> str:
    """
    Convert structured portfolio data to formatted markdown.
    
    This tool helps the planner convert JSON portfolio data into well-formatted markdown
    for document generation.
    
    Args:
        data: JSON string with portfolio data (metrics, time series, etc.)
        
    Returns:
        Formatted markdown string
    """
    try:
        import json
        data_dict = json.loads(data) if isinstance(data, str) else data
        return format_markdown_content(data_dict, include_charts=True)
    except Exception as e:
        logger.error(f"Error in format_portfolio_data_to_markdown_tool: {str(e)}")
        return f"Error formatting portfolio data: {str(e)}"


@tool
def read_image_tool(s3_key: str, include_base64: bool = True, validate: bool = True) -> str:
    """
    Read and analyze image from S3. Returns image metadata, base64 data, and validation results.
    
    This tool is available to the planner for inspecting intermediate chart/image results.
    Use this to validate images before embedding them in documents or to extract image metadata.
    
    Args:
        s3_key: S3 key of the image file
        include_base64: Whether to include base64-encoded image data (default: True)
        validate: Whether to validate image is readable and get dimensions (default: True)
        
    Returns:
        JSON string with image metadata, validation results, and optionally base64 data
    """
    try:
        import uuid
        import json
        
        # Create ToolUse object for the underlying implementation
        # ToolUse can be a dict or a class instance depending on Strands version
        tool_use_dict = {
            'toolUseId': str(uuid.uuid4()),
            'toolName': 'read_image_tool',
            'input': {
                's3_key': s3_key,
                'include_base64': include_base64,
                'validate': validate
            }
        }
        # ToolUse can be a class or dict type
        if ToolUse is dict:
            tool_use = tool_use_dict
        else:
            tool_use = ToolUse(tool_use_dict)
        
        result = _read_image_tool_impl(tool_use)
        
        # Extract result from ToolResult format
        if isinstance(result, dict):
            content = result.get('content', [])
            if isinstance(content, list) and len(content) > 0:
                return content[0].get('text', json.dumps(content[0]))
            return json.dumps(result)
        return str(result)
    except Exception as e:
        logger.error(f"Error in read_image_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"Error reading image: {str(e)}"


@tool
def embed_images_tool(content: str, target_format: str, image_s3_keys: str = None) -> str:
    """
    Embed images from S3 into content for various file types (PDF, HTML, base64).
    
    This tool extracts image references from content and embeds them appropriately based on target format.
    Use this to prepare content with embedded images before generating documents.
    
    Args:
        content: Content that may contain image references (S3 keys, JSON with s3_key, etc.)
        target_format: Target file format: "pdf", "html", or "base64"
        image_s3_keys: Optional comma-separated list of S3 keys to embed explicitly
        
    Returns:
        JSON string with embedded content, embedded_images list, and failed_images list
    """
    try:
        import uuid
        import json
        
        # Parse image_s3_keys if provided as string
        image_keys_list = None
        if image_s3_keys:
            image_keys_list = [k.strip() for k in image_s3_keys.split(',') if k.strip()]
        
        # Create ToolUse object for the underlying implementation
        tool_use_dict = {
            'toolUseId': str(uuid.uuid4()),
            'toolName': 'embed_images_tool',
            'input': {
                'content': content,
                'target_format': target_format,
                'image_s3_keys': image_keys_list
            }
        }
        # ToolUse can be a class or dict type
        if ToolUse is dict:
            tool_use = tool_use_dict
        else:
            tool_use = ToolUse(tool_use_dict)
        
        result = _embed_images_tool_impl(tool_use)
        
        # Extract result from ToolResult format
        if isinstance(result, dict):
            content_list = result.get('content', [])
            if isinstance(content_list, list) and len(content_list) > 0:
                return content_list[0].get('text', json.dumps(content_list[0]))
            return json.dumps(result)
        return str(result)
    except Exception as e:
        logger.error(f"Error in embed_images_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"Error embedding images: {str(e)}"


@tool
def read_pdf_tool(s3_key: str) -> str:
    """
    Read and extract text from PDF file in S3.
    
    This tool is available to the planner for reading and analyzing PDF documents.
    Use this to extract text content from PDFs for analysis or to validate PDF structure.
    
    Args:
        s3_key: S3 key of the PDF file
        
    Returns:
        JSON string with extracted text content and metadata
    """
    try:
        import uuid
        import json
        
        # Create ToolUse object for the underlying implementation
        tool_use_dict = {
            'toolUseId': str(uuid.uuid4()),
            'toolName': 'read_pdf_tool',
            'input': {
                's3_key': s3_key
            }
        }
        # ToolUse can be a class or dict type
        if ToolUse is dict:
            tool_use = tool_use_dict
        else:
            tool_use = ToolUse(tool_use_dict)
        
        result = _read_pdf_tool_impl(tool_use)
        
        # Extract result from ToolResult format
        if isinstance(result, dict):
            content = result.get('content', [])
            if isinstance(content, list) and len(content) > 0:
                return content[0].get('text', json.dumps(content[0]))
            return json.dumps(result)
        return str(result)
    except Exception as e:
        logger.error(f"Error in read_pdf_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"Error reading PDF: {str(e)}"


@tool
def analyze_pdf_content_tool(s3_key: str) -> str:
    """
    Analyze PDF content structure, extract metadata, and provide content summary.
    
    This tool provides detailed analysis of PDF structure, including page count, text extraction,
    and content organization. Use this for deeper PDF analysis beyond simple text extraction.
    
    Args:
        s3_key: S3 key of the PDF file
        
    Returns:
        JSON string with PDF analysis including structure, metadata, and content summary
    """
    try:
        import uuid
        import json
        
        # Create ToolUse object for the underlying implementation
        tool_use_dict = {
            'toolUseId': str(uuid.uuid4()),
            'toolName': 'analyze_pdf_content_tool',
            'input': {
                's3_key': s3_key
            }
        }
        # ToolUse can be a class or dict type
        if ToolUse is dict:
            tool_use = tool_use_dict
        else:
            tool_use = ToolUse(tool_use_dict)
        
        result = _analyze_pdf_content_tool_impl(tool_use)
        
        # Extract result from ToolResult format
        if isinstance(result, dict):
            content = result.get('content', [])
            if isinstance(content, list) and len(content) > 0:
                return content[0].get('text', json.dumps(content[0]))
            return json.dumps(result)
        return str(result)
    except Exception as e:
        logger.error(f"Error in analyze_pdf_content_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"Error analyzing PDF: {str(e)}"


@tool
def manipulate_pdf_tool(
    operation: str,
    source_pdf_s3_key: str,
    source_pdf_s3_keys: str = None,
    page_numbers: str = None,
    rotation_angle: int = None,
    new_content: str = None,
    content_position: str = None,
    form_data: str = None,
    password: str = None,
    output_filename: str = None
) -> str:
    """
    Advanced PDF manipulation: merge, split, extract, rotate, delete pages, add content, fill forms, encrypt/decrypt.
    
    This tool is available to the planner for modifying existing PDF documents.
    Supports various operations like merging multiple PDFs, rotating pages, adding content, etc.
    
    Args:
        operation: Operation to perform: "merge", "split", "extract", "rotate", "delete_pages", "add_content", "modify_content", "fill_form", "encrypt", "decrypt"
        source_pdf_s3_key: S3 key of source PDF file (required for most operations)
        source_pdf_s3_keys: For merge: comma-separated list of S3 keys of PDFs to merge
        page_numbers: For extract/delete/rotate: comma-separated page numbers (1-indexed)
        rotation_angle: For rotate: rotation angle in degrees (90, 180, or 270)
        new_content: For add_content: text/markdown content to add
        content_position: For add_content: JSON string with position coordinates {x, y, page}
        form_data: For fill_form: JSON string with form field values {field_name: value}
        password: For encrypt/decrypt: password
        output_filename: Output filename (without .pdf extension)
        
    Returns:
        JSON string with result S3 key and operation details
    """
    try:
        import uuid
        import json
        
        # Parse string parameters to appropriate types
        source_pdf_s3_keys_list = None
        if source_pdf_s3_keys:
            source_pdf_s3_keys_list = [k.strip() for k in source_pdf_s3_keys.split(',') if k.strip()]
        
        page_numbers_list = None
        if page_numbers:
            try:
                page_numbers_list = [int(p.strip()) for p in page_numbers.split(',') if p.strip()]
            except ValueError:
                pass
        
        content_position_dict = None
        if content_position:
            try:
                content_position_dict = json.loads(content_position) if isinstance(content_position, str) else content_position
            except json.JSONDecodeError:
                pass
        
        form_data_dict = None
        if form_data:
            try:
                form_data_dict = json.loads(form_data) if isinstance(form_data, str) else form_data
            except json.JSONDecodeError:
                pass
        
        # Create ToolUse object for the underlying implementation
        tool_use_dict = {
            'toolUseId': str(uuid.uuid4()),
            'toolName': 'manipulate_pdf_tool',
            'input': {
                'operation': operation,
                'source_pdf_s3_key': source_pdf_s3_key,
                'source_pdf_s3_keys': source_pdf_s3_keys_list,
                'page_numbers': page_numbers_list,
                'rotation_angle': rotation_angle,
                'new_content': new_content,
                'content_position': content_position_dict,
                'form_data': form_data_dict,
                'password': password,
                'output_filename': output_filename
            }
        }
        # ToolUse can be a class or dict type
        if ToolUse is dict:
            tool_use = tool_use_dict
        else:
            tool_use = ToolUse(tool_use_dict)
        
        result = _manipulate_pdf_tool_impl(tool_use)
        
        # Extract result from ToolResult format
        if isinstance(result, dict):
            content = result.get('content', [])
            if isinstance(content, list) and len(content) > 0:
                return content[0].get('text', json.dumps(content[0]))
            return json.dumps(result)
        return str(result)
    except Exception as e:
        logger.error(f"Error in manipulate_pdf_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"Error manipulating PDF: {str(e)}"


@tool
def generate_html_template_tool(
    body_content: str,
    title: str = None,
    custom_css: str = None,
    theme: str = "default"
) -> str:
    """
    Generate HTML document structure with styling. Wraps body content in a complete HTML document with CSS.
    
    This tool is available to the planner for creating HTML document templates with professional styling.
    Use this to wrap HTML body content in a complete document structure with CSS.
    
    Args:
        body_content: HTML body content to wrap in template
        title: Document title (optional)
        custom_css: Optional custom CSS to add to the document
        theme: Theme preset: "default", "minimal", or "dark" (default: "default")
        
    Returns:
        Complete HTML document as string
    """
    try:
        import uuid
        import json
        
        # Create ToolUse object for the underlying implementation
        tool_use_dict = {
            'toolUseId': str(uuid.uuid4()),
            'toolName': 'generate_html_template_tool',
            'input': {
                'body_content': body_content,
                'title': title,
                'custom_css': custom_css,
                'theme': theme
            }
        }
        # ToolUse can be a class or dict type
        if ToolUse is dict:
            tool_use = tool_use_dict
        else:
            tool_use = ToolUse(tool_use_dict)
        
        result = _generate_html_template_tool_impl(tool_use)
        
        # Extract result from ToolResult format
        if isinstance(result, dict):
            content = result.get('content', [])
            if isinstance(content, list) and len(content) > 0:
                return content[0].get('text', json.dumps(content[0]))
            return json.dumps(result)
        return str(result)
    except Exception as e:
        logger.error(f"Error in generate_html_template_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"Error generating HTML template: {str(e)}"

