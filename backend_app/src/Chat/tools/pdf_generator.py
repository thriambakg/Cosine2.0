"""
PDF Generator Tool - Generates PDF documents from content
Single-purpose tool for PDF generation
"""

import logging
import os
import boto3
from typing import Dict, Any, List, Optional
from io import BytesIO

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
    "name": "generate_pdf_tool",
    "description": "Generate PDF document from text/markdown content. Supports embedded images (use embed_images_tool first to get PDF Image objects).",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Text/markdown content to convert to PDF"
                },
                "filename": {
                    "type": "string",
                    "description": "Filename for metadata (without .pdf extension)"
                },
                "pdf_images": {
                    "type": "array",
                    "description": "Optional: List of PDF Image objects from embed_images_tool (target_format='pdf')",
                    "items": {
                        "type": "object",
                        "properties": {
                            "s3_key": {"type": "string"},
                            "image_data": {"type": "string", "description": "Base64-encoded image data"}
                        }
                    }
                },
                "page_size": {
                    "type": "string",
                    "description": "Page size: 'letter' or 'A4'",
                    "enum": ["letter", "A4"],
                    "default": "letter"
                }
            },
            "required": ["content"]
        }
    }
}

class PDFGenerator:
    """Generates PDF documents from content with advanced manipulation capabilities"""
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
        self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
    
    def _read_pdf_from_s3(self, s3_key: str) -> bytes:
        """Read PDF file from S3"""
        try:
            if not self.bucket_name:
                raise ValueError("S3 bucket name not configured")
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            return response['Body'].read()
        except Exception as e:
            logger.error(f"Error reading PDF from S3 {s3_key}: {str(e)}")
            raise
    
    def _download_image_from_s3(self, s3_key: str) -> bytes:
        """Download image from S3"""
        try:
            if not self.bucket_name:
                raise ValueError("S3 bucket name not configured")
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            return response['Body'].read()
        except Exception as e:
            logger.error(f"Error downloading image from S3 {s3_key}: {str(e)}")
            return None
    
    def _create_pdf_image_from_base64(self, image_data_base64: str, max_width: float = 6.0, max_height: float = 4.0):
        """Create ReportLab Image from base64 data"""
        try:
            from reportlab.platypus import Image
            from reportlab.lib.units import inch
            import base64
            
            image_bytes = base64.b64decode(image_data_base64)
            img_buffer = BytesIO(image_bytes)
            img = Image(img_buffer, width=max_width*inch, height=max_height*inch, kind='proportional')
            return img
        except Exception as e:
            logger.error(f"Error creating PDF image from base64: {str(e)}")
            return None
    
    def _extract_chart_s3_keys(self, content: str) -> List[str]:
        """Extract chart S3 keys from content - handles JSON parsing internally"""
        import json
        import re
        
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
        
        # Look for markdown image syntax: ![Chart](s3_key)
        markdown_pattern = r'!\[.*?\]\((users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>\)]+\.(png|jpg|jpeg|gif))\)'
        markdown_matches = re.findall(markdown_pattern, content)
        for match in markdown_matches:
            s3_key = match[0] if isinstance(match, tuple) else match
            if s3_key not in chart_s3_keys:
                chart_s3_keys.append(s3_key)
        
        return chart_s3_keys
    
    def generate(self, content: str, filename: str = "report.pdf", pdf_images: Optional[List[Dict[str, Any]]] = None, page_size: str = "letter") -> bytes:
        """
        Generate PDF from content.
        
        Args:
            content: Text/markdown content
            filename: Filename for metadata
            pdf_images: Optional list of PDF Image objects or image data dicts
            page_size: Page size ('letter' or 'A4')
            
        Returns:
            PDF bytes
        """
        try:
            from reportlab.lib.pagesizes import letter, A4
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib.units import inch
            from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
            from reportlab.lib.enums import TA_LEFT, TA_CENTER
            from html import escape
            import re
            
            # Select page size
            pagesize = letter if page_size == "letter" else A4
            
            # Create PDF in memory
            buffer = BytesIO()
            doc = SimpleDocTemplate(buffer, pagesize=pagesize, topMargin=0.5*inch, bottomMargin=0.5*inch)
            
            # Build PDF content
            story = []
            styles = getSampleStyleSheet()
            
            # Title style
            title_style = ParagraphStyle(
                'CustomTitle',
                parent=styles['Heading1'],
                fontSize=18,
                textColor='#1a1a1a',
                spaceAfter=12,
                alignment=TA_CENTER
            )
            
            # Heading style
            heading_style = ParagraphStyle(
                'CustomHeading',
                parent=styles['Heading2'],
                fontSize=14,
                textColor='#2c3e50',
                spaceAfter=8,
                spaceBefore=12
            )
            
            # Normal text style
            normal_style = ParagraphStyle(
                'CustomNormal',
                parent=styles['Normal'],
                fontSize=10,
                textColor='#333333',
                spaceAfter=6,
                leading=12
            )
            
            # Extract chart S3 keys from content and download/embed them
            chart_s3_keys = self._extract_chart_s3_keys(content)
            if chart_s3_keys:
                try:
                    from reportlab.platypus import Image
                    for s3_key in chart_s3_keys:
                        # Download image from S3
                        image_bytes = self._download_image_from_s3(s3_key)
                        if image_bytes:
                            img_buffer = BytesIO(image_bytes)
                            pdf_img = Image(img_buffer, width=6*inch, height=4*inch, kind='proportional')
                            if pdf_img:
                                story.append(Spacer(1, 0.2*inch))
                                story.append(pdf_img)
                                story.append(Spacer(1, 0.2*inch))
                                logger.info(f"Embedded chart image from S3: {s3_key}")
                except ImportError:
                    logger.warning("ReportLab Image not available for embedding")
                except Exception as e:
                    logger.error(f"Error embedding chart from S3: {str(e)}")
            
            # Add PDF images if provided (from embed_images_tool)
            if pdf_images:
                try:
                    from reportlab.platypus import Image
                    for img_info in pdf_images:
                        if isinstance(img_info, dict):
                            # Try to get image from embed_images_tool result
                            if 'image_data' in img_info:
                                # Base64 encoded image data
                                pdf_img = self._create_pdf_image_from_base64(img_info['image_data'])
                            elif 's3_key' in img_info:
                                # Download from S3
                                image_bytes = self._download_image_from_s3(img_info['s3_key'])
                                if image_bytes:
                                    img_buffer = BytesIO(image_bytes)
                                    pdf_img = Image(img_buffer, width=6*inch, height=4*inch, kind='proportional')
                                else:
                                    continue
                            else:
                                continue
                            
                            if pdf_img:
                                story.append(Spacer(1, 0.2*inch))
                                story.append(pdf_img)
                                story.append(Spacer(1, 0.2*inch))
                except ImportError:
                    logger.warning("ReportLab Image not available for embedding")
            
            # Parse content and convert to PDF elements
            lines = content.split('\n')
            current_section = []
            
            for line in lines:
                line = line.strip()
                if not line:
                    if current_section:
                        story.extend(current_section)
                        current_section = []
                    story.append(Spacer(1, 0.1*inch))
                    continue
                
                # Remove S3 key references and markdown image syntax (images already embedded above)
                # Remove markdown image syntax: ![Chart](s3_key)
                line = re.sub(r'!\[.*?\]\(users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>\)]+\.(png|jpg|jpeg|gif)\)', '[Chart embedded above]', line)
                # Remove direct S3 key references
                line = re.sub(r'users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>]+\.(png|jpg|jpeg|gif)', '[Chart embedded above]', line)
                # Remove JSON object references
                line = re.sub(r'\{"s3_key":\s*"[^"]+"[^}]*\}', '[Chart embedded above]', line)
                line = re.sub(r'\{"message":\s*"[^"]*",\s*"s3_key":\s*"[^"]+"[^}]*\}', '[Chart embedded above]', line)
                
                # Detect headings (markdown style or plain text)
                if line.startswith('# '):
                    if current_section:
                        story.extend(current_section)
                        current_section = []
                    story.append(Paragraph(escape(line[2:]), title_style))
                    story.append(Spacer(1, 0.2*inch))
                elif line.startswith('## '):
                    if current_section:
                        story.extend(current_section)
                        current_section = []
                    story.append(Paragraph(escape(line[3:]), heading_style))
                    story.append(Spacer(1, 0.15*inch))
                elif line.startswith('### '):
                    if current_section:
                        story.extend(current_section)
                        current_section = []
                    story.append(Paragraph(escape(line[4:]), styles['Heading3']))
                    story.append(Spacer(1, 0.1*inch))
                else:
                    # Regular paragraph
                    current_section.append(Paragraph(escape(line), normal_style))
            
            if current_section:
                story.extend(current_section)
            
            # Build PDF
            doc.build(story)
            
            # Get PDF bytes
            pdf_bytes = buffer.getvalue()
            buffer.close()
            
            logger.info(f"Generated PDF: {len(pdf_bytes)} bytes")
            return pdf_bytes
            
        except ImportError:
            # ReportLab not available, try fpdf
            logger.warning("ReportLab not available, trying fpdf")
            try:
                from fpdf import FPDF
                
                pdf = FPDF()
                pdf.set_auto_page_break(auto=True, margin=15)
                pdf.add_page()
                pdf.set_font("Arial", size=10)
                
                lines = content.split('\n')
                for line in lines:
                    line = line.replace('#', '').replace('*', '').replace('|', ' ').strip()
                    if line:
                        pdf.cell(0, 5, line, ln=1)
                
                pdf_bytes = pdf.output(dest='S').encode('latin-1')
                logger.info(f"Generated PDF with fpdf: {len(pdf_bytes)} bytes")
                return pdf_bytes
            except ImportError:
                logger.error("Neither reportlab nor fpdf available")
                raise

def generate_pdf_tool(tool_use: ToolUse) -> ToolResult:
    """
    Main tool function for PDF generation.
    
    Args:
        tool_use: ToolUse object with input parameters
        
    Returns:
        ToolResult with PDF bytes (base64-encoded) and metadata
    """
    try:
        import json
        import base64
        
        input_data = tool_use["input"]
        content = input_data.get("content")
        filename = input_data.get("filename", "report.pdf")
        pdf_images = input_data.get("pdf_images")
        page_size = input_data.get("page_size", "letter")
        
        if not content:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: content parameter is required"}]
            }
        
        generator = PDFGenerator()
        pdf_bytes = generator.generate(content, filename, pdf_images, page_size)
        
        # Encode PDF bytes as base64 for JSON transport
        pdf_base64 = base64.b64encode(pdf_bytes).decode('utf-8')
        
        result_data = {
            "pdf_base64": pdf_base64,
            "filename": filename if filename.endswith('.pdf') else f"{filename}.pdf",
            "size_bytes": len(pdf_bytes),
            "message": f"Generated PDF: {len(pdf_bytes)} bytes"
        }
        
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "success",
            "content": [{"text": json.dumps(result_data, indent=2)}]
        }
        
    except Exception as e:
        logger.error(f"Error in generate_pdf_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "error",
            "content": [{"text": f"Error generating PDF: {str(e)}"}]
        }

