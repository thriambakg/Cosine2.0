"""
HTML Template Generator Tool - Creates HTML document structure with styling
Single-purpose tool for HTML template generation
"""

import logging
from html import escape
from typing import Dict, Any, Optional

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
    "name": "generate_html_template_tool",
    "description": "Generate HTML document structure with styling. Wraps body content in a complete HTML document with CSS.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "body_content": {
                    "type": "string",
                    "description": "HTML body content to wrap in template"
                },
                "title": {
                    "type": "string",
                    "description": "Document title"
                },
                "custom_css": {
                    "type": "string",
                    "description": "Optional custom CSS to add to the document"
                },
                "theme": {
                    "type": "string",
                    "description": "Theme preset: 'default', 'minimal', 'dark' (default: 'default')",
                    "enum": ["default", "minimal", "dark"]
                }
            },
            "required": ["body_content"]
        }
    }
}

class HTMLTemplateGenerator:
    """Generates HTML document templates with styling"""
    
    def _get_default_css(self) -> str:
        """Get default CSS styling"""
        return """
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }
        h2 {
            color: #34495e;
            margin-top: 30px;
        }
        h3 {
            color: #7f8c8d;
        }
        p {
            margin: 10px 0;
        }
        ul {
            margin: 10px 0;
            padding-left: 30px;
        }
        li {
            margin: 5px 0;
        }
        pre {
            background-color: #f4f4f4;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            font-family: 'Courier New', monospace;
        }
        img {
            border: 1px solid #ddd;
            border-radius: 4px;
        }
    """
    
    def _get_minimal_css(self) -> str:
        """Get minimal CSS styling"""
        return """
        body {
            font-family: Arial, sans-serif;
            line-height: 1.5;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }
    """
    
    def _get_dark_css(self) -> str:
        """Get dark theme CSS styling"""
        return """
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #e0e0e0;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #1a1a1a;
        }
        .container {
            background-color: #2d2d2d;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }
        h1 {
            color: #ffffff;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
        }
        h2 {
            color: #e0e0e0;
            margin-top: 30px;
        }
        h3 {
            color: #b0b0b0;
        }
        p {
            margin: 10px 0;
        }
        ul {
            margin: 10px 0;
            padding-left: 30px;
        }
        li {
            margin: 5px 0;
        }
        pre {
            background-color: #1a1a1a;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
        }
        code {
            font-family: 'Courier New', monospace;
        }
        img {
            border: 1px solid #444;
            border-radius: 4px;
        }
    """
    
    def generate(self, body_content: str, title: str = "Document", custom_css: Optional[str] = None, theme: str = "default") -> str:
        """
        Generate complete HTML document.
        
        Args:
            body_content: HTML body content
            title: Document title
            custom_css: Optional custom CSS
            theme: Theme preset
            
        Returns:
            Complete HTML document as string
        """
        # Get theme CSS
        if theme == "minimal":
            theme_css = self._get_minimal_css()
        elif theme == "dark":
            theme_css = self._get_dark_css()
        else:
            theme_css = self._get_default_css()
        
        # Combine theme CSS with custom CSS
        combined_css = theme_css
        if custom_css:
            combined_css += "\n        " + custom_css
        
        html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{escape(title)}</title>
    <style>
        {combined_css}
    </style>
</head>
<body>
    <div class="container">
        {body_content}
    </div>
</body>
</html>"""
        
        return html_doc

def generate_html_template_tool(tool_use: ToolUse) -> ToolResult:
    """
    Main tool function for HTML template generation.
    
    Args:
        tool_use: ToolUse object with input parameters
        
    Returns:
        ToolResult with complete HTML document
    """
    try:
        input_data = tool_use["input"]
        body_content = input_data.get("body_content")
        title = input_data.get("title", "Document")
        custom_css = input_data.get("custom_css")
        theme = input_data.get("theme", "default")
        
        if not body_content:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: body_content parameter is required"}]
            }
        
        if theme not in ["default", "minimal", "dark"]:
            theme = "default"
        
        generator = HTMLTemplateGenerator()
        html_doc = generator.generate(body_content, title, custom_css, theme)
        
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "success",
            "content": [{"text": html_doc}]
        }
        
    except Exception as e:
        logger.error(f"Error in generate_html_template_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "error",
            "content": [{"text": f"Error generating HTML template: {str(e)}"}]
        }

