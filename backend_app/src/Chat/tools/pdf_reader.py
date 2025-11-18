"""
PDF Reader tool for the chat agent to read and analyze PDF files from S3
"""

import json
import os
import logging
import boto3
from typing import Dict, Any, List, Optional
from io import BytesIO
import time

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
    from strands import tool
    # Import successful - no need to log
except ImportError as e:
    logger.warning(f"Could not import Strands types: {e}")
    # Define fallback types for local development
    class ToolResult:
        def __init__(self, content: str, is_error: bool = False):
            self.content = content
            self.is_error = is_error
    
    class ToolUse:
        def __init__(self, name: str, arguments: Dict[str, Any]):
            self.name = name
            self.arguments = arguments

class PDFReader:
    """
    PDF reader that can extract text and analyze PDF content from S3
    """
    
    def __init__(self):
        self.s3_client = boto3.client('s3')
        self.textract_client = boto3.client('textract')
        self.bucket_name = os.environ.get('S3_BUCKET_NAME', 'cosine-uploads')
    
    def read_pdf_from_s3(self, s3_key: str) -> Dict[str, Any]:
        """
        Read PDF file from S3 and extract text content
        
        Args:
            s3_key: S3 key of the PDF file
            
        Returns:
            Dictionary with extracted text and metadata
        """
        try:
            # Download PDF from S3
            response = self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            pdf_content = response['Body'].read()
            
            # Try Textract first for better accuracy, fallback to PyPDF2
            text_content = self._extract_text_with_textract(s3_key)
            if not text_content or len(text_content.strip()) < 50:
                logger.info("Textract extraction insufficient, falling back to PyPDF2")
                text_content = self._extract_text_from_pdf(pdf_content)
            
            # Analyze the content
            analysis = self._analyze_pdf_content(text_content)
            
            return {
                "success": True,
                "s3_key": s3_key,
                "text_content": text_content,
                "analysis": analysis,
                "file_size": len(pdf_content),
                "text_length": len(text_content)
            }
            
        except Exception as e:
            logger.error(f"Error reading PDF from S3: {str(e)}")
            return {
                "success": False,
                "error": f"Failed to read PDF: {str(e)}",
                "s3_key": s3_key
            }
    
    def _extract_text_from_pdf(self, pdf_content: bytes) -> str:
        """Extract text from PDF content using PyPDF2"""
        try:
            import PyPDF2
            
            # Create PDF reader from bytes
            pdf_reader = PyPDF2.PdfReader(BytesIO(pdf_content))
            
            # Extract text from all pages
            text_content = ""
            for page_num in range(len(pdf_reader.pages)):
                page = pdf_reader.pages[page_num]
                text_content += page.extract_text() + "\n"
            
            return text_content.strip()
            
        except ImportError:
            logger.error("PyPDF2 not available, trying alternative method")
            return self._extract_text_fallback(pdf_content)
        except Exception as e:
            logger.error(f"Error extracting text from PDF: {str(e)}")
            return f"Error extracting text: {str(e)}"
    
    def _extract_text_with_textract(self, s3_key: str) -> str:
        """Extract text using Amazon Textract for better accuracy"""
        try:
            # Start document text detection job
            response = self.textract_client.start_document_text_detection(
                DocumentLocation={
                    'S3Object': {
                        'Bucket': self.bucket_name,
                        'Name': s3_key
                    }
                }
            )
            
            job_id = response['JobId']
            logger.info(f"Started Textract job: {job_id}")
            
            # Wait for job to complete
            max_attempts = 30  # 5 minutes max
            for attempt in range(max_attempts):
                time.sleep(10)  # Wait 10 seconds between checks
                
                job_response = self.textract_client.get_document_text_detection(JobId=job_id)
                status = job_response['JobStatus']
                
                if status == 'SUCCEEDED':
                    logger.info(f"Textract job completed successfully")
                    return self._extract_text_from_textract_response(job_response)
                elif status == 'FAILED':
                    logger.error(f"Textract job failed: {job_response.get('StatusMessage', 'Unknown error')}")
                    return ""
                elif status in ['IN_PROGRESS', 'PARTIAL_SUCCESS']:
                    logger.info(f"Textract job in progress, attempt {attempt + 1}/{max_attempts}")
                    continue
                else:
                    logger.warning(f"Unexpected Textract job status: {status}")
                    return ""
            
            logger.warning("Textract job timed out")
            return ""
            
        except Exception as e:
            logger.error(f"Error with Textract extraction: {str(e)}")
            return ""
    
    def _extract_text_from_textract_response(self, response: Dict[str, Any]) -> str:
        """Extract text from Textract response"""
        try:
            text_blocks = []
            
            # Process all pages
            for page in response.get('Blocks', []):
                if page['BlockType'] == 'LINE':
                    text_blocks.append(page['Text'])
            
            # If there are more pages, get them
            next_token = response.get('NextToken')
            while next_token:
                next_response = self.textract_client.get_document_text_detection(
                    JobId=response['JobId'],
                    NextToken=next_token
                )
                
                for page in next_response.get('Blocks', []):
                    if page['BlockType'] == 'LINE':
                        text_blocks.append(page['Text'])
                
                next_token = next_response.get('NextToken')
            
            return '\n'.join(text_blocks)
            
        except Exception as e:
            logger.error(f"Error processing Textract response: {str(e)}")
            return ""
    
    def _analyze_forms_with_textract(self, s3_key: str) -> Dict[str, Any]:
        """Analyze PDF forms using Amazon Textract"""
        try:
            # Start document analysis job for forms and tables
            response = self.textract_client.start_document_analysis(
                DocumentLocation={
                    'S3Object': {
                        'Bucket': self.bucket_name,
                        'Name': s3_key
                    }
                },
                FeatureTypes=['FORMS', 'TABLES']
            )
            
            job_id = response['JobId']
            logger.info(f"Started Textract form analysis job: {job_id}")
            
            # Wait for job to complete
            max_attempts = 30  # 5 minutes max
            for attempt in range(max_attempts):
                time.sleep(10)  # Wait 10 seconds between checks
                
                job_response = self.textract_client.get_document_analysis(JobId=job_id)
                status = job_response['JobStatus']
                
                if status == 'SUCCEEDED':
                    logger.info(f"Textract form analysis job completed successfully")
                    return self._process_form_analysis_response(job_response)
                elif status == 'FAILED':
                    logger.error(f"Textract form analysis job failed: {job_response.get('StatusMessage', 'Unknown error')}")
                    return {"success": False, "error": "Textract job failed"}
                elif status in ['IN_PROGRESS', 'PARTIAL_SUCCESS']:
                    logger.info(f"Textract form analysis job in progress, attempt {attempt + 1}/{max_attempts}")
                    continue
                else:
                    logger.warning(f"Unexpected Textract form analysis job status: {status}")
                    return {"success": False, "error": f"Unexpected status: {status}"}
            
            logger.warning("Textract form analysis job timed out")
            return {"success": False, "error": "Job timed out"}
            
        except Exception as e:
            logger.error(f"Error with Textract form analysis: {str(e)}")
            return {"success": False, "error": f"Textract error: {str(e)}"}
    
    def _process_form_analysis_response(self, response: Dict[str, Any]) -> Dict[str, Any]:
        """Process Textract form analysis response"""
        try:
            forms = []
            tables = []
            key_value_pairs = 0
            
            # Process all blocks
            for block in response.get('Blocks', []):
                if block['BlockType'] == 'KEY_VALUE_SET':
                    if block.get('EntityTypes', []) == ['KEY']:
                        key_value_pairs += 1
                        # Find the corresponding value
                        value_block = self._find_value_block(block, response.get('Blocks', []))
                        if value_block:
                            forms.append({
                                'key': self._get_text_from_block(block, response.get('Blocks', [])),
                                'value': self._get_text_from_block(value_block, response.get('Blocks', []))
                            })
                
                elif block['BlockType'] == 'TABLE':
                    table_info = self._process_table_block(block, response.get('Blocks', []))
                    if table_info:
                        tables.append(table_info)
            
            # Handle pagination if there are more results
            next_token = response.get('NextToken')
            while next_token:
                next_response = self.textract_client.get_document_analysis(
                    JobId=response['JobId'],
                    NextToken=next_token
                )
                
                for block in next_response.get('Blocks', []):
                    if block['BlockType'] == 'KEY_VALUE_SET':
                        if block.get('EntityTypes', []) == ['KEY']:
                            key_value_pairs += 1
                            value_block = self._find_value_block(block, next_response.get('Blocks', []))
                            if value_block:
                                forms.append({
                                    'key': self._get_text_from_block(block, next_response.get('Blocks', [])),
                                    'value': self._get_text_from_block(value_block, next_response.get('Blocks', []))
                                })
                    
                    elif block['BlockType'] == 'TABLE':
                        table_info = self._process_table_block(block, next_response.get('Blocks', []))
                        if table_info:
                            tables.append(table_info)
                
                next_token = next_response.get('NextToken')
            
            return {
                "success": True,
                "form_count": len(forms),
                "table_count": len(tables),
                "key_value_pairs": key_value_pairs,
                "forms": forms,
                "tables": tables
            }
            
        except Exception as e:
            logger.error(f"Error processing form analysis response: {str(e)}")
            return {"success": False, "error": f"Processing error: {str(e)}"}
    
    def _find_value_block(self, key_block: Dict[str, Any], blocks: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Find the value block corresponding to a key block"""
        try:
            key_id = key_block['Id']
            for relationship in key_block.get('Relationships', []):
                if relationship['Type'] == 'VALUE':
                    for value_id in relationship['Ids']:
                        for block in blocks:
                            if block['Id'] == value_id and block['BlockType'] == 'KEY_VALUE_SET':
                                if block.get('EntityTypes', []) == ['VALUE']:
                                    return block
            return None
        except Exception as e:
            logger.error(f"Error finding value block: {str(e)}")
            return None
    
    def _get_text_from_block(self, block: Dict[str, Any], blocks: List[Dict[str, Any]]) -> str:
        """Extract text from a block by following relationships to child blocks"""
        try:
            text_parts = []
            for relationship in block.get('Relationships', []):
                if relationship['Type'] == 'CHILD':
                    for child_id in relationship['Ids']:
                        for child_block in blocks:
                            if child_block['Id'] == child_id and child_block['BlockType'] == 'WORD':
                                text_parts.append(child_block['Text'])
            return ' '.join(text_parts)
        except Exception as e:
            logger.error(f"Error getting text from block: {str(e)}")
            return ""
    
    def _process_table_block(self, table_block: Dict[str, Any], blocks: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Process a table block to extract table information"""
        try:
            rows = 0
            columns = 0
            cells = []
            
            for relationship in table_block.get('Relationships', []):
                if relationship['Type'] == 'CHILD':
                    for child_id in relationship['Ids']:
                        for child_block in blocks:
                            if child_block['Id'] == child_id and child_block['BlockType'] == 'CELL':
                                cells.append(child_block)
                                rows = max(rows, child_block.get('RowIndex', 0))
                                columns = max(columns, child_block.get('ColumnIndex', 0))
            
            return {
                'rows': rows,
                'columns': columns,
                'cell_count': len(cells)
            }
        except Exception as e:
            logger.error(f"Error processing table block: {str(e)}")
            return None
    
    def _extract_text_fallback(self, pdf_content: bytes) -> str:
        """Fallback method if PyPDF2 is not available"""
        try:
            # Try using pdfplumber if available
            import pdfplumber
            
            with pdfplumber.open(BytesIO(pdf_content)) as pdf:
                text_content = ""
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_content += page_text + "\n"
                
                return text_content.strip()
                
        except ImportError:
            logger.error("No PDF reading libraries available")
            return "Error: No PDF reading libraries available. Please ensure PyPDF2 or pdfplumber is installed."
        except Exception as e:
            logger.error(f"Error in fallback PDF extraction: {str(e)}")
            return f"Error in fallback extraction: {str(e)}"
    
    def _analyze_pdf_content(self, text_content: str) -> Dict[str, Any]:
        """Analyze PDF content and extract key information"""
        try:
            if not text_content or len(text_content.strip()) == 0:
                return {
                    "type": "empty",
                    "summary": "PDF appears to be empty or contains no extractable text",
                    "word_count": 0,
                    "page_estimate": 0
                }
            
            # Basic text analysis
            words = text_content.split()
            word_count = len(words)
            char_count = len(text_content)
            
            # Estimate pages (rough approximation)
            page_estimate = max(1, word_count // 250)  # Assume ~250 words per page
            
            # Detect document type based on content
            doc_type = self._detect_document_type(text_content)
            
            # Extract key information
            key_info = self._extract_key_information(text_content)
            
            return {
                "type": doc_type,
                "summary": f"PDF contains {word_count} words across approximately {page_estimate} pages",
                "word_count": word_count,
                "char_count": char_count,
                "page_estimate": page_estimate,
                "key_information": key_info,
                "preview": text_content[:500] + "..." if len(text_content) > 500 else text_content
            }
            
        except Exception as e:
            logger.error(f"Error analyzing PDF content: {str(e)}")
            return {
                "type": "unknown",
                "summary": f"Error analyzing content: {str(e)}",
                "word_count": 0,
                "page_estimate": 0
            }
    
    def _detect_document_type(self, text: str) -> str:
        """Detect the type of document based on content"""
        text_lower = text.lower()
        
        # Financial document indicators
        if any(keyword in text_lower for keyword in ['financial statement', 'balance sheet', 'income statement', 'cash flow', 'revenue', 'profit', 'loss']):
            return "financial_document"
        
        # Legal document indicators
        if any(keyword in text_lower for keyword in ['contract', 'agreement', 'terms and conditions', 'legal', 'liability', 'warranty']):
            return "legal_document"
        
        # Technical document indicators
        if any(keyword in text_lower for keyword in ['technical specification', 'api', 'documentation', 'code', 'function', 'method']):
            return "technical_document"
        
        # Academic document indicators
        if any(keyword in text_lower for keyword in ['abstract', 'introduction', 'conclusion', 'references', 'bibliography', 'research']):
            return "academic_document"
        
        # Report indicators
        if any(keyword in text_lower for keyword in ['report', 'analysis', 'summary', 'findings', 'recommendations']):
            return "report"
        
        return "general_document"
    
    def _extract_key_information(self, text: str) -> Dict[str, Any]:
        """Extract key information from the text"""
        try:
            import re
            
            # Extract dates
            date_patterns = [
                r'\b\d{1,2}/\d{1,2}/\d{4}\b',  # MM/DD/YYYY
                r'\b\d{4}-\d{2}-\d{2}\b',      # YYYY-MM-DD
                r'\b\w+ \d{1,2}, \d{4}\b'      # Month DD, YYYY
            ]
            dates = []
            for pattern in date_patterns:
                dates.extend(re.findall(pattern, text))
            
            # Extract monetary amounts
            money_pattern = r'\$[\d,]+\.?\d*'
            monetary_amounts = re.findall(money_pattern, text)
            
            # Extract percentages
            percentage_pattern = r'\d+\.?\d*%'
            percentages = re.findall(percentage_pattern, text)
            
            # Extract email addresses
            email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
            emails = re.findall(email_pattern, text)
            
            # Extract phone numbers
            phone_pattern = r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b'
            phones = re.findall(phone_pattern, text)
            
            return {
                "dates": list(set(dates))[:10],  # Limit to 10 unique dates
                "monetary_amounts": list(set(monetary_amounts))[:10],
                "percentages": list(set(percentages))[:10],
                "emails": list(set(emails))[:5],
                "phone_numbers": list(set(phones))[:5]
            }
            
        except Exception as e:
            logger.error(f"Error extracting key information: {str(e)}")
            return {}

# Global instance
pdf_reader = PDFReader()

@tool
def read_pdf_tool(s3_key: str) -> str:
    """
    Tool function to read and analyze PDF files from S3
    
    Args:
        s3_key: S3 key of the PDF file to read
        
    Returns:
        String with PDF content and analysis
    """
    try:
        if not s3_key:
            return "Error: s3_key parameter is required"
    
        # Read PDF from S3
        result = pdf_reader.read_pdf_from_s3(s3_key)
        
        if not result["success"]:
            return f"Error reading PDF: {result['error']}"
        
        # Format response for AI
        response_parts = [
            f"PDF Analysis for: {result['s3_key']}",
            f"File Size: {result['file_size']:,} bytes",
            f"Text Length: {result['text_length']:,} characters",
            "",
            "Document Analysis:",
            f"- Type: {result['analysis']['type']}",
            f"- Summary: {result['analysis']['summary']}",
            f"- Word Count: {result['analysis']['word_count']:,}",
            f"- Estimated Pages: {result['analysis']['page_estimate']}"
        ]
        
        # Add key information if available
        if result['analysis'].get('key_information'):
            key_info = result['analysis']['key_information']
            response_parts.append("\nKey Information Found:")
            
            if key_info.get('dates'):
                response_parts.append(f"- Dates: {', '.join(key_info['dates'][:5])}")
            if key_info.get('monetary_amounts'):
                response_parts.append(f"- Monetary Amounts: {', '.join(key_info['monetary_amounts'][:5])}")
            if key_info.get('percentages'):
                response_parts.append(f"- Percentages: {', '.join(key_info['percentages'][:5])}")
            if key_info.get('emails'):
                response_parts.append(f"- Email Addresses: {', '.join(key_info['emails'])}")
            if key_info.get('phone_numbers'):
                response_parts.append(f"- Phone Numbers: {', '.join(key_info['phone_numbers'])}")
        
        # Add content preview
        response_parts.append(f"\nContent Preview:")
        response_parts.append(result['analysis']['preview'])
        
        return "\n".join(response_parts)
        
    except Exception as e:
        logger.error(f"Error in read_pdf_tool: {str(e)}")
        return f"Error reading PDF: {str(e)}"

@tool
def analyze_pdf_content_tool(s3_key: str, analysis_type: str = "summary") -> str:
    """
    Tool function to perform specific analysis on PDF content
    
    Args:
        s3_key: S3 key of the PDF file to analyze
        analysis_type: Type of analysis ('summary', 'financial', 'legal', 'technical')
        
    Returns:
        String with specific analysis results
    """
    try:
        if not s3_key:
            return "Error: s3_key parameter is required"
        
        # Read PDF from S3
        result = pdf_reader.read_pdf_from_s3(s3_key)
        
        if not result["success"]:
            return f"Error reading PDF: {result['error']}"
        
        text_content = result["text_content"]
        
        # Perform specific analysis based on type
        if analysis_type == "financial":
            return _analyze_financial_content(text_content, result['s3_key'])
        elif analysis_type == "legal":
            return _analyze_legal_content(text_content, result['s3_key'])
        elif analysis_type == "technical":
            return _analyze_technical_content(text_content, result['s3_key'])
        else:  # summary
            return _analyze_general_content(text_content, result['s3_key'])
            
    except Exception as e:
        logger.error(f"Error in analyze_pdf_content_tool: {str(e)}")
        return f"Error analyzing PDF: {str(e)}"

@tool
def analyze_pdf_forms_tool(s3_key: str) -> str:
    """
    Tool function to analyze PDF forms using Amazon Textract
    
    Args:
        s3_key: S3 key of the PDF file to analyze
        
    Returns:
        String with form analysis results
    """
    try:
        if not s3_key:
            return "Error: s3_key parameter is required"
        
        # Use Textract for form analysis
        result = pdf_reader._analyze_forms_with_textract(s3_key)
        
        if not result["success"]:
            return f"Error analyzing forms: {result['error']}"
        
        # Format response for AI
        response_parts = [
            f"Form Analysis for: {s3_key}",
            f"Forms detected: {result['form_count']}",
            f"Tables detected: {result['table_count']}",
            f"Key-value pairs: {result['key_value_pairs']}"
        ]
        
        if result.get('forms'):
            response_parts.append("\nForm Fields Found:")
            for form in result['forms'][:10]:  # Limit to first 10 forms
                response_parts.append(f"- {form['key']}: {form['value']}")
        
        if result.get('tables'):
            response_parts.append(f"\nTables Found: {len(result['tables'])}")
            for i, table in enumerate(result['tables'][:3]):  # Limit to first 3 tables
                response_parts.append(f"Table {i+1}: {table['rows']} rows, {table['columns']} columns")
        
        return "\n".join(response_parts)
        
    except Exception as e:
        logger.error(f"Error in analyze_pdf_forms_tool: {str(e)}")
        return f"Error analyzing forms: {str(e)}"

def _analyze_financial_content(text: str, s3_key: str) -> str:
    """Analyze financial content in PDF"""
    try:
        import re
        
        # Extract financial metrics
        revenue_pattern = r'revenue[:\s]*\$?[\d,]+\.?\d*'
        profit_pattern = r'profit[:\s]*\$?[\d,]+\.?\d*'
        loss_pattern = r'loss[:\s]*\$?[\d,]+\.?\d*'
        
        revenues = re.findall(revenue_pattern, text, re.IGNORECASE)
        profits = re.findall(profit_pattern, text, re.IGNORECASE)
        losses = re.findall(loss_pattern, text, re.IGNORECASE)
        
        response_parts = [
            f"Financial Analysis for: {s3_key}",
            "Financial Metrics Found:",
            f"- Revenue mentions: {len(revenues)}",
            f"- Profit mentions: {len(profits)}",
            f"- Loss mentions: {len(losses)}"
        ]
        
        if revenues:
            response_parts.append(f"- Sample revenue: {revenues[0]}")
        if profits:
            response_parts.append(f"- Sample profit: {profits[0]}")
        if losses:
            response_parts.append(f"- Sample loss: {losses[0]}")
        
        return "\n".join(response_parts)
        
    except Exception as e:
        return f"Error in financial analysis: {str(e)}"

def _analyze_legal_content(text: str, s3_key: str) -> str:
    """Analyze legal content in PDF"""
    try:
        import re
        
        # Extract legal terms
        legal_terms = ['liability', 'warranty', 'indemnification', 'termination', 'breach', 'damages']
        found_terms = []
        
        for term in legal_terms:
            if re.search(term, text, re.IGNORECASE):
                found_terms.append(term)
        
        response_parts = [
            f"Legal Analysis for: {s3_key}",
            f"Legal terms found: {', '.join(found_terms)}",
            f"Document appears to be: {'Legal document' if found_terms else 'General document'}"
        ]
        
        return "\n".join(response_parts)
        
    except Exception as e:
        return f"Error in legal analysis: {str(e)}"

def _analyze_technical_content(text: str, s3_key: str) -> str:
    """Analyze technical content in PDF"""
    try:
        import re
        
        # Extract technical elements
        code_pattern = r'`[^`]+`|```[\s\S]*?```'
        function_pattern = r'def\s+\w+\(|function\s+\w+\('
        api_pattern = r'api[:\s]*[\w/]+'
        
        code_blocks = re.findall(code_pattern, text)
        functions = re.findall(function_pattern, text)
        apis = re.findall(api_pattern, text, re.IGNORECASE)
        
        response_parts = [
            f"Technical Analysis for: {s3_key}",
            f"Code blocks found: {len(code_blocks)}",
            f"Functions found: {len(functions)}",
            f"API references: {len(apis)}"
        ]
        
        return "\n".join(response_parts)
        
    except Exception as e:
        return f"Error in technical analysis: {str(e)}"

def _analyze_general_content(text: str, s3_key: str) -> str:
    """Analyze general content in PDF"""
    try:
        # Basic text analysis
        words = text.split()
        sentences = text.split('.')
        paragraphs = text.split('\n\n')
        
        response_parts = [
            f"General Analysis for: {s3_key}",
            f"Word count: {len(words)}",
            f"Sentence count: {len(sentences)}",
            f"Paragraph count: {len(paragraphs)}",
            f"Average words per sentence: {len(words) / max(len(sentences), 1):.1f}"
        ]
        
        return "\n".join(response_parts)
        
    except Exception as e:
        return f"Error in general analysis: {str(e)}"
