"""
Image Embedder Tool - Embeds images from S3 into various file types (PDF, HTML, etc.)
Single-purpose tool for image embedding operations
"""

import json
import os
import re
import logging
import boto3
import base64
from typing import Dict, Any, List, Optional
from io import BytesIO

# Configure logging
logger = logging.getLogger()

# Import agent_logger for WebSocket streaming
try:
    import sys
    sys.path.append(os.path.join(os.path.dirname(__file__), '../..'))
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
    "name": "embed_images_tool",
    "description": "Embed images from S3 into content for various file types (PDF, HTML, etc.). Extracts image references and embeds them appropriately.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Content that may contain image references (S3 keys, JSON with s3_key, etc.)"
                },
                "target_format": {
                    "type": "string",
                    "description": "Target file format: 'pdf', 'html', 'base64'",
                    "enum": ["pdf", "html", "base64"]
                },
                "image_s3_keys": {
                    "type": "array",
                    "description": "Optional: Explicit list of S3 keys to embed. If not provided, will extract from content.",
                    "items": {"type": "string"}
                }
            },
            "required": ["content", "target_format"]
        }
    }
}

class ImageEmbedder:
    """Handles image embedding for various file formats"""
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
        self.bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
    
    def _download_image_from_s3(self, s3_key: str) -> Optional[bytes]:
        """Download image from S3"""
        try:
            if not self.bucket_name:
                logger.warning("Cannot download image: bucket name not configured")
                return None
            
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            return response['Body'].read()
        except Exception as e:
            logger.error(f"Error downloading image from S3 {s3_key}: {str(e)}")
            return None
    
    def _get_image_mime_type(self, s3_key: str) -> str:
        """Determine MIME type from file extension"""
        if s3_key.endswith('.png'):
            return 'image/png'
        elif s3_key.endswith('.jpg') or s3_key.endswith('.jpeg'):
            return 'image/jpeg'
        elif s3_key.endswith('.gif'):
            return 'image/gif'
        elif s3_key.endswith('.webp'):
            return 'image/webp'
        else:
            return 'image/png'
    
    def extract_image_references(self, content: str) -> List[str]:
        """
        Extract image S3 keys from content.
        Supports multiple formats: JSON objects, direct S3 paths, etc.
        """
        image_keys = []
        
        # Try to parse entire content as JSON
        try:
            content_json = json.loads(content)
            if isinstance(content_json, dict) and 's3_key' in content_json:
                image_keys.append(content_json['s3_key'])
            elif isinstance(content_json, list):
                for item in content_json:
                    if isinstance(item, dict) and 's3_key' in item:
                        image_keys.append(item['s3_key'])
        except (json.JSONDecodeError, ValueError):
            pass
        
        # Look for embedded JSON patterns
        json_pattern = r'\{"message":\s*"[^"]*",\s*"s3_key":\s*"([^"]+)"'
        matches = re.findall(json_pattern, content)
        image_keys.extend([m for m in matches if m.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp'))])
        
        simple_json_pattern = r'\{"s3_key":\s*"([^"]+)"'
        simple_matches = re.findall(simple_json_pattern, content)
        image_keys.extend([m for m in simple_matches if m.endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp')) and m not in image_keys])
        
        # Look for direct S3 key references
        s3_key_pattern = r'users/[^/]+/sessions/[^/]+/agent-files/[^\s"\'<>]+\.(png|jpg|jpeg|gif|webp)'
        direct_matches = re.findall(s3_key_pattern, content)
        # Handle tuple results from regex groups
        for match in direct_matches:
            if isinstance(match, tuple):
                # Reconstruct full path
                full_match = re.search(s3_key_pattern, content)
                if full_match:
                    image_keys.append(full_match.group(0))
            else:
                image_keys.append(match)
        
        # Remove duplicates while preserving order
        seen = set()
        unique_keys = []
        for key in image_keys:
            if key not in seen:
                seen.add(key)
                unique_keys.append(key)
        
        return unique_keys
    
    def embed_as_base64(self, s3_key: str) -> Optional[str]:
        """Convert S3 image to base64 data URI"""
        image_data = self._download_image_from_s3(s3_key)
        if not image_data:
            return None
        
        image_base64 = base64.b64encode(image_data).decode('utf-8')
        mime_type = self._get_image_mime_type(s3_key)
        return f"data:{mime_type};base64,{image_base64}"
    
    def embed_as_pdf_image(self, s3_key: str, max_width: float = 6.0, max_height: float = 4.0):
        """
        Convert S3 image to ReportLab Image element for PDF embedding.
        Returns Image object or None.
        """
        try:
            from reportlab.platypus import Image
            from reportlab.lib.units import inch
            
            image_data = self._download_image_from_s3(s3_key)
            if not image_data:
                return None
            
            img_buffer = BytesIO(image_data)
            img = Image(img_buffer, width=max_width*inch, height=max_height*inch, kind='proportional')
            return img
        except ImportError:
            logger.error("ReportLab not available for PDF image embedding")
            return None
        except Exception as e:
            logger.error(f"Error creating PDF image from {s3_key}: {str(e)}")
            return None
    
    def embed_as_html_img_tag(self, s3_key: str, style: str = "max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px;") -> Optional[str]:
        """Convert S3 image to HTML img tag with base64 data URI"""
        data_uri = self.embed_as_base64(s3_key)
        if not data_uri:
            return None
        
        return f'<div style="text-align: center; margin: 20px 0;"><img src="{data_uri}" alt="Chart" style="{style}" /></div>'
    
    def embed_images(self, content: str, target_format: str, image_s3_keys: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Embed images into content based on target format.
        
        Returns:
            Dict with:
            - 'content': Modified content with images embedded
            - 'embedded_images': List of successfully embedded image info
            - 'failed_images': List of failed image S3 keys
        """
        # Extract image keys if not provided
        if image_s3_keys is None:
            image_s3_keys = self.extract_image_references(content)
        
        embedded_images = []
        failed_images = []
        embedded_content_parts = []
        
        if target_format == 'html':
            # For HTML, create img tags
            for s3_key in image_s3_keys:
                img_tag = self.embed_as_html_img_tag(s3_key)
                if img_tag:
                    embedded_content_parts.append(img_tag)
                    embedded_images.append({
                        's3_key': s3_key,
                        'format': 'html',
                        'status': 'success'
                    })
                    logger.info(f"Embedded image as HTML: {s3_key}")
                else:
                    failed_images.append(s3_key)
                    logger.warning(f"Failed to embed image as HTML: {s3_key}")
            
            # Return HTML content with embedded images
            return {
                'content': '\n'.join(embedded_content_parts) + '\n' + content,
                'embedded_images': embedded_images,
                'failed_images': failed_images
            }
        
        elif target_format == 'pdf':
            # For PDF, return image objects and positions
            pdf_images = []
            for s3_key in image_s3_keys:
                pdf_img = self.embed_as_pdf_image(s3_key)
                if pdf_img:
                    pdf_images.append({
                        'image': pdf_img,
                        's3_key': s3_key
                    })
                    embedded_images.append({
                        's3_key': s3_key,
                        'format': 'pdf',
                        'status': 'success'
                    })
                    logger.info(f"Embedded image as PDF: {s3_key}")
                else:
                    failed_images.append(s3_key)
                    logger.warning(f"Failed to embed image as PDF: {s3_key}")
            
            return {
                'content': content,
                'pdf_images': pdf_images,  # List of ReportLab Image objects
                'embedded_images': embedded_images,
                'failed_images': failed_images
            }
        
        elif target_format == 'base64':
            # For base64, return data URIs
            base64_images = {}
            for s3_key in image_s3_keys:
                data_uri = self.embed_as_base64(s3_key)
                if data_uri:
                    base64_images[s3_key] = data_uri
                    embedded_images.append({
                        's3_key': s3_key,
                        'format': 'base64',
                        'status': 'success',
                        'data_uri': data_uri
                    })
                    logger.info(f"Converted image to base64: {s3_key}")
                else:
                    failed_images.append(s3_key)
                    logger.warning(f"Failed to convert image to base64: {s3_key}")
            
            return {
                'content': content,
                'base64_images': base64_images,
                'embedded_images': embedded_images,
                'failed_images': failed_images
            }
        
        else:
            raise ValueError(f"Unsupported target format: {target_format}")

def embed_images_tool(tool_use: ToolUse) -> ToolResult:
    """
    Main tool function for image embedding.
    
    Args:
        tool_use: ToolUse object with input parameters
        
    Returns:
        ToolResult with embedded content and image metadata
    """
    try:
        input_data = tool_use["input"]
        content = input_data.get("content")
        target_format = input_data.get("target_format")
        image_s3_keys = input_data.get("image_s3_keys")
        
        if not content:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: content parameter is required"}]
            }
        
        if not target_format:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: target_format parameter is required"}]
            }
        
        if target_format not in ['pdf', 'html', 'base64']:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": f"Error: Unsupported target_format '{target_format}'. Must be 'pdf', 'html', or 'base64'"}]
            }
        
        embedder = ImageEmbedder()
        result = embedder.embed_images(content, target_format, image_s3_keys)
        
        # Return result as JSON
        result_json = json.dumps(result, indent=2)
        
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "success",
            "content": [{"text": result_json}]
        }
        
    except Exception as e:
        logger.error(f"Error in embed_images_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "error",
            "content": [{"text": f"Error embedding images: {str(e)}"}]
        }

