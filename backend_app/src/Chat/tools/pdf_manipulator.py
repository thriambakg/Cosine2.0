"""
PDF Manipulator Tool - Advanced PDF manipulation operations
Single-purpose tool for modifying existing PDFs (merge, split, extract, rotate, delete pages, form filling, security)
"""

import logging
import os
import json
import boto3
from typing import Dict, Any, List, Optional
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
    "name": "manipulate_pdf_tool",
    "description": "Advanced PDF manipulation: merge, split, extract, rotate, delete pages, fill forms, encrypt/decrypt. Works with existing PDFs from S3.",
    "inputSchema": {
        "json": {
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "description": "Operation to perform",
                    "enum": ["merge", "split", "extract", "rotate", "delete_pages", "add_content", "modify_content", "fill_form", "encrypt", "decrypt"]
                },
                "source_pdf_s3_key": {
                    "type": "string",
                    "description": "S3 key of source PDF file"
                },
                "source_pdf_s3_keys": {
                    "type": "array",
                    "description": "For merge operation: list of S3 keys of PDFs to merge",
                    "items": {"type": "string"}
                },
                "page_numbers": {
                    "type": "array",
                    "description": "For extract/delete/rotate: page numbers (1-indexed)",
                    "items": {"type": "integer"}
                },
                "rotation_angle": {
                    "type": "integer",
                    "description": "For rotate: rotation angle in degrees (90, 180, 270)",
                    "enum": [90, 180, 270]
                },
                "new_content": {
                    "type": "string",
                    "description": "For add_content: text/markdown content to add"
                },
                "content_position": {
                    "type": "object",
                    "description": "For add_content: position coordinates {x, y, page}",
                    "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "page": {"type": "integer"}
                    }
                },
                "form_data": {
                    "type": "object",
                    "description": "For fill_form: form field values {field_name: value}"
                },
                "password": {
                    "type": "string",
                    "description": "For encrypt: password to protect PDF"
                },
                "output_filename": {
                    "type": "string",
                    "description": "Output filename (without .pdf extension)"
                }
            },
            "required": ["operation", "source_pdf_s3_key"]
        }
    }
}

