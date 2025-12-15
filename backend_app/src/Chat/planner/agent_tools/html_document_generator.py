"""
HTML Document Generator - Planner tool for generating HTML reports

This tool is available to the planner (LLM) for generating nuanced HTML documents.
It handles formatting, chart embedding, and styling intelligently.
"""

import json
import re
import logging
import boto3
import os
from html import escape
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def generate_html_document(
    content: str,
    title: str,
    chart_s3_keys: list = None,
    format_decimals: bool = True
) -> str:
    """
    Generate a complete HTML document with proper formatting and embedded charts.
    
    This is a planner tool - the planner can call this to generate HTML documents
    with intelligent formatting, chart embedding, and styling.
    
    Args:
        content: Markdown or text content to convert to HTML
        title: Document title
        chart_s3_keys: List of S3 keys for chart images to embed
        format_decimals: Whether to format decimal values as percentages
        
    Returns:
        Complete HTML document as string
    """
    from .content_formatter import format_financial_content
    
    # Format decimal values if requested
    if format_decimals:
        content = format_financial_content(content)
    
    # Extract chart S3 keys from content if not provided
    if chart_s3_keys is None:
        chart_s3_keys = _extract_chart_s3_keys(content)
    
    # Convert markdown to HTML
    html_body = _markdown_to_html(content, chart_s3_keys)
    
    # Embed chart images as base64
    chart_images_html = _embed_charts_as_base64(chart_s3_keys)
    
    # Combine everything
    full_body = chart_images_html + html_body
    
    # Generate complete HTML document
    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{escape(title)}</title>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        h1 {{
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }}
        h2 {{
            color: #34495e;
            margin-top: 30px;
        }}
        h3 {{
            color: #7f8c8d;
        }}
        p {{
            margin: 10px 0;
        }}
        ul {{
            margin: 10px 0;
            padding-left: 30px;
        }}
        li {{
            margin: 5px 0;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }}
        th, td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }}
        th {{
            background-color: #3498db;
            color: white;
        }}
        tr:hover {{
            background-color: #f5f5f5;
        }}
        img {{
            max-width: 100%;
            height: auto;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin: 20px 0;
        }}
        pre {{
            background-color: #f4f4f4;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
        }}
        code {{
            font-family: 'Courier New', monospace;
        }}
    </style>
</head>
<body>
    <div class="container">
        {full_body}
    </div>
</body>
</html>"""
    
    return html_doc


def _extract_chart_s3_keys(content: str) -> list:
    """Extract chart S3 keys from content"""
    chart_s3_keys = []
    
    # Look for markdown image syntax
    markdown_pattern = r'!\[.*?\]\((users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>\)]+\.(png|jpg|jpeg|gif))\)'
    matches = re.findall(markdown_pattern, content)
    chart_s3_keys.extend([m[0] for m in matches])
    
    # Look for JSON chart references
    json_pattern = r'\{"(?:message|s3_key)":\s*"[^"]*",\s*"s3_key":\s*"([^"]+)"'
    matches = re.findall(json_pattern, content)
    chart_s3_keys.extend([m for m in matches if m.endswith(('.png', '.jpg', '.jpeg', '.gif'))])
    
    # Look for direct S3 key references
    s3_key_pattern = r'users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>]+\.(png|jpg|jpeg|gif)'
    matches = re.findall(s3_key_pattern, content)
    chart_s3_keys.extend([m[0] if isinstance(m, tuple) else m for m in matches])
    
    # Remove duplicates
    return list(set(chart_s3_keys))


def _markdown_to_html(content: str, chart_s3_keys: list) -> str:
    """Convert markdown content to HTML"""
    html_lines = []
    in_code_block = False
    in_list = False
    
    lines = content.split('\n')
    for line in lines:
        # Remove S3 key references (will be embedded as images)
        line = re.sub(r'users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>]+\.(png|jpg|jpeg|gif)', '', line)
        line = re.sub(r'\{"s3_key":\s*"[^"]+"[^}]*\}', '', line)
        line = re.sub(r'\{"message":\s*"[^"]*",\s*"s3_key":\s*"[^"]+"[^}]*\}', '', line)
        
        line = line.strip()
        
        if not line:
            if in_list:
                html_lines.append('</ul>')
                in_list = False
            html_lines.append('<br>')
            continue
        
        # Markdown to HTML conversion
        if line.startswith('# '):
            html_lines.append(f'<h1>{escape(line[2:])}</h1>')
        elif line.startswith('## '):
            html_lines.append(f'<h2>{escape(line[3:])}</h2>')
        elif line.startswith('### '):
            html_lines.append(f'<h3>{escape(line[4:])}</h3>')
        elif line.startswith('- ') or line.startswith('* '):
            if not in_list:
                html_lines.append('<ul>')
                in_list = True
            html_lines.append(f'<li>{escape(line[2:])}</li>')
        elif line.startswith('```'):
            in_code_block = not in_code_block
            if in_code_block:
                html_lines.append('<pre><code>')
            else:
                html_lines.append('</code></pre>')
        elif in_code_block:
            html_lines.append(f'{escape(line)}<br>')
        elif line.startswith('|') and '|' in line[1:]:
            # Markdown table
            if '---' not in line:  # Not a separator row
                cells = [cell.strip() for cell in line.split('|')[1:-1]]
                html_lines.append('<tr>' + ''.join(f'<td>{escape(cell)}</td>' for cell in cells) + '</tr>')
        else:
            # Regular paragraph
            if in_list:
                html_lines.append('</ul>')
                in_list = False
            html_lines.append(f'<p>{escape(line)}</p>')
    
    if in_list:
        html_lines.append('</ul>')
    
    return '\n'.join(html_lines)


def _embed_charts_as_base64(chart_s3_keys: list) -> str:
    """Download charts from S3 and embed as base64 data URIs"""
    if not chart_s3_keys:
        return ''
    
    s3_client = boto3.client('s3')
    bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
    
    if not bucket_name:
        logger.warning("Cannot embed charts: bucket name not configured")
        return ''
    
    chart_html = ''
    for s3_key in chart_s3_keys:
        try:
            # Download image from S3
            response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            image_data = response['Body'].read()
            
            # Convert to base64
            import base64
            image_base64 = base64.b64encode(image_data).decode('utf-8')
            
            # Determine MIME type
            if s3_key.endswith('.png'):
                mime_type = 'image/png'
            elif s3_key.endswith('.jpg') or s3_key.endswith('.jpeg'):
                mime_type = 'image/jpeg'
            elif s3_key.endswith('.gif'):
                mime_type = 'image/gif'
            else:
                mime_type = 'image/png'
            
            data_uri = f"data:{mime_type};base64,{image_base64}"
            chart_html += f'<div style="text-align: center; margin: 20px 0;"><img src="{data_uri}" alt="Chart" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px;" /></div>\n'
            logger.info(f"Embedded chart image: {s3_key}")
        except Exception as e:
            logger.error(f"Error embedding chart {s3_key}: {str(e)}")
    
    return chart_html

