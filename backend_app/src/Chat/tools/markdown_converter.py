"""
Markdown Converter Tool - Converts markdown text to HTML
Single-purpose tool for markdown conversion
"""

import logging
import re
from html import escape
from typing import Dict, Any

# Configure logging
logger = logging.getLogger()

# Import agent_logger for WebSocket streaming
try:
    import sys
    import os
    sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
    from agent_logger import get_agent_logger
    agent_logger = get_agent_logger()
except:
    agent_logger = logger

# Import Strands types (available in Lambda layer)
try:
    from strands.types.tools import ToolResult, ToolUse
except ImportError as e:
    logger.error(f"Failed to import Strands types: {e}")
    raise

# Tool specification following Strands pattern
TOOL_SPEC = {
    "name": "convert_markdown_to_html_tool",
    "description": "Convert markdown text to HTML. Handles headings, lists, code blocks, paragraphs, and basic formatting.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "markdown_content": {
                    "type": "string",
                    "description": "Markdown text to convert to HTML"
                },
                "preserve_line_breaks": {
                    "type": "boolean",
                    "description": "Whether to preserve line breaks as <br> tags (default: true)",
                    "default": True
                }
            },
            "required": ["markdown_content"]
        }
    }
}

class MarkdownConverter:
    """Converts markdown to HTML"""
    
    def convert(self, markdown_content: str, preserve_line_breaks: bool = True) -> str:
        """
        Convert markdown text to HTML.
        
        Args:
            markdown_content: Markdown text to convert
            preserve_line_breaks: Whether to preserve line breaks
            
        Returns:
            HTML string
        """
        html_lines = []
        in_code_block = False
        in_list = False
        list_type = None  # 'ul' or 'ol'
        
        lines = markdown_content.split('\n')
        
        for line in lines:
            original_line = line
            line = line.rstrip()
            
            # Handle code blocks
            if line.startswith('```'):
                in_code_block = not in_code_block
                if in_code_block:
                    html_lines.append('<pre><code>')
                else:
                    html_lines.append('</code></pre>')
                continue
            
            if in_code_block:
                html_lines.append(f'{escape(line)}<br>')
                continue
            
            # Handle empty lines
            if not line:
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                    list_type = None
                if preserve_line_breaks:
                    html_lines.append('<br>')
                continue
            
            # Handle headings
            if line.startswith('# '):
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                    list_type = None
                html_lines.append(f'<h1>{escape(line[2:])}</h1>')
                continue
            elif line.startswith('## '):
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                    list_type = None
                html_lines.append(f'<h2>{escape(line[3:])}</h2>')
                continue
            elif line.startswith('### '):
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                    list_type = None
                html_lines.append(f'<h3>{escape(line[4:])}</h3>')
                continue
            elif line.startswith('#### '):
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                    list_type = None
                html_lines.append(f'<h4>{escape(line[5:])}</h4>')
                continue
            elif line.startswith('##### '):
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                    list_type = None
                html_lines.append(f'<h5>{escape(line[6:])}</h5>')
                continue
            elif line.startswith('###### '):
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                    list_type = None
                html_lines.append(f'<h6>{escape(line[7:])}</h6>')
                continue
            
            # Handle lists
            if line.startswith('- ') or line.startswith('* '):
                if not in_list:
                    html_lines.append('<ul>')
                    in_list = True
                    list_type = 'ul'
                html_lines.append(f'<li>{escape(line[2:])}</li>')
                continue
            elif line.startswith(('1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. ')):
                # Ordered list (simple detection)
                if not in_list or list_type != 'ol':
                    if in_list:
                        html_lines.append(f'</{list_type}>')
                    html_lines.append('<ol>')
                    in_list = True
                    list_type = 'ol'
                # Remove number prefix
                list_content = line.split('. ', 1)[1] if '. ' in line else line
                html_lines.append(f'<li>{escape(list_content)}</li>')
                continue
            
            # Handle horizontal rules
            if line.strip() in ['---', '***', '___']:
                if in_list:
                    html_lines.append(f'</{list_type}>')
                    in_list = False
                    list_type = None
                html_lines.append('<hr>')
                continue
            
            # Handle bold and italic (simple inline formatting)
            processed_line = line
            # Bold: **text** or __text__
            processed_line = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', processed_line)
            processed_line = re.sub(r'__(.+?)__', r'<strong>\1</strong>', processed_line)
            # Italic: *text* or _text_
            processed_line = re.sub(r'\*(.+?)\*', r'<em>\1</em>', processed_line)
            processed_line = re.sub(r'_(.+?)_', r'<em>\1</em>', processed_line)
            # Code: `text`
            processed_line = re.sub(r'`(.+?)`', r'<code>\1</code>', processed_line)
            
            # Regular paragraph
            if in_list:
                html_lines.append(f'</{list_type}>')
                in_list = False
                list_type = None
            
            html_lines.append(f'<p>{processed_line}</p>')
        
        # Close any open list
        if in_list:
            html_lines.append(f'</{list_type}>')
        
        return '\n'.join(html_lines)

def convert_markdown_to_html_tool(tool_use: ToolUse) -> ToolResult:
    """
    Main tool function for markdown to HTML conversion.
    
    Args:
        tool_use: ToolUse object with input parameters
        
    Returns:
        ToolResult with HTML content
    """
    try:
        import json
        import re
        
        input_data = tool_use["input"]
        markdown_content = input_data.get("markdown_content")
        preserve_line_breaks = input_data.get("preserve_line_breaks", True)
        
        if not markdown_content:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: markdown_content parameter is required"}]
            }
        
        converter = MarkdownConverter()
        html_content = converter.convert(markdown_content, preserve_line_breaks)
        
        # Return HTML content
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "success",
            "content": [{"text": html_content}]
        }
        
    except Exception as e:
        logger.error(f"Error in convert_markdown_to_html_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "error",
            "content": [{"text": f"Error converting markdown to HTML: {str(e)}"}]
        }

