"""
File Uploader Tool - Uploads files to S3
Single-purpose tool for file uploads
"""

import os
import logging
from typing import Dict, Any, Optional, Union

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
    "name": "upload_file_tool",
    "description": "Upload file content to S3. Handles both text and binary content, sets metadata, and notifies the agent files processor.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "File content (string or base64-encoded bytes for binary files)"
                },
                "filename": {
                    "type": "string",
                    "description": "Name of the file (with extension)"
                },
                "file_type": {
                    "type": "string",
                    "description": "File type (txt, pdf, html, png, csv, etc.)"
                },
                "content_type": {
                    "type": "string",
                    "description": "MIME content type (auto-detected if not provided)"
                },
                "folder": {
                    "type": "string",
                    "description": "S3 folder: 'agent-files' (final files) or 'data-files' (intermediate data)",
                    "enum": ["agent-files", "data-files"],
                    "default": "agent-files"
                },
                "metadata": {
                    "type": "object",
                    "description": "Additional metadata to attach to the file"
                },
                "is_base64": {
                    "type": "boolean",
                    "description": "Whether content is base64-encoded (for binary files)",
                    "default": False
                }
            },
            "required": ["content", "filename", "file_type"]
        }
    }
}

def upload_file_tool(tool_use: ToolUse) -> ToolResult:
    """
    Main tool function for file upload.
    
    Args:
        tool_use: ToolUse object with input parameters
        
    Returns:
        ToolResult with upload result and S3 key
    """
    try:
        import json
        import base64
        
        input_data = tool_use["input"]
        content = input_data.get("content")
        filename = input_data.get("filename")
        file_type = input_data.get("file_type")
        content_type = input_data.get("content_type")
        folder = input_data.get("folder", "agent-files")
        metadata = input_data.get("metadata", {})
        is_base64 = input_data.get("is_base64", False)
        
        if not content:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: content parameter is required"}]
            }
        
        if not filename:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: filename parameter is required"}]
            }
        
        if not file_type:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: file_type parameter is required"}]
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
        
        # Decode base64 if needed
        if is_base64:
            try:
                content = base64.b64decode(content)
            except Exception as e:
                return {
                    "toolUseId": tool_use["toolUseId"],
                    "status": "error",
                    "content": [{"text": f"Error: Failed to decode base64 content: {str(e)}"}]
                }
        
        # Use unified file upload function
        try:
            from lambda_invocation import upload_file_and_notify
            
            # Prepare metadata
            upload_metadata = {
                'generated_by': 'file_uploader_tool',
                **metadata
            }
            
            result = upload_file_and_notify(
                content=content,
                filename=filename,
                user_id=user_id,
                session_id=session_id,
                file_type=file_type,
                content_type=content_type,
                folder=folder,
                metadata=upload_metadata
            )
            
            # Extract S3 key from result or construct it
            s3_key = f"users/{user_id}/sessions/{session_id}/{folder}/{filename}"
            
            # Return structured result
            result_data = {
                "message": result,
                "s3_key": s3_key,
                "filename": filename,
                "file_type": file_type,
                "folder": folder
            }
            
            logger.info(f"Uploaded file: {filename} to {s3_key}")
            
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "success",
                "content": [{"text": json.dumps(result_data, indent=2)}]
            }
            
        except ImportError:
            logger.warning("lambda_invocation module not available")
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: Shared file upload module not available"}]
            }
        
    except Exception as e:
        logger.error(f"Error in upload_file_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "error",
            "content": [{"text": f"Error uploading file: {str(e)}"}]
        }