class PDFManipulator:
    """Handles advanced PDF manipulation operations"""
    
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
    
    def _write_pdf_to_s3(self, pdf_bytes: bytes, filename: str) -> str:
        """Write PDF to S3 and return S3 key"""
        try:
            from lambda_invocation import upload_file_and_notify
            
            user_id = os.environ.get('USER_ID')
            session_id = os.environ.get('SESSION_ID')
            
            if not user_id or not session_id:
                raise ValueError("Missing USER_ID or SESSION_ID")
            
            # Ensure filename has .pdf extension
            if not filename.endswith('.pdf'):
                filename = f"{filename}.pdf"
            
            # Upload PDF
            result = upload_file_and_notify(
                content=pdf_bytes,
                filename=filename,
                user_id=user_id,
                session_id=session_id,
                file_type='pdf',
                content_type='application/pdf',
                folder="agent-files",
                is_base64=False
            )
            
            # Extract S3 key from result
            if isinstance(result, dict):
                return result.get('s3_key', '')
            elif isinstance(result, str):
                # Try to parse if it's JSON string
                try:
                    result_dict = json.loads(result)
                    return result_dict.get('s3_key', '')
                except:
                    return result
            return result
        except ImportError:
            logger.warning("lambda_invocation not available, using manual upload")
            # Manual upload fallback
            user_id = os.environ.get('USER_ID')
            session_id = os.environ.get('SESSION_ID')
            s3_key = f"users/{user_id}/sessions/{session_id}/agent-files/{filename}"
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=pdf_bytes,
                ContentType='application/pdf'
            )
            return s3_key
    
    def merge_pdfs(self, pdf_s3_keys: List[str], output_filename: str) -> bytes:
        """Merge multiple PDFs into one"""
        try:
            from pypdf import PdfWriter
            
            writer = PdfWriter()
            
            for s3_key in pdf_s3_keys:
                pdf_bytes = self._read_pdf_from_s3(s3_key)
                from pypdf import PdfReader
                reader = PdfReader(BytesIO(pdf_bytes))
                for page in reader.pages:
                    writer.add_page(page)
            
            output_buffer = BytesIO()
            writer.write(output_buffer)
            return output_buffer.getvalue()
        except ImportError:
            # Fallback to PyPDF2
            try:
                from PyPDF2 import PdfFileMerger
                merger = PdfFileMerger()
                
                for s3_key in pdf_s3_keys:
                    pdf_bytes = self._read_pdf_from_s3(s3_key)
                    merger.append(BytesIO(pdf_bytes))
                
                output_buffer = BytesIO()
                merger.write(output_buffer)
                merger.close()
                return output_buffer.getvalue()
            except ImportError:
                raise ImportError("Neither pypdf nor PyPDF2 available for PDF merging")
    
    def split_pdf(self, source_s3_key: str, page_ranges: List[Dict[str, int]], output_filenames: List[str]) -> List[bytes]:
        """Split PDF into multiple files by page ranges"""
        try:
            from pypdf import PdfReader, PdfWriter
            
            pdf_bytes = self._read_pdf_from_s3(source_s3_key)
            reader = PdfReader(BytesIO(pdf_bytes))
            
            results = []
            for page_range, filename in zip(page_ranges, output_filenames):
                writer = PdfWriter()
                start_page = page_range.get('start', 1) - 1  # Convert to 0-indexed
                end_page = page_range.get('end', len(reader.pages))
                
                for page_num in range(start_page, min(end_page, len(reader.pages))):
                    writer.add_page(reader.pages[page_num])
                
                output_buffer = BytesIO()
                writer.write(output_buffer)
                results.append(output_buffer.getvalue())
            
            return results
        except ImportError:
            raise ImportError("pypdf required for PDF splitting")
    
    def extract_pages(self, source_s3_key: str, page_numbers: List[int]) -> bytes:
        """Extract specific pages from PDF"""
        try:
            from pypdf import PdfReader, PdfWriter
            
            pdf_bytes = self._read_pdf_from_s3(source_s3_key)
            reader = PdfReader(BytesIO(pdf_bytes))
            writer = PdfWriter()
            
            # Convert to 0-indexed
            for page_num in page_numbers:
                if 1 <= page_num <= len(reader.pages):
                    writer.add_page(reader.pages[page_num - 1])
            
            output_buffer = BytesIO()
            writer.write(output_buffer)
            return output_buffer.getvalue()
        except ImportError:
            raise ImportError("pypdf required for page extraction")
    
    def rotate_pages(self, source_s3_key: str, page_numbers: List[int], angle: int) -> bytes:
        """Rotate specific pages in PDF"""
        try:
            from pypdf import PdfReader, PdfWriter
            
            pdf_bytes = self._read_pdf_from_s3(source_s3_key)
            reader = PdfReader(BytesIO(pdf_bytes))
            writer = PdfWriter()
            
            for page_num in range(len(reader.pages)):
                page = reader.pages[page_num]
                # Rotate if this page is in the list (convert to 1-indexed for comparison)
                if (page_num + 1) in page_numbers:
                    page.rotate(angle)
                writer.add_page(page)
            
            output_buffer = BytesIO()
            writer.write(output_buffer)
            return output_buffer.getvalue()
        except ImportError:
            raise ImportError("pypdf required for page rotation")
    
    def delete_pages(self, source_s3_key: str, page_numbers: List[int]) -> bytes:
        """Delete specific pages from PDF"""
        try:
            from pypdf import PdfReader, PdfWriter
            
            pdf_bytes = self._read_pdf_from_s3(source_s3_key)
            reader = PdfReader(BytesIO(pdf_bytes))
            writer = PdfWriter()
            
            # Convert to 0-indexed and sort
            pages_to_delete = sorted([p - 1 for p in page_numbers if 1 <= p <= len(reader.pages)])
            
            for page_num in range(len(reader.pages)):
                if page_num not in pages_to_delete:
                    writer.add_page(reader.pages[page_num])
            
            output_buffer = BytesIO()
            writer.write(output_buffer)
            return output_buffer.getvalue()
        except ImportError:
            raise ImportError("pypdf required for page deletion")
    
    def add_content(self, source_s3_key: str, content: str, position: Dict[str, Any]) -> bytes:
        """Add new content (text/image) to existing PDF at specified coordinates"""
        try:
            from pypdf import PdfReader, PdfWriter
            from reportlab.pdfgen import canvas
            from reportlab.lib.pagesizes import letter
            from io import BytesIO
            
            pdf_bytes = self._read_pdf_from_s3(source_s3_key)
            reader = PdfReader(BytesIO(pdf_bytes))
            
            # Create overlay with new content
            overlay_buffer = BytesIO()
            c = canvas.Canvas(overlay_buffer, pagesize=letter)
            
            page_num = position.get('page', 1) - 1
            x = position.get('x', 100)
            y = position.get('y', 700)
            
            # Add text content
            c.drawString(x, y, content)
            c.save()
            
            # Merge overlay with original PDF
            overlay_reader = PdfReader(overlay_buffer)
            overlay_page = overlay_reader.pages[0]
            
            writer = PdfWriter()
            for i, page in enumerate(reader.pages):
                if i == page_num:
                    # Merge overlay with this page
                    page.merge_page(overlay_page)
                writer.add_page(page)
            
            output_buffer = BytesIO()
            writer.write(output_buffer)
            return output_buffer.getvalue()
        except ImportError:
            raise ImportError("pypdf and reportlab required for adding content")
    
    def fill_form(self, source_s3_key: str, form_data: Dict[str, Any]) -> bytes:
        """Fill PDF form fields"""
        try:
            from pypdf import PdfReader, PdfWriter
            
            pdf_bytes = self._read_pdf_from_s3(source_s3_key)
            reader = PdfReader(BytesIO(pdf_bytes))
            
            # Check if PDF has form fields
            if '/AcroForm' not in reader.trailer['/Root']:
                raise ValueError("PDF does not contain form fields")
            
            writer = PdfWriter()
            writer.clone_reader_document_root(reader)
            
            # Fill form fields
            writer.update_page_form_field_values(writer.pages[0], form_data)
            
            output_buffer = BytesIO()
            writer.write(output_buffer)
            return output_buffer.getvalue()
        except ImportError:
            raise ImportError("pypdf required for form filling")
        except Exception as e:
            logger.error(f"Error filling form: {str(e)}")
            raise
    
    def encrypt_pdf(self, source_s3_key: str, password: str) -> bytes:
        """Encrypt PDF with password"""
        try:
            from pypdf import PdfReader, PdfWriter
            
            pdf_bytes = self._read_pdf_from_s3(source_s3_key)
            reader = PdfReader(BytesIO(pdf_bytes))
            writer = PdfWriter()
            
            # Copy all pages
            for page in reader.pages:
                writer.add_page(page)
            
            # Encrypt with password
            writer.encrypt(password)
            
            output_buffer = BytesIO()
            writer.write(output_buffer)
            return output_buffer.getvalue()
        except ImportError:
            raise ImportError("pypdf required for PDF encryption")
    
    def decrypt_pdf(self, source_s3_key: str, password: str) -> bytes:
        """Decrypt password-protected PDF"""
        try:
            from pypdf import PdfReader, PdfWriter
            
            pdf_bytes = self._read_pdf_from_s3(source_s3_key)
            reader = PdfReader(BytesIO(pdf_bytes))
            
            # Try to decrypt
            if reader.is_encrypted:
                reader.decrypt(password)
            
            writer = PdfWriter()
            for page in reader.pages:
                writer.add_page(page)
            
            output_buffer = BytesIO()
            writer.write(output_buffer)
            return output_buffer.getvalue()
        except ImportError:
            raise ImportError("pypdf required for PDF decryption")
        except Exception as e:
            logger.error(f"Error decrypting PDF: {str(e)}")
            raise

