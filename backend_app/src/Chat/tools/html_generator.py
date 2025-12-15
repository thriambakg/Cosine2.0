"""
HTML Generator Tool - Generates interactive HTML reports with embedded charts
"""

import json
import os
import re
import logging
import boto3
from html import escape
from typing import Dict, Any
from io import BytesIO

# Configure logging
logger = logging.getLogger()

# Import agent_logger for WebSocket streaming
try:
    import sys
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
    "name": "generate_html_file_tool",
    "description": "Generate interactive HTML reports with embedded charts and styling. Automatically embeds chart images from S3 as base64-encoded data URIs.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Name of the HTML file (without .html extension)"
                },
                "content": {
                    "type": "string",
                    "description": "Content to convert to HTML (text, markdown, or JSON with chart references)"
                },
                "title": {
                    "type": "string",
                    "description": "Optional title for the HTML document"
                }
            },
            "required": ["filename", "content"]
        }
    }
}

class HTMLGenerator:
    """Generates interactive HTML reports with embedded charts"""
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
        self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
    
    def _get_image_src(self, s3_key: str) -> str:
        """Get image source - download from S3 and convert to base64"""
        try:
            if not self.bucket_name:
                logger.warning("Cannot embed image: bucket name not configured")
                return ""
            
            # Download image from S3
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            image_data = response['Body'].read()
            
            # Convert to base64
            import base64
            image_base64 = base64.b64encode(image_data).decode('utf-8')
            
            # Determine image type from extension
            if s3_key.endswith('.png'):
                mime_type = 'image/png'
            elif s3_key.endswith('.jpg') or s3_key.endswith('.jpeg'):
                mime_type = 'image/jpeg'
            elif s3_key.endswith('.gif'):
                mime_type = 'image/gif'
            else:
                mime_type = 'image/png'
            
            return f"data:{mime_type};base64,{image_base64}"
        except Exception as e:
            logger.error(f"Error embedding image from S3 {s3_key}: {str(e)}")
            return ""
    
    def _extract_chart_s3_keys(self, content: str) -> list:
        """Extract chart S3 keys from content"""
        chart_s3_keys = []
        
        # Try to parse entire content as JSON
        try:
            content_json = json.loads(content)
            if isinstance(content_json, dict) and 's3_key' in content_json:
                chart_s3_keys.append(content_json['s3_key'])
            elif isinstance(content_json, list):
                for item in content_json:
                    if isinstance(item, dict) and 's3_key' in item:
                        chart_s3_keys.append(item['s3_key'])
        except (json.JSONDecodeError, ValueError):
            # Not JSON, look for embedded JSON patterns
            json_pattern = r'\{"message":\s*"[^"]*",\s*"s3_key":\s*"([^"]+)"'
            matches = re.findall(json_pattern, content)
            chart_s3_keys.extend([m for m in matches if m.endswith(('.png', '.jpg', '.jpeg', '.gif'))])
            
            simple_json_pattern = r'\{"s3_key":\s*"([^"]+)"'
            simple_matches = re.findall(simple_json_pattern, content)
            chart_s3_keys.extend([m for m in simple_matches if m.endswith(('.png', '.jpg', '.jpeg', '.gif')) and m not in chart_s3_keys])
        
        # Also look for direct S3 key references in content
        s3_key_pattern = r'users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>]+\.(png|jpg|jpeg|gif)'
        direct_matches = re.findall(s3_key_pattern, content)
        chart_s3_keys.extend([m[0] if isinstance(m, tuple) else m for m in direct_matches if m not in chart_s3_keys])
        
        return chart_s3_keys
    
    def generate_html(self, content: str, filename: str = "report.html", title: str = None) -> str:
        """
        Generate HTML content from text/markdown content with embedded charts.
        
        Args:
            content: Text content to convert to HTML
            filename: Filename (for metadata)
            title: Optional title for the HTML document
            
        Returns:
            HTML file as string
        """
        try:
            # Extract chart S3 keys from content
            chart_s3_keys = self._extract_chart_s3_keys(content)
            logger.info(f"Found {len(chart_s3_keys)} chart(s) to embed in HTML")
            
            # Convert markdown/text to HTML
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
                else:
                    # Regular paragraph
                    if in_list:
                        html_lines.append('</ul>')
                        in_list = False
                    html_lines.append(f'<p>{escape(line)}</p>')
            
            if in_list:
                html_lines.append('</ul>')
            
            body_content = '\n'.join(html_lines)
            
            # Embed chart images
            chart_images_html = ''
            for s3_key in chart_s3_keys:
                img_src = self._get_image_src(s3_key)
                if img_src:
                    chart_images_html += f'<div style="text-align: center; margin: 20px 0;"><img src="{img_src}" alt="Chart" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px;" /></div>\n'
                    logger.info(f"Embedded chart image: {s3_key}")
            
            # Combine charts and content
            full_body = chart_images_html + body_content
            
            # Use provided title or filename as fallback
            doc_title = title or filename.replace('.html', '')
            
            # Create full HTML document
            html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{escape(doc_title)}</title>
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
        pre {{
            background-color: #f4f4f4;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
        }}
        code {{
            font-family: 'Courier New', monospace;
        }}
        img {{
            border: 1px solid #ddd;
            border-radius: 4px;
        }}
    </style>
</head>
<body>
    <div class="container">
        {full_body}
    </div>
</body>
</html>"""
            
            logger.info(f"Generated HTML: {len(html_doc)} bytes")
            return html_doc
            
        except Exception as e:
            logger.error(f"Error in generate_html: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            # Fallback to simple HTML
            escaped_content = escape(content[:1000])
            return f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>{escape(filename)}</title>
</head>
<body>
    <pre>{escaped_content}</pre>
</body>
</html>"""

def generate_html_file_tool(tool_use: ToolUse) -> ToolResult:
    """
    Main tool function for HTML generation.
    Generates an interactive HTML file and uploads it to S3.
    
    Args:
        tool_use: ToolUse object with input parameters
        
    Returns:
        ToolResult with success message and file reference
    """
    try:
        input_data = tool_use["input"]
        filename = input_data.get("filename")
        content = input_data.get("content")
        title = input_data.get("title")
        
        if not filename:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: filename parameter is required"}]
            }
        
        if not content:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: content parameter is required"}]
            }
        
        # Get environment variables
        user_id = os.environ.get('USER_ID')
        session_id = os.environ.get('SESSION_ID')
        
        if not user_id or not session_id:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: Missing required environment variables (user_id, session_id)"}]
            }
        
        # Ensure filename has .html extension
        if not filename.endswith('.html'):
            filename = f"{filename}.html"
        
        # Generate HTML content
        generator = HTMLGenerator()
        html_content = generator.generate_html(content, filename, title)
        
        # Upload to S3 using unified file upload function
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
                    'generated_by': 'html_generator_tool',
                    'title': title or filename
                }
            )
            
            logger.info(f"Generated HTML file: {filename}")
            
            # Return success message with file reference
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "success",
                "content": [{"text": result}]
            }
            
        except ImportError:
            logger.warning("lambda_invocation module not available - falling back to manual upload")
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: Shared file upload module not available"}]
            }
        
    except Exception as e:
        logger.error(f"Error in generate_html_file_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "error",
            "content": [{"text": f"Error generating HTML file: {str(e)}"}]
        }

