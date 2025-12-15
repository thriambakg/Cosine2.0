"""
Image Reader Tool - Reads and analyzes images from S3
Single-purpose tool for image inspection/validation
"""

import os
import logging
import boto3
import base64
from typing import Dict, Any, Optional
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
    "name": "read_image_tool",
    "description": "Read and analyze image from S3. Returns image metadata, base64 data, and basic validation. Used by planner to inspect intermediate chart/image results.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "s3_key": {
                    "type": "string",
                    "description": "S3 key of the image file"
                },
                "include_base64": {
                    "type": "boolean",
                    "description": "Whether to include base64-encoded image data",
                    "default": True
                },
                "validate": {
                    "type": "boolean",
                    "description": "Whether to validate image is readable",
                    "default": True
                }
            },
            "required": ["s3_key"]
        }
    }
}

def read_image_tool(tool_use: ToolUse) -> ToolResult:
    """
    Read and analyze image from S3.
    
    Args:
        tool_use: ToolUse object with input parameters
        
    Returns:
        ToolResult with image metadata and optionally base64 data
    """
    try:
        import json
        
        input_data = tool_use["input"]
        s3_key = input_data.get("s3_key")
        include_base64 = input_data.get("include_base64", True)
        validate = input_data.get("validate", True)
        
        if not s3_key:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: s3_key parameter is required"}]
            }
        
        s3_client = boto3.client('s3')
        bucket_name = os.environ.get('CHAT_FILES_BUCKET_NAME') or os.environ.get('AGENT_FILES_BUCKET_NAME')
        
        if not bucket_name:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: S3 bucket name not configured"}]
            }
        
        try:
            # Get image from S3
            response = s3_client.get_object(Bucket=bucket_name, Key=s3_key)
            image_data = response['Body'].read()
            content_type = response.get('ContentType', 'image/png')
            metadata = response.get('Metadata', {})
            
            # Get file size
            file_size = len(image_data)
            
            # Determine image format
            image_format = 'unknown'
            if s3_key.endswith('.png'):
                image_format = 'png'
            elif s3_key.endswith('.jpg') or s3_key.endswith('.jpeg'):
                image_format = 'jpeg'
            elif s3_key.endswith('.gif'):
                image_format = 'gif'
            elif s3_key.endswith('.webp'):
                image_format = 'webp'
            
            result_data = {
                "s3_key": s3_key,
                "filename": s3_key.split('/')[-1],
                "file_size": file_size,
                "content_type": content_type,
                "image_format": image_format,
                "metadata": metadata,
                "status": "success"
            }
            
            # Validate image if requested
            if validate:
                try:
                    from PIL import Image as PILImage
                    img = PILImage.open(BytesIO(image_data))
                    result_data["validation"] = {
                        "valid": True,
                        "width": img.width,
                        "height": img.height,
                        "mode": img.mode
                    }
                except ImportError:
                    result_data["validation"] = {
                        "valid": True,
                        "note": "PIL not available, cannot validate dimensions"
                    }
                except Exception as e:
                    result_data["validation"] = {
                        "valid": False,
                        "error": str(e)
                    }
            
            # Include base64 if requested
            if include_base64:
                image_base64 = base64.b64encode(image_data).decode('utf-8')
                result_data["base64_data"] = image_base64
                result_data["data_uri"] = f"data:{content_type};base64,{image_base64}"
            
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "success",
                "content": [{"text": json.dumps(result_data, indent=2)}]
            }
            
        except s3_client.exceptions.NoSuchKey:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": f"Error: Image not found at S3 key: {s3_key}"}]
            }
        except Exception as e:
            logger.error(f"Error reading image from S3: {str(e)}")
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": f"Error reading image: {str(e)}"}]
            }
        
    except Exception as e:
        logger.error(f"Error in read_image_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "error",
            "content": [{"text": f"Error reading image: {str(e)}"}]
        }