def manipulate_pdf_tool(tool_use: ToolUse) -> ToolResult:
    """
    Main tool function for PDF manipulation.
    
    Args:
        tool_use: ToolUse object with input parameters
        
    Returns:
        ToolResult with success message and S3 key of output PDF
    """
    try:
        input_data = tool_use["input"]
        operation = input_data.get("operation")
        source_pdf_s3_key = input_data.get("source_pdf_s3_key")
        output_filename = input_data.get("output_filename", "manipulated.pdf")
        
        if not operation:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: operation parameter is required"}]
            }
        
        if not source_pdf_s3_key and operation != "merge":
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": "Error: source_pdf_s3_key parameter is required"}]
            }
        
        manipulator = PDFManipulator()
        pdf_bytes = None
        
        if operation == "merge":
            source_pdf_s3_keys = input_data.get("source_pdf_s3_keys", [])
            if not source_pdf_s3_keys:
                return {
                    "toolUseId": tool_use["toolUseId"],
                    "status": "error",
                    "content": [{"text": "Error: source_pdf_s3_keys required for merge operation"}]
                }
            pdf_bytes = manipulator.merge_pdfs(source_pdf_s3_keys, output_filename)
        
        elif operation == "extract":
            page_numbers = input_data.get("page_numbers", [])
            if not page_numbers:
                return {
                    "toolUseId": tool_use["toolUseId"],
                    "status": "error",
                    "content": [{"text": "Error: page_numbers required for extract operation"}]
                }
            pdf_bytes = manipulator.extract_pages(source_pdf_s3_key, page_numbers)
        
        elif operation == "rotate":
            page_numbers = input_data.get("page_numbers", [])
            rotation_angle = input_data.get("rotation_angle", 90)
            if not page_numbers:
                return {
                    "toolUseId": tool_use["toolUseId"],
                    "status": "error",
                    "content": [{"text": "Error: page_numbers required for rotate operation"}]
                }
            pdf_bytes = manipulator.rotate_pages(source_pdf_s3_key, page_numbers, rotation_angle)
        
        elif operation == "delete_pages":
            page_numbers = input_data.get("page_numbers", [])
            if not page_numbers:
                return {
                    "toolUseId": tool_use["toolUseId"],
                    "status": "error",
                    "content": [{"text": "Error: page_numbers required for delete_pages operation"}]
                }
            pdf_bytes = manipulator.delete_pages(source_pdf_s3_key, page_numbers)
        
        elif operation == "add_content":
            new_content = input_data.get("new_content")
            content_position = input_data.get("content_position", {"x": 100, "y": 700, "page": 1})
            if not new_content:
                return {
                    "toolUseId": tool_use["toolUseId"],
                    "status": "error",
                    "content": [{"text": "Error: new_content required for add_content operation"}]
                }
            pdf_bytes = manipulator.add_content(source_pdf_s3_key, new_content, content_position)
        
        elif operation == "fill_form":
            form_data = input_data.get("form_data", {})
            if not form_data:
                return {
                    "toolUseId": tool_use["toolUseId"],
                    "status": "error",
                    "content": [{"text": "Error: form_data required for fill_form operation"}]
                }
            pdf_bytes = manipulator.fill_form(source_pdf_s3_key, form_data)
        
        elif operation == "encrypt":
            password = input_data.get("password")
            if not password:
                return {
                    "toolUseId": tool_use["toolUseId"],
                    "status": "error",
                    "content": [{"text": "Error: password required for encrypt operation"}]
                }
            pdf_bytes = manipulator.encrypt_pdf(source_pdf_s3_key, password)
        
        elif operation == "decrypt":
            password = input_data.get("password")
            if not password:
                return {
                    "toolUseId": tool_use["toolUseId"],
                    "status": "error",
                    "content": [{"text": "Error: password required for decrypt operation"}]
                }
            pdf_bytes = manipulator.decrypt_pdf(source_pdf_s3_key, password)
        
        else:
            return {
                "toolUseId": tool_use["toolUseId"],
                "status": "error",
                "content": [{"text": f"Error: Unknown operation '{operation}'"}]
            }
        
        # Upload result to S3
        s3_key = manipulator._write_pdf_to_s3(pdf_bytes, output_filename)
        
        result_data = {
            "message": f"Successfully performed {operation} operation on PDF",
            "s3_key": s3_key,
            "filename": output_filename if output_filename.endswith('.pdf') else f"{output_filename}.pdf",
            "size_bytes": len(pdf_bytes)
        }
        
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "success",
            "content": [{"text": json.dumps(result_data, indent=2)}]
        }
        
    except Exception as e:
        logger.error(f"Error in manipulate_pdf_tool: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "toolUseId": tool_use["toolUseId"],
            "status": "error",
            "content": [{"text": f"Error manipulating PDF: {str(e)}"}]
        }

