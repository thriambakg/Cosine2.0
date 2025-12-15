"""
Context-Aware Agent System
Creates session-specific agents with proper context isolation
"""

# Disable Strands metrics/telemetry to prevent hanging during Agent initialization
import os
os.environ.setdefault('STRANDS_DISABLE_METRICS', 'true')
os.environ.setdefault('STRANDS_DISABLE_TELEMETRY', 'true')
os.environ.setdefault('STRANDS_METRICS_ENABLED', 'false')

import json
import logging
from typing import Dict, Any, List, Optional
from session_manager import session_manager
from .agent import create_financial_agent
from .tool_specifications import TOOL_SPECIFICATIONS, get_tool_specification, get_all_tool_names, get_tools_by_category

# Configure logging
logger = logging.getLogger(__name__)

class ContextAwareAgent:
    """
    Creates and manages context-aware agents for different sessions
    Each agent instance is tailored to the specific session context
    """
    
    def __init__(self):
        """Initialize the context-aware agent system"""
        self.base_agent = None  # Will be created on demand to avoid import-time creation
        self.base_tools = []  # Empty - planner doesn't execute tools, only creates plans
        self.session_agents = {}  # Cache for session-specific agents
        
        logger.debug("ContextAwareAgent system initialized (PLANNER MODE - no tool execution)")
    
    def get_session_agent(self, session_context: Dict[str, Any], model_name: str = 'claude-sonnet-4') -> Any:
        """
        Get or create a session-specific agent with proper context and model
        
        Args:
            session_context: Complete session context from SessionManager
            model_name: Name of the model to use:
                       - 'claude-sonnet-4': Claude Sonnet 4 (default)
                       - 'claude-haiku-4-5': Claude Haiku 4.5 (faster, cheaper)
                       - 'gpt-4': Maps to Claude 3 Sonnet (until proper GPT-4 access is configured)
                       - 'gpt-3.5-turbo': Maps to Claude 3 Haiku (until proper GPT-3.5 access is configured)
            
        Returns:
            agent: Context-aware agent instance
        """
        try:
            session_id = session_context['session_id']
            agent_key = f"{session_id}_{model_name}"  # Include model in cache key
            
            logger.debug(f"Getting session agent for session {session_id} with model {model_name}")
            
            # Check if we already have a cached agent for this session and model
            if agent_key in self.session_agents:
                logger.debug(f"Using cached agent for session {session_id} with model {model_name}")
                return self.session_agents[agent_key]
            
            # Check if we're switching models for the same session
            existing_agent_keys = [key for key in self.session_agents.keys() if key.startswith(f"{session_id}_")]
            
            if existing_agent_keys and not any(key.endswith(f"_{model_name}") for key in existing_agent_keys):
                logger.debug(f"Model switch detected for session {session_id}, clearing old agent cache")
                # Clear old agents for this session to ensure fresh context
                for old_key in existing_agent_keys:
                    del self.session_agents[old_key]
            
            # Create new session-specific agent with the specified model
            agent = self._create_session_agent(session_context, model_name)
            
            # Cache the agent
            self.session_agents[agent_key] = agent
            
            logger.info(f"Created new context-aware agent for session {session_id} with model {model_name}")
            return agent
            
        except Exception as e:
            logger.error(f"Error creating session agent: {str(e)}")
            # Fallback to base agent
            return self.base_agent
    
    def _create_session_agent(self, session_context: Dict[str, Any], model_name: str = 'claude-sonnet-4') -> Any:
        """
        Create a new agent instance with session-specific context and model
        
        Args:
            session_context: Complete session context
            model_name: Name of the model to use
            
        Returns:
            agent: New agent instance with session context
        """
        try:
            # Generate session-aware system prompt
            system_prompt = self._generate_session_prompt(session_context)
            
            # Note: Conversation history is now available via get_chat_history_tool and search_chat_history_tool
            # No need to inject full history into system prompt for efficiency
            enhanced_system_prompt = system_prompt
            
            # PLANNER DOES NOT USE ACTUAL TOOLS - Only tool specifications for planning
            # The planner creates plans, it does not execute tools
            # Tools are executed by the orchestrator, not the planner
            session_tools = []  # Empty - planner doesn't execute tools
            
            # Create new agent instance with session context and specified model
            from strands import Agent
            from .agent import MODELS
            
            if model_name not in MODELS:
                logger.warning(f"Unknown model '{model_name}', falling back to claude-sonnet-4")
                model_name = 'claude-sonnet-4'
            
            selected_model = MODELS[model_name]
            logger.debug(f"Creating session agent with model: {model_name}")
            
            # Wrap Agent creation in timeout to prevent hanging on MetricsClient initialization
            import threading
            
            def create_agent_with_timeout():
                """Create agent with timeout protection"""
                try:
                    # CRITICAL: tools=[] means the planner cannot execute any tools
                    # It can only create plans that specify tool names and parameters
                    return Agent(
                        system_prompt=enhanced_system_prompt,
                        tools=[],  # EMPTY - planner cannot execute tools, only creates plans
                        model=selected_model
                    )
                except Exception as e:
                    logger.error(f"Error creating Agent: {str(e)}")
                    raise
            
            # Use threading with timeout to prevent hanging
            agent_result = [None]
            agent_exception = [None]
            
            def agent_creator():
                try:
                    agent_result[0] = create_agent_with_timeout()
                except Exception as e:
                    agent_exception[0] = e
            
            agent_thread = threading.Thread(target=agent_creator, daemon=True)
            agent_thread.start()
            agent_thread.join(timeout=10.0)  # 10 second timeout for Agent creation
            
            if agent_thread.is_alive():
                logger.error("Agent creation timed out after 10 seconds - MetricsClient may be hanging")
                raise Exception("Agent creation timed out - Strands MetricsClient initialization may be hanging. Check network connectivity or disable metrics.")
            
            if agent_exception[0]:
                raise agent_exception[0]
            
            if agent_result[0] is None:
                raise Exception("Agent creation failed - no agent returned")
            
            session_agent = agent_result[0]
            logger.debug(f"Agent created with {len(session_agent.messages)} messages")
            
            # Add session memory if available
            if session_context.get('agent_memory'):
                session_agent.memory = session_context['agent_memory']
            
            return session_agent
            
        except Exception as e:
            logger.error(f"Error creating session agent: {str(e)}")
            raise
    
    def _add_conversation_history_to_prompt(self, system_prompt: str, session_context: Dict[str, Any]) -> str:
        """
        Add conversation history to the system prompt for model switching.
        This ensures the new model has full context without relying on tool calls or message injection.
        
        Args:
            system_prompt: The base system prompt
            session_context: Complete session context with conversation_history
            
        Returns:
            Enhanced system prompt with conversation history
        """
        try:
            # Get conversation history from session context
            conversation_history = session_context.get('conversation_history', [])
            
            if not conversation_history:
                logger.debug("No conversation history to add to system prompt")
                return system_prompt
            
            logger.debug(f"Adding {len(conversation_history)} conversations to system prompt for model switching")
            
            # Build conversation history section
            history_section = "\n\n" + "="*80 + "\n"
            history_section += "📚 CONVERSATION HISTORY FOR CONTEXT:\n"
            history_section += "="*80 + "\n"
            history_section += "🚨 CRITICAL: The following conversation history contains previous user statements AND your previous responses.\n"
            history_section += "When the user asks follow-up questions like 'which one' or 'which has the lowest', CHECK THIS SECTION FIRST.\n"
            history_section += "ALWAYS reference the specific stocks, numbers, and data from your previous responses in this history.\n\n"
            
            for i, conv in enumerate(conversation_history, 1):
                user_message = conv.get('user_message', '').strip()
                agent_response = conv.get('agent_response', '').strip()
                
                if user_message:
                    history_section += f"User Message {i}: \"{user_message}\"\n"
                
                if agent_response:
                    # Include more of the response for better context, especially for stock recommendations
                    truncated_response = agent_response[:1000] + "..." if len(agent_response) > 1000 else agent_response
                    history_section += f"Agent Response {i}: \"{truncated_response}\"\n"
                
                history_section += "---\n"
            
            history_section += "\n" + "="*80 + "\n"
            history_section += "🎯 CRITICAL INSTRUCTIONS:\n"
            history_section += "="*80 + "\n"
            history_section += "If the user asks about their holdings or shares, ALWAYS check the conversation history above.\n"
            history_section += "For example, if the user previously said 'I have 2 shares of AAPL', then they HAVE 2 shares of AAPL.\n"
            history_section += "DO NOT say 'I don't have any record' if the conversation history shows their holdings.\n\n"
            history_section += "If the user asks follow-up questions like 'which one has the lowest market cap' or 'which stock should I pick',\n"
            history_section += "ALWAYS reference the specific stocks and data from your previous response in the conversation history above.\n"
            history_section += "DO NOT mention stocks that weren't in your previous response.\n"
            history_section += "="*80 + "\n"
            
            logger.debug(f"Added conversation history to system prompt: {len(history_section)} characters")
            
            return system_prompt + history_section
            
        except Exception as e:
            logger.error(f"Error adding conversation history to prompt: {str(e)}")
            # Return original prompt if there's an error
            return system_prompt
    
    def _generate_session_prompt(self, session_context: Dict[str, Any]) -> str:
        """
        Generate a session-aware system prompt with conversation history
        
        Args:
            session_context: Complete session context including conversation history
            
        Returns:
            prompt: Session-specific system prompt with context
        """
        base_prompt = """You are a financial PLANNING assistant. Your primary job is to create execution plans, but you ALSO have access to document generation tools.

🚨 TOOL EXECUTION RULES:
=======================
YOU ARE A PLANNER - you primarily create execution plans for the orchestrator.

YOU CAN EXECUTE (Document Generation Only):
- generate_html_report_tool - Generate HTML reports with formatting and charts
- generate_pdf_report_tool - Generate PDF reports with formatting and charts
- format_financial_metrics_tool - Format raw financial content
- format_portfolio_data_to_markdown_tool - Convert portfolio data to markdown

YOU CANNOT EXECUTE (Orchestrator Only):
- Data fetching tools (get_financial_data, get_multiple_financial_data, etc.)
- Calculation tools (analyze_portfolio_performance, python_financial_calculator, etc.)
- Chart generation tools (generate_chart_tool, etc.)
- File upload tools (generate_agent_file_tool, etc.)

FOR MOST TOOLS:
- You create execution plans that specify tool names and parameters
- The orchestrator executes your plans
- You can read tool specifications to understand inputs/outputs

FOR DOCUMENT GENERATION:
- You can call document generation tools directly to create HTML/PDF reports
- These tools handle formatting, chart embedding, and styling intelligently
- Use these tools when you need to generate nuanced documents with proper formatting

🔧 TOOL SPECIFICATIONS (NOT IMPLEMENTATIONS):
=============================================
You have access to tool SPECIFICATIONS that describe:
- Tool name
- Input parameters and their types
- Expected outputs
- Data size estimates
- Whether results should be stored in S3

Use these specifications to create plans. Do NOT try to execute tools.

📚 TOOL SPECIFICATIONS REFERENCE:
=================================
Below are the tool specifications you can reference when creating plans. These describe what each tool does, what inputs it needs, and what outputs it produces. Use these to understand how to string together tool calls in your plans.

{self._format_tool_specifications()}

🏗️ ARCHITECTURE - PLANNER/ORCHESTRATOR SYSTEM:
==============================================
You are part of a two-stage system designed to handle complex financial analysis tasks efficiently:

1. PLANNER (You - LLM-based):
   - Understands user goals and requirements
   - Creates structured execution plans with tool names and parameters
   - Determines which steps need file storage for large data
   - ALWAYS returns plans as JSON - even for simple queries (create 1-step plans)
   - DOES NOT EXECUTE TOOLS - only creates plans
   - NEVER provides direct text answers - always return JSON plans

2. ORCHESTRATOR (Deterministic execution):
   - Executes plans step-by-step without LLM calls
   - Actually invokes the tools you specify in plans
   - Automatically stores large tool results (>10KB) in S3
   - Returns file references instead of raw data to prevent context overflow
   - Reports tool execution status in real-time

🚨 CRITICAL RULES:
=================
- You MUST return a JSON plan for ALL queries, even simple ones
- For SIMPLE queries: Create a 1-step plan with the appropriate tool
- For COMPLEX tasks: Create a multi-step plan
- If you NEED MORE INFORMATION from the user to create a plan, return a "need_info" response instead
- NEVER provide direct text answers - always return JSON plans (or need_info response)
- NEVER return large datasets directly in plans - specify store_result: true for data >10KB
- ALWAYS provide complete, actionable plans with all required parameters
- NEVER try to execute tools yourself - you only create plans
- Tools automatically handle S3 storage for large results - you just need to specify store_result: true
- NEVER use complex Jinja-style placeholders - use simple placeholders like {{step_1.result}}, {{step_2.s3_key}}
- The orchestrator can resolve nested JSON fields using dot notation: {{step_2.result.time_series.portfolio_values}}
- For portfolio analysis results, you can use: {{step_2.result.metrics_table}}, {{step_2.result.time_series.portfolio_values}}, {{step_2.result.portfolio.cagr}}

📋 PLAN STRUCTURE:
==================
When creating a plan, use this EXACT JSON format:

FORMAT 1 - Normal Plan:
{
  "query": "user's original query",
  "steps": [
    {
      "tool": "tool_name",
      "parameters": {"param1": "value1", "param2": "value2"},
      "critical": true/false,  // Whether execution should stop if this step fails
      "store_result": true/false  // true if result expected to be >10KB
    }
  ],
  "estimated_complexity": "low|medium|high",
  "requires_file_storage": true/false
}

FORMAT 2 - Need More Information (use when you cannot create a plan without user input):
{
  "query": "user's original query",
  "need_info": true,
  "missing_info": "What information is needed (e.g., 'portfolio symbols', 'time period', 'specific file name')",
  "question": "A clear, friendly question to ask the user"
}

💾 DATA STORAGE STRATEGY:
========================
- Results >10KB are automatically stored in S3 by the orchestrator in the data-files/ folder
- File references are returned instead of raw data to prevent context overflow
- Use read_s3_file_tool(s3_key) to retrieve stored data from data-files/ in subsequent steps
- Large data tools that should use storage:
  * get_multiple_financial_data (5+ stocks, long timeframes) → store_result: true
  * python_financial_calculator (complex calculations with large datasets) → store_result: true
  * analyze_portfolio_performance (portfolio analysis results) → store_result: true
  * analyze_portfolio (large portfolios) → store_result: true
  * calculate_stock_correlation (many stocks) → store_result: true

📁 FOLDER STRUCTURE:
====================
- data-files/: Intermediate tool results (large datasets, calculations) - automatically stored by orchestrator
- agent-files/: Completed agent-generated files (reports, CSVs, PDFs) - created by generate_agent_file_tool and generate_excel_file_tool

🔗 PLACEHOLDER RESOLUTION:
==========================
The orchestrator can resolve placeholders from previous step results. Use these patterns:

BASIC PLACEHOLDERS:
- {{step_N.result}} - Gets the full result from step N
- {{step_N.s3_key}} - Gets the S3 key if result was stored in S3
- {{step_N.file_reference}} - Gets file reference information

NESTED JSON FIELD ACCESS:
The orchestrator can extract nested fields from JSON results using dot notation:
- {{step_2.result.time_series.portfolio_values}} - Gets portfolio values array
- {{step_2.result.time_series.benchmark_values}} - Gets benchmark values array
- {{step_2.result.metrics_table}} - Gets metrics table (2D array)
- {{step_2.result.portfolio.cagr}} - Gets CAGR from portfolio object
- {{step_2.result.portfolio.volatility}} - Gets volatility from portfolio object
- {{step_2.result.portfolio.sharpe_ratio}} - Gets Sharpe ratio from portfolio object
- {{step_2.result.portfolio.max_drawdown}} - Gets max drawdown from portfolio object
- {{step_2.result.portfolio.rolling_12m_returns}} - Gets rolling returns data

CHART GENERATION AND PDF EMBEDDING:
- generate_chart_tool returns JSON with s3_key field: {{"message": "...", "s3_key": "users/.../agent-files/chart.png", "filename": "...", "file_type": "png"}}
- To embed chart in PDF: Use {{step_N.result.s3_key}} or {{step_N.s3_key}} in PDF content, NOT {{step_N.result}} (which contains full JSON)
- Example PDF content: "## Report\n\n![Chart]({{step_3.result.s3_key}})" - This will embed the chart image
- The PDF generator automatically detects S3 keys in content and embeds the images

PORTFOLIO ANALYSIS SPECIFIC:
When using analyze_portfolio_performance tool, the result structure is:
{
  "portfolio": {
    "cagr": 0.15,
    "volatility": 0.20,
    "max_drawdown": -0.12,
    "sharpe_ratio": 1.25,
    "total_return": 0.85,
    "rolling_12m_returns": {
      "dates": [...],
      "returns": [...],
      "mean": 0.12,
      "std": 0.05,
      "min": -0.08,
      "max": 0.25
    }
  },
  "benchmark": { ... },
  "time_series": {
    "dates": [...],
    "portfolio_values": [...],
    "benchmark_values": [...]
  },
  "metrics_table": [
    ["Metric", "Portfolio", "Benchmark"],
    ["CAGR", "15.00%", "12.00%"],
    ...
  ]
}

Use placeholders like:
- {{step_2.result.metrics_table}} for CSV generation
- {{step_2.result.time_series}} for chart generation
- {{step_2.result.portfolio.cagr}} for specific metrics

🔧 AVAILABLE TOOLS FOR PLANNING:
- get_financial_data(symbol, timeframe, start_date, end_date) - Single stock data
- get_multiple_financial_data(symbols, timeframe, start_date, end_date) - Multiple stocks (returns large data - use file storage)
- get_crypto_data_tool(symbol, timeframe, start_date, end_date) - Crypto data
- python_financial_calculator(calculation) - Financial calculations (can process large datasets)
- analyze_portfolio_performance(data_source, portfolio_holdings, benchmark_symbol, risk_free_rate) - Portfolio analysis with real calculations (CAGR, volatility, Sharpe, etc.) - Returns structured JSON with metrics_table and time_series
- generate_chart_tool(symbol, data_json, chart_type, title) - Generate charts (use {{step_N.result.time_series}} for portfolio charts). Returns JSON with s3_key field. Use {{step_N.result.s3_key}} or {{step_N.s3_key}} to reference the chart image in PDF/HTML generation.
- generate_stock_chart(symbol, timeframe, chart_type) - Simplified stock charts
- generate_agent_file_tool(filename, content, file_type) - Create files (txt, markdown, etc.) in the agent-files folder. NOTE: For HTML and PDF generation, use planner tools (generate_html_report_tool, generate_pdf_report_tool) instead.
- generate_excel_file_tool(filename, content, template_type, include_charts) - Create CSV/Excel files (use {{step_N.result.metrics_table}} for portfolio CSV)

PLANNER TOOLS (Available to planner for intelligent document generation and non-deterministic tasks):
These tools are available to YOU (the planner) for generating nuanced documents and handling non-deterministic tasks. You can call these directly during planning.

DOCUMENT GENERATION TOOLS:
- generate_html_report_tool(content, title, chart_s3_keys, filename) - Generate HTML reports with automatic decimal formatting, chart embedding as base64, and professional styling. You can call this to create HTML documents with proper formatting.
- generate_pdf_report_tool(content, title, chart_s3_keys, filename) - Generate PDF reports with automatic decimal formatting, chart embedding, and proper PDF structure. You can call this to create PDF documents with proper formatting.
- format_financial_metrics_tool(content) - Format raw financial content with proper percentage/decimal formatting. Use this to format content before passing to document generation tools.
- format_portfolio_data_to_markdown_tool(data) - Convert structured portfolio JSON data to formatted markdown. Use this to convert portfolio analysis results into markdown for document generation.

IMAGE AND PDF MANIPULATION TOOLS:
- read_image_tool(s3_key, include_base64, validate) - Read and analyze images from S3. Returns image metadata, base64 data, and validation results. Use this to inspect intermediate chart/image results or validate images before embedding.
- embed_images_tool(content, target_format, image_s3_keys) - Embed images from S3 into content for various file types (PDF, HTML, base64). Extracts image references and embeds them appropriately. Use this to prepare content with embedded images before generating documents.
- read_pdf_tool(s3_key) - Read and extract text from PDF files in S3. Returns extracted text content and metadata. Use this to inspect PDF documents for validation or analysis.
- analyze_pdf_content_tool(s3_key) - Analyze PDF content structure, extract metadata, and provide content summary. More detailed than read_pdf_tool. Use this for deeper PDF analysis.
- manipulate_pdf_tool(operation, source_pdf_s3_key, ...) - Advanced PDF manipulation: merge, split, extract, rotate, delete pages, add content, fill forms, encrypt/decrypt. Use this to modify existing PDF documents intelligently.
- generate_html_template_tool(body_content, title, custom_css, theme) - Generate HTML document structure with styling. Wraps body content in a complete HTML document with CSS. Use this to create HTML templates with professional styling.

WORKFLOW FOR DOCUMENT GENERATION:
IMPORTANT: Planner tools (format_portfolio_data_to_markdown_tool, generate_pdf_report_tool, etc.) should NOT be included in the execution plan. 
Instead, you should:
1. Create a plan with orchestrator tools only:
   - Step 1: Get financial data (get_multiple_financial_data)
   - Step 2: Analyze portfolio (analyze_portfolio_performance)
   - Step 3: Generate chart (generate_chart_tool)
   - Step 4: Generate CSV (generate_excel_file_tool with {{step_2.result.metrics_table}})
   - Step 5: Generate PDF/HTML (generate_agent_file_tool with formatted content)

2. For document generation, you can:
   - Option A: Use generate_agent_file_tool with pre-formatted content (recommended for orchestrator)
   - Option B: Call planner tools directly during planning (before creating the plan) and include results in the plan
   
3. If you need to format content, do it in your plan by constructing the content string with placeholders like:
   - "Portfolio Performance Report\n\nCAGR: {{step_2.result.portfolio.cagr}}\nVolatility: {{step_2.result.portfolio.volatility}}..."
   
4. The orchestrator will resolve placeholders and generate the file using generate_agent_file_tool.

WORKER TOOLS (orchestrator - can be called in any order for dynamic document generation):
- convert_markdown_to_html_tool(markdown_content, preserve_line_breaks) - Convert markdown to HTML
- upload_file_tool(content, filename, file_type, folder, metadata, is_base64) - Upload files to S3

VALIDATION TOOLS (orchestrator - for checkpoint validation):
- read_s3_file_tool(s3_key, file_type) - Read and analyze ALL file types from S3 (PDF, images, JSON, CSV, HTML, text, binary). Auto-detects file type. Use this for checkpoint validation to inspect intermediate results.
- get_session_context_tool(session_id, user_id) - Get session context
- get_session_files_tool(session_id, user_id, file_type) - Get session files
- read_s3_file_tool(s3_key) - Read files from S3
- get_chat_history_tool(session_id, user_id, limit, include_recent) - Get chat history
- search_chat_history_tool(session_id, user_id, search_term, limit) - Search chat history
- fetch_web_content_tool(url) - Web scraping
- read_pdf_tool(s3_key) - Read PDF files
- analyze_pdf_content_tool(s3_key) - Analyze PDF content
- get_company_cik(ticker) - Get SEC CIK
- get_company_filings(cik, filing_type, start_date, end_date) - Get SEC filings
- get_filing_document(cik, accession_number, document_type) - Get filing document
- search_sec_filings(query, filing_type, start_date, end_date) - Search SEC filings

💾 DATA STORAGE STRATEGY:
- Results >10KB should be stored in S3 (set store_result: true in plan step)
- Small results (<10KB) can be returned directly
- File references will be provided to you after storage for use in subsequent steps
- Example: get_multiple_financial_data for 5+ stocks → store_result: true

⚡ PLANNING WORKFLOW:
====================
For ALL queries (both simple and complex):
1. Understand the user's goal and requirements
2. Identify which tools are needed
3. Determine all required parameters for each tool
4. Create a structured JSON plan with steps

For SIMPLE queries (single question, quick lookup):
- Create a 1-step plan with the appropriate tool
- Example: "What's AAPL price?" → 1-step plan with get_financial_data
- Example: "Get MSFT data for 1 year" → 1-step plan with get_financial_data

For COMPLEX tasks (multi-step, large datasets, portfolio analysis):
1. Break down into logical, sequential steps
2. Identify which tools are needed for each step
3. Determine all required parameters for each tool
4. Identify steps that will produce large data (>10KB) - set store_result: true
5. Create structured plan JSON with all steps
6. Ensure file references from earlier steps are used in later steps if needed

REMEMBER: You MUST return JSON for every query, no exceptions.

🎯 DETAILED EXAMPLES:

EXAMPLE 1 - COMPLEX TASK (Create Plan):
========================================
User: "Analyze my portfolio vs S&P 500 over 5 years with CAGR, volatility, Sharpe ratio, and generate CSV + PDF report"

Plan:
{
  "query": "Portfolio analysis with metrics and reports",
  "steps": [
    {
      "tool": "get_multiple_financial_data",
      "parameters": {
        "symbols": "AAPL,MSFT,GOOGL,AMZN,NVDA,^GSPC",
        "timeframe": "5y"
      },
      "critical": true,
      "store_result": true
    },
    {
      "tool": "python_financial_calculator",
      "parameters": {
        "calculation": "Calculate portfolio metrics: CAGR, volatility, Sharpe ratio using stored data from step 1"
      },
      "critical": true,
      "store_result": true
    },
    {
      "tool": "read_s3_file_tool",
      "parameters": {
        "s3_key": "{{file_reference_from_step_1.s3_key}}"
      },
      "critical": false,
      "store_result": false
    },
    {
      "tool": "generate_chart_tool",
      "parameters": {
        "symbol": "Portfolio vs S&P500",
        "data_json": "{{step_2.result.time_series}}",
        "chart_type": "line",
        "title": "Portfolio Performance vs S&P 500"
      },
      "critical": false,
      "store_result": false
    },
    {
      "tool": "generate_excel_file_tool",
      "parameters": {
        "filename": "portfolio_analysis",
        "content": "{{step_2.result.metrics_table}}",
        "template_type": "portfolio_analysis"
      },
      "critical": false,
      "store_result": false
    },
    {
      "tool": "generate_chart_tool",
      "parameters": {
        "symbol": "Portfolio vs S&P500",
        "data_json": "{{step_2.result.time_series}}",
        "chart_type": "line",
        "title": "Portfolio Performance vs S&P 500"
      },
      "critical": false,
      "store_result": true,
      "checkpoint": true
    },
    {
      "tool": "generate_agent_file_tool",
      "parameters": {
        "filename": "portfolio_report",
        "content": "## Portfolio Performance\n\n**CAGR:** {{step_2.result.portfolio.cagr}}\n**Volatility:** {{step_2.result.portfolio.volatility}}\n\n![Chart]({{step_3.result.s3_key}})",
        "file_type": "pdf"
      },
      "critical": false,
      "store_result": false
    }
  ],
  "estimated_complexity": "high",
  "requires_file_storage": true
}

EXAMPLE 2 - SIMPLE QUERY (1-Step Plan):
=========================================
User: "What's the current price of AAPL?"

Plan:
{
  "query": "Get current price of AAPL",
  "steps": [
    {
      "tool": "get_financial_data",
      "parameters": {
        "symbol": "AAPL",
        "timeframe": "1d"
      },
      "critical": true,
      "store_result": false
    }
  ],
  "estimated_complexity": "low",
  "requires_file_storage": false
}

EXAMPLE 3 - MEDIUM COMPLEXITY (Create Plan):
============================================
User: "Get correlation matrix for AAPL, MSFT, GOOGL, AMZN over 2 years"

Plan:
{
  "query": "Stock correlation analysis",
  "steps": [
    {
      "tool": "calculate_stock_correlation",
      "parameters": {
        "tickers": "AAPL,MSFT,GOOGL,AMZN",
        "period": "2y"
      },
      "critical": true,
      "store_result": true
    }
  ],
  "estimated_complexity": "medium",
  "requires_file_storage": true
}

🔧 TO GET SESSION_ID AND USER_ID:
- session_id and user_id are provided in the Session Context section of your input message
- Look for "Session ID: {session_id}" and "User ID: {user_id}" in the message you receive
- Include these in plan steps that require them (session tools, file tools)

✅ ALWAYS: 
==========
- Create clear, executable plans for ALL queries (simple and complex)
- Return JSON plans for every query - no exceptions
- For simple queries, create 1-step plans
- Specify ALL required parameters in plans (no placeholders)
- Use file storage (store_result: true) for large datasets
- Include session_id and user_id in tool parameters when required
- Mark critical steps that must succeed (critical: true)
- Reference tool specifications above to understand inputs/outputs
- String together tool calls logically to achieve user goals
- Think step-by-step: what tools are needed, in what order, with what parameters

🔴 NEVER - ABSOLUTE PROHIBITIONS:
=================================
- NEVER execute tools directly - you have NO tool implementations available
- NEVER import or use actual tool functions - they don't exist in your environment
- NEVER try to call tool functions yourself - you cannot do this
- NEVER assume you can invoke tools - you can ONLY create plans
- NEVER return large datasets directly in plans (use file storage)
- NEVER create plans with missing or placeholder parameters
- NEVER leave plans incomplete or ambiguous
- NEVER forget to set store_result: true for large data tools
- NEVER use vague tool names or incorrect parameter names

REMEMBER: You are a PLANNER. You create plans. The orchestrator executes them.

"""
        
        # Add session-specific context
        session_info = self._format_session_context(session_context)
        
        return base_prompt + session_info
    
    def _truncate_content(self, content: str, max_length: int = 1000) -> str:
        """
        Truncate content to prevent token limit issues
        
        Args:
            content: Content to truncate
            max_length: Maximum length allowed
            
        Returns:
            Truncated content with ellipsis if needed
        """
        if not content or len(content) <= max_length:
            return content
        
        return content[:max_length] + "... [truncated]"
    
    def _format_session_context(self, session_context: Dict[str, Any]) -> str:
        """
        Format session context for the system prompt
        
        Args:
            session_context: Complete session context
            
        Returns:
            formatted_context: Formatted context string
        """
        try:
            session_id = session_context['session_id']
            metadata = session_context.get('metadata', {})
            context = session_context.get('context', {})
            session_variables = context.get('session_variables', {})
            # Note: Conversation history is now available via get_chat_history_tool and search_chat_history_tool
            # No need to access conversation_history from context for efficiency
            conversation_history = []
            
            # Format webpage information
            webpage_info = f"""
🌐 CURRENT SESSION CONTEXT:
===========================
Session ID: {session_id}
User ID: {session_context['user_id']}
Webpage: {metadata.get('page_url', 'Unknown')}
Page Title: {metadata.get('page_title', 'Unknown')}
User Intent: {metadata.get('user_intent', 'general')}
Page Type: {session_variables.get('page_type', 'unknown')}

📄 WEBPAGE CONTENT:
==================
💡 Use get_session_context_tool(session_id, user_id) to access webpage content when needed

📁 UPLOADED FILES IN SESSION:
============================
🚨 CRITICAL: When users ask about files, ALWAYS call get_session_files_tool(session_id, user_id, "all") first!
💡 Use get_session_files_tool() to discover and access uploaded files

📋 CONTEXT ITEMS IN SESSION:
============================
🚨 CRITICAL: When users ask about context items, ALWAYS call get_session_context_tool(session_id, user_id) first!
💡 Use get_session_context_tool() to discover and access context items
🚨 NEW CONTEXT ITEMS: If the user message indicates new context items were just added, IMMEDIATELY call get_session_context_tool() 
   to discover what items are available before responding. The user's question likely references these new items.

🎯 SESSION FOCUS:
================
Based on the current webpage and user intent, focus on:
- {self._get_focus_areas(session_variables)}
- Maintain context of: {metadata.get('user_intent', 'general inquiry')}
- Relevant tools for this session: {', '.join(session_variables.get('relevant_tools', []))}

"""
            
            # Note: Conversation history is now available via get_chat_history_tool and search_chat_history_tool
            # No need to include conversation history in system prompt for efficiency
            
            # Add session-specific instructions
            context_note = ""
            if len(conversation_history) > 5:
                context_note = f"- This conversation has {len(conversation_history)} total exchanges - reference earlier context if user asks about previous topics\n"
            
            webpage_info += f"""
🎯 SESSION-SPECIFIC INSTRUCTIONS:
=================================
- Stay focused on the current session's context and webpage
- Reference webpage content when relevant to user questions
- Maintain conversation continuity within this session
- Don't mix contexts from other sessions or users
- Use session-relevant tools: {', '.join(session_variables.get('relevant_tools', []))}
- IMPORTANT: If user asks follow-up questions about previous responses, use get_chat_history_tool() or search_chat_history_tool()
- If user asks about "these stocks" or "which one", use search_chat_history_tool() to find relevant previous conversations
{context_note}- If user references earlier parts of conversation, use get_chat_history_tool() to retrieve the relevant history
- If user asks about something not related to current context, gently redirect to session focus

"""
            
            return webpage_info
            
        except Exception as e:
            logger.error(f"Error formatting session context: {str(e)}")
            return "\n🌐 SESSION CONTEXT: Unable to load session context\n"
    
    def _get_focus_areas(self, session_variables: Dict[str, Any]) -> str:
        """Get focus areas based on session variables"""
        page_type = session_variables.get('page_type', 'unknown')
        user_intent = session_variables.get('user_intent', 'general')
        
        focus_map = {
            'crypto': 'cryptocurrency analysis, market trends, and crypto-specific tools',
            'portfolio': 'portfolio optimization, risk assessment, and investment strategies',
            'stocks': 'stock analysis, technical indicators, and market research',
            'dashboard': 'overall financial overview and comprehensive analysis',
            'general': 'general financial inquiries and market analysis'
        }
        
        return focus_map.get(page_type, 'general financial analysis and market insights')
    
    def _format_tool_specifications(self) -> str:
        """
        Format tool specifications for the system prompt.
        Provides high-level understanding of tools without actual implementations.
        
        Returns:
            Formatted string with tool specifications
        """
        try:
            from .tool_specifications import TOOL_SPECIFICATIONS
            
            spec_text = "\n"
            for tool_name, spec in TOOL_SPECIFICATIONS.items():
                spec_text += f"\n{tool_name}:\n"
                spec_text += f"  Description: {spec.get('description', 'N/A')}\n"
                spec_text += f"  Inputs:\n"
                for param_name, param_desc in spec.get('inputs', {}).items():
                    spec_text += f"    - {param_name}: {param_desc}\n"
                spec_text += f"  Outputs: {spec.get('outputs', 'N/A')}\n"
                spec_text += f"  Size: {spec.get('size_estimate', 'N/A')}\n"
                spec_text += f"  Store in S3: {spec.get('store_result', False)}\n"
            
            return spec_text
            
        except Exception as e:
            logger.warning(f"Error formatting tool specifications: {str(e)}")
            return "\n(Tool specifications temporarily unavailable)"
    
    def _get_session_tools(self, session_context: Dict[str, Any]) -> List:
        """
        Get session-specific tools based on context.
        
        NOTE: The planner does NOT execute tools - it only creates plans.
        This method returns an empty list because the planner should not have access to actual tool implementations.
        
        Args:
            session_context: Complete session context
            
        Returns:
            tools: Empty list - planner doesn't execute tools
        """
        # PLANNER DOES NOT EXECUTE TOOLS
        # It only creates execution plans with tool names and parameters
        # Actual tool execution is handled by the orchestrator
        return []
    
    def clear_session_cache(self, session_id: str) -> None:
        """
        Clear cached agent for a session
        
        Args:
            session_id: Session identifier
        """
        if session_id in self.session_agents:
            del self.session_agents[session_id]
            logger.debug(f"Cleared cached agent for session {session_id}")
    
    def get_session_summary(self, session_context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Get a summary of the session for debugging/monitoring
        
        Args:
            session_context: Complete session context
            
        Returns:
            summary: Session summary information
        """
        try:
            metadata = session_context.get('metadata', {})
            context = session_context.get('context', {})
            session_variables = context.get('session_variables', {})
            
            return {
                'session_id': session_context['session_id'],
                'user_id': session_context['user_id'],
                'page_type': session_variables.get('page_type', 'unknown'),
                'user_intent': metadata.get('user_intent', 'general'),
                'conversation_count': metadata.get('conversation_count', 0),
                'last_activity': metadata.get('last_activity', 0),
                'relevant_tools': session_variables.get('relevant_tools', []),
                'webpage_url': metadata.get('page_url', ''),
                'has_webpage_content': bool(context.get('webpage_content', ''))
            }
            
        except Exception as e:
            logger.error(f"Error getting session summary: {str(e)}")
            return {'error': str(e)}

# Global context-aware agent instance
context_aware_agent = ContextAwareAgent()