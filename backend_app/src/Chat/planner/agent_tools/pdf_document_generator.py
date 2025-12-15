"""
PDF Document Generator - Planner tool for generating PDF reports

This tool is available to the planner (LLM) for generating nuanced PDF documents.
It handles formatting, chart embedding, and proper PDF structure.
"""

import json
import re
import logging
import boto3
import os
from io import BytesIO
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)


def generate_pdf_document(
    content: str,
    title: str,
    chart_s3_keys: list = None,
    format_decimals: bool = True
) -> bytes:
    """
    Generate a complete PDF document with proper formatting and embedded charts.
    
    This is a planner tool - the planner can call this to generate PDF documents
    with intelligent formatting, chart embedding, and proper structure.
    
    Args:
        content: Markdown or text content to convert to PDF
        title: Document title
        chart_s3_keys: List of S3 keys for chart images to embed
        format_decimals: Whether to format decimal values as percentages
        
    Returns:
        PDF file as bytes
    """
    try:
        from reportlab.lib.pagesizes import letter, A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Image
        from reportlab.lib.enums import TA_LEFT, TA_CENTER
        from .content_formatter import format_financial_content
    except ImportError:
        logger.error("ReportLab not available for PDF generation")
        raise
    
    try:
        # Format decimal values if requested
        if format_decimals:
            content = format_financial_content(content)
        
        # Extract chart S3 keys from content if not provided
        if chart_s3_keys is None:
            chart_s3_keys = _extract_chart_s3_keys(content)
        
        # Create PDF in memory
        buffer = BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=letter, topMargin=0.5*inch, bottomMargin=0.5*inch)
        
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
        
        # Add title
        story.append(Paragraph(title, title_style))
        story.append(Spacer(1, 0.3*inch))
        
        # Embed chart images first
        for s3_key in chart_s3_keys:
            img = _embed_image_from_s3(s3_key)
            if img:
                story.append(Spacer(1, 0.2*inch))
                story.append(img)
                story.append(Spacer(1, 0.2*inch))
        
        # Convert content to PDF elements
        lines = content.split('\n')
        for line in lines:
            line = line.strip()
            
            # Remove S3 key references (already embedded)
            line = re.sub(r'users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>]+\.(png|jpg|jpeg|gif)', '[Chart embedded above]', line)
            line = re.sub(r'\{"s3_key":\s*"[^"]+"[^}]*\}', '[Chart embedded above]', line)
            line = re.sub(r'\{"message":\s*"[^"]*",\s*"s3_key":\s*"[^"]+"[^}]*\}', '[Chart embedded above]', line)
            
            # Remove template syntax (Handlebars, etc.) - planner shouldn't use these
            # Remove Handlebars-style loops and conditionals
            line = re.sub(r'\{\{#each[^}]+\}\}', '', line)
            line = re.sub(r'\{\{/@?index\}\}', '', line)
            line = re.sub(r'\{\{this\}\}', '', line)
            line = re.sub(r'\{\{/each\}\}', '', line)
            line = re.sub(r'\{\{#if[^}]+\}\}', '', line)
            line = re.sub(r'\{\{/if\}\}', '', line)
            # Remove any remaining template placeholders that weren't resolved
            line = re.sub(r'\{\{[^}]+\}\}', '', line)
            
            if not line:
                story.append(Spacer(1, 0.1*inch))
                continue
            
            # Markdown to PDF conversion
            if line.startswith('# '):
                story.append(Paragraph(line[2:], title_style))
                story.append(Spacer(1, 0.2*inch))
            elif line.startswith('## '):
                story.append(Paragraph(line[3:], heading_style))
                story.append(Spacer(1, 0.15*inch))
            elif line.startswith('### '):
                story.append(Paragraph(line[4:], heading_style))
                story.append(Spacer(1, 0.1*inch))
            else:
                # Regular paragraph (escape HTML and format)
                from reportlab.lib.utils import simpleSplit
                para = Paragraph(line, normal_style)
                story.append(para)
                story.append(Spacer(1, 0.05*inch))
        
        # Build PDF
        doc.build(story)
        buffer.seek(0)
        return buffer.getvalue()
    except Exception as e:
        logger.error(f"Error generating PDF: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        raise


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


def _embed_image_from_s3(s3_key: str, max_width: float = None, max_height: float = None):
    """Download image from S3 and return Image element for PDF"""
    try:
        from reportlab.platypus import Image
        from reportlab.lib.units import inch
        from io import BytesIO
        
        # Set defaults using inch (now imported)
        if max_width is None:
            max_width = 6 * inch
        if max_height is None:
            max_height = 4 * inch
        
        s3_client = boto3.client('s3')
        bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
        
        if not bucket_name:
            logger.warning(f"Cannot embed image: bucket name not configured")
            return None
        
        # Download image from S3
        response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
        image_data = response['Body'].read()
        
        # Create Image from bytes
        img_buffer = BytesIO(image_data)
        img = Image(img_buffer, width=max_width, height=max_height, kind='proportional')
        return img
    except Exception as e:
        logger.error(f"Error embedding image from S3 {s3_key}: {str(e)}")
        return None

