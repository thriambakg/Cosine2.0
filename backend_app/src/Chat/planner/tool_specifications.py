"""
Tool Specifications - High-level tool metadata for planning
The planner uses these specifications to understand available tools without importing actual implementations
"""

# Tool specifications: name, description, inputs, outputs, size_estimate
TOOL_SPECIFICATIONS = {
    'get_financial_data': {
        'name': 'get_financial_data',
        'description': 'Get financial data for a single stock symbol',
        'inputs': {
            'symbol': 'str - Stock ticker symbol (e.g., "AAPL")',
            'timeframe': 'str - Time period ("1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max")',
            'start_date': 'str (optional) - Start date in YYYY-MM-DD format',
            'end_date': 'str (optional) - End date in YYYY-MM-DD format'
        },
        'outputs': 'JSON string with stock data (price history, volume, etc.)',
        'size_estimate': 'small (<10KB) - Single stock data',
        'store_result': False
    },
    'get_multiple_financial_data': {
        'name': 'get_multiple_financial_data',
        'description': 'Get financial data for multiple stocks efficiently',
        'inputs': {
            'symbols': 'str - Comma-separated list of stock symbols (e.g., "AAPL,MSFT,GOOGL")',
            'timeframe': 'str - Time period (same as get_financial_data)',
            'start_date': 'str (optional) - Start date in YYYY-MM-DD format',
            'end_date': 'str (optional) - End date in YYYY-MM-DD format'
        },
        'outputs': 'JSON string with consolidated data for all stocks',
        'size_estimate': 'large (>10KB) - Especially for 3+ stocks or long timeframes',
        'store_result': True  # Always store for multiple stocks
    },
    'get_crypto_data_tool': {
        'name': 'get_crypto_data_tool',
        'description': 'Get real-time cryptocurrency data',
        'inputs': {
            'symbol': 'str - Crypto symbol (e.g., "BTC-USD", "ETH-USD")',
            'timeframe': 'str - Time period',
            'start_date': 'str (optional) - Start date',
            'end_date': 'str (optional) - End date'
        },
        'outputs': 'JSON string with crypto price data',
        'size_estimate': 'small to medium (<10KB typically)',
        'store_result': False
    },
    'python_financial_calculator': {
        'name': 'python_financial_calculator',
        'description': 'Execute advanced financial calculations (Fama-French, correlations, Sharpe ratios, VaR, etc.)',
        'inputs': {
            'calculation': 'str - Description of calculation to perform (e.g., "Fama-French analysis for AAPL", "correlation between AAPL and MSFT")'
        },
        'outputs': 'String or JSON with calculation results',
        'size_estimate': 'variable - Can be large for complex calculations with large datasets',
        'store_result': True  # Often produces large results
    },
    'analyze_portfolio': {
        'name': 'analyze_portfolio',
        'description': 'Analyze a portfolio of stocks with risk metrics, returns, and correlations',
        'inputs': {
            'portfolio_data': 'str - JSON string with portfolio holdings [{"ticker": "AAPL", "shares": 100, "price": 150.0}, ...]',
            'period': 'str - Analysis period (default: "1y")'
        },
        'outputs': 'JSON string with portfolio metrics',
        'size_estimate': 'large (>10KB) for portfolios with 5+ holdings',
        'store_result': True
    },
    'analyze_portfolio_performance': {
        'name': 'analyze_portfolio_performance',
        'description': 'Analyze portfolio performance vs benchmark. Calculates CAGR, volatility, max drawdown, Sharpe ratio, and rolling 12-month returns. Requires financial data from previous step (S3 key or data reference).',
        'inputs': {
            'data_source': 'str - S3 key of stored financial data from previous step (e.g., from get_multiple_financial_data), or JSON string with financial data',
            'portfolio_holdings': 'str - Portfolio holdings in format: "2 shares AAPL, 3 shares VOO" or JSON array',
            'benchmark_symbol': 'str (optional) - Benchmark symbol (e.g., "^GSPC" for S&P 500, default: "^GSPC")',
            'risk_free_rate': 'float (optional) - Risk-free rate for Sharpe ratio (as decimal, e.g., 0.02 for 2%, default: 0.02)'
        },
        'outputs': 'JSON string with structured portfolio metrics including: portfolio (cagr, volatility, max_drawdown, sharpe_ratio, total_return, rolling_12m_returns), benchmark (same metrics), time_series (dates, portfolio_values, benchmark_values), metrics_table (2D array for CSV)',
        'size_estimate': 'medium to large (>10KB) - Contains time series data and metrics',
        'store_result': True,
        'output_structure': {
            'portfolio': {
                'cagr': 'float - Compound Annual Growth Rate',
                'volatility': 'float - Annualized volatility',
                'max_drawdown': 'float - Maximum drawdown',
                'sharpe_ratio': 'float - Sharpe ratio',
                'total_return': 'float - Total return over period',
                'rolling_12m_returns': {
                    'dates': 'list[str] - ISO date strings',
                    'returns': 'list[float] - Rolling 12-month returns',
                    'mean': 'float - Mean rolling return',
                    'std': 'float - Standard deviation',
                    'min': 'float - Minimum',
                    'max': 'float - Maximum'
                }
            },
            'benchmark': 'Same structure as portfolio (if benchmark provided)',
            'time_series': {
                'dates': 'list[str] - ISO date strings',
                'portfolio_values': 'list[float] - Portfolio values over time',
                'benchmark_values': 'list[float] - Benchmark values over time (if benchmark provided)'
            },
            'metrics_table': 'list[list[str]] - 2D array for CSV generation: [["Metric", "Portfolio", "Benchmark"], ["CAGR", "15.00%", "12.00%"], ...]'
        },
        'placeholder_examples': {
            'metrics_table': '{{step_2.result.metrics_table}} - Use for CSV generation',
            'time_series': '{{step_2.result.time_series}} - Use for chart generation',
            'portfolio_cagr': '{{step_2.result.portfolio.cagr}} - Get specific metric',
            'rolling_returns': '{{step_2.result.portfolio.rolling_12m_returns}} - Get rolling returns data'
        }
    },
    'calculate_stock_correlation': {
        'name': 'calculate_stock_correlation',
        'description': 'Calculate correlation matrix between multiple stocks',
        'inputs': {
            'tickers': 'str - Comma-separated ticker symbols (e.g., "AAPL,MSFT,GOOGL")',
            'period': 'str - Time period for correlation (default: "1y")'
        },
        'outputs': 'JSON string with correlation matrix',
        'size_estimate': 'large (>10KB) for 5+ stocks',
        'store_result': True
    },
    'generate_chart_tool': {
        'name': 'generate_chart_tool',
        'description': 'Generate charts for visualization (requires pre-fetched data)',
        'inputs': {
            'symbol': 'str - Symbol or identifier for the chart',
            'data_json': 'dict or str - Data to visualize (can reference S3 file)',
            'chart_type': 'str - Type of chart ("line", "bar", "candlestick", etc.)',
            'title': 'str (optional) - Chart title'
        },
        'outputs': 'Chart image URL or file reference',
        'size_estimate': 'small - Chart images',
        'store_result': False
    },
    'generate_stock_chart': {
        'name': 'generate_stock_chart',
        'description': 'Convenience tool: fetch stock data and generate chart in one step',
        'inputs': {
            'symbol': 'str - Stock ticker symbol',
            'timeframe': 'str - Time period',
            'chart_type': 'str - Chart type (default: "line")'
        },
        'outputs': 'Chart image URL or file reference',
        'size_estimate': 'small - Chart images',
        'store_result': False
    },
    'generate_agent_file_tool': {
        'name': 'generate_agent_file_tool',
        'description': 'Create files (txt, markdown, etc.) in the agent-files folder. NOTE: For HTML and PDF generation, use planner tools (generate_html_report_tool, generate_pdf_report_tool) instead.',
        'inputs': {
            'filename': 'str - Name of file (without extension)',
            'content': 'str - File content',
            'file_type': 'str - File type ("txt", "markdown", etc.). NOTE: For PDF and HTML, use planner tools instead.'
        },
        'outputs': 'Success message with file URL',
        'size_estimate': 'small - File metadata',
        'store_result': False,
        'notes': 'NOTE: For PDF and HTML generation, use planner tools (generate_html_report_tool, generate_pdf_report_tool) instead. These are available to the planner for intelligent document generation.'
    },
    'generate_excel_file_tool': {
        'name': 'generate_excel_file_tool',
        'description': 'Create CSV/Excel files for financial analysis',
        'inputs': {
            'filename': 'str - Name of file (without extension)',
            'content': 'str - CSV content or data',
            'template_type': 'str - Template type ("financial_model", "dcf_model", "portfolio_analysis", "risk_report", "custom")',
            'include_charts': 'bool - Whether to include chart instructions'
        },
        'outputs': 'Success message with file URL',
        'size_estimate': 'small - File metadata',
        'store_result': False
    },
    # NOTE: generate_html_file_tool has been moved to planner/agent_tools/
    # Use generate_html_report_tool (available to planner) instead
    # NOTE: embed_images_tool has been moved to planner/agent_tools/
    # Use embed_images_tool (available to planner) instead
    'convert_markdown_to_html_tool': {
        'name': 'convert_markdown_to_html_tool',
        'description': 'Convert markdown text to HTML. Handles headings, lists, code blocks, paragraphs, and basic formatting. Single-purpose worker tool.',
        'inputs': {
            'markdown_content': 'str - Markdown text to convert to HTML',
            'preserve_line_breaks': 'bool - Whether to preserve line breaks as <br> tags (default: true)'
        },
        'outputs': 'HTML string',
        'size_estimate': 'small - HTML text',
        'store_result': False,
        'notes': 'Worker tool for markdown conversion. Use before HTML template generation.'
    },
    # NOTE: generate_html_template_tool has been moved to planner/agent_tools/
    # Use generate_html_template_tool (available to planner) instead
    # NOTE: generate_pdf_tool has been moved to planner/agent_tools/
    # Use generate_pdf_report_tool (available to planner) instead
    # NOTE: manipulate_pdf_tool has been moved to planner/agent_tools/
    # Use manipulate_pdf_tool (available to planner) instead
    'upload_file_tool': {
        'name': 'upload_file_tool',
        'description': 'Upload file content to S3. Handles both text and binary content, sets metadata, and notifies the agent files processor. Single-purpose worker tool.',
        'inputs': {
            'content': 'str - File content (string or base64-encoded bytes for binary files)',
            'filename': 'str - Name of the file (with extension)',
            'file_type': 'str - File type (txt, pdf, html, png, csv, etc.)',
            'content_type': 'str (optional) - MIME content type (auto-detected if not provided)',
            'folder': 'str - S3 folder: "agent-files" (final files) or "data-files" (intermediate data)',
            'metadata': 'dict (optional) - Additional metadata to attach to the file',
            'is_base64': 'bool - Whether content is base64-encoded (for binary files, default: false)'
        },
        'outputs': 'JSON with message, s3_key, filename, file_type, and folder',
        'size_estimate': 'small - File metadata',
        'store_result': False,
        'notes': 'Worker tool for file uploads. Use after generating any file content (PDF, HTML, images, etc.).'
    },
    # NOTE: read_image_tool has been moved to planner/agent_tools/
    # Use read_image_tool (available to planner) for image inspection and validation
    'get_session_context_tool': {
        'name': 'get_session_context_tool',
        'description': 'Get complete session context (files, context items, session variables)',
        'inputs': {
            'session_id': 'str - Session ID',
            'user_id': 'str - User ID'
        },
        'outputs': 'JSON with session context',
        'size_estimate': 'small to medium (<10KB typically)',
        'store_result': False
    },
    'get_session_files_tool': {
        'name': 'get_session_files_tool',
        'description': 'Get files from session',
        'inputs': {
            'session_id': 'str - Session ID',
            'user_id': 'str - User ID',
            'file_type': 'str - File type filter ("all", "pdf", "csv", etc.)'
        },
        'outputs': 'JSON with file list',
        'size_estimate': 'small - File metadata',
        'store_result': False
    },
        'read_s3_file_tool': {
            'name': 'read_s3_file_tool',
            'description': 'Read and analyze files from S3. Handles all common file types: PDF (extracts text), images (PNG/JPG/GIF/WebP - provides metadata), JSON (parses), CSV, HTML (extracts text), text files, and binary files (base64). Use during checkpoint validation to inspect intermediate results. Can read from both data-files/ (intermediate tool results) and agent-files/ (completed agent files).',
            'inputs': {
                's3_key': 'str - S3 key/path to file (from file_reference.s3_key). Paths may be in data-files/ or agent-files/ folders',
                'file_type': 'str (optional) - File type hint: "auto" (default, auto-detect), "pdf", "image", "json", "csv", "html", "text"'
            },
            'outputs': 'File contents with analysis (formatted based on file type)',
            'size_estimate': 'variable - Depends on file size',
            'store_result': False,
            'notes': 'Automatically detects file type from extension. For PDFs, extracts text and provides analysis. For images, provides dimensions and base64 data. For text files, returns content. For binary files, returns base64-encoded data.'
        },
    'get_chat_history_tool': {
        'name': 'get_chat_history_tool',
        'description': 'Get chat history for a session',
        'inputs': {
            'session_id': 'str - Session ID',
            'user_id': 'str - User ID',
            'limit': 'int (optional) - Number of conversations to retrieve',
            'include_recent': 'bool (optional) - Include recent messages'
        },
        'outputs': 'JSON with chat history',
        'size_estimate': 'small to medium (<10KB typically)',
        'store_result': False
    },
    'search_chat_history_tool': {
        'name': 'search_chat_history_tool',
        'description': 'Search chat history for specific terms',
        'inputs': {
            'session_id': 'str - Session ID',
            'user_id': 'str - User ID',
            'search_term': 'str - Term to search for',
            'limit': 'int (optional) - Number of results'
        },
        'outputs': 'JSON with matching conversations',
        'size_estimate': 'small - Search results',
        'store_result': False
    },
    'fetch_web_content_tool': {
        'name': 'fetch_web_content_tool',
        'description': 'Fetch and scrape web content from a URL',
        'inputs': {
            'url': 'str - URL to fetch'
        },
        'outputs': 'String with web content',
        'size_estimate': 'variable - Can be large for long pages',
        'store_result': True  # Can be large
    },
    'read_pdf_tool': {
        'name': 'read_pdf_tool',
        'description': 'Read PDF files from S3',
        'inputs': {
            's3_key': 'str - S3 key to PDF file'
        },
        'outputs': 'String with PDF text content',
        'size_estimate': 'variable - Can be large',
        'store_result': True  # PDFs can be large
    },
    'analyze_pdf_content_tool': {
        'name': 'analyze_pdf_content_tool',
        'description': 'Analyze PDF content for insights',
        'inputs': {
            's3_key': 'str - S3 key to PDF file'
        },
        'outputs': 'JSON with analysis results',
        'size_estimate': 'small to medium - Analysis summary',
        'store_result': False
    },
    'get_company_cik': {
        'name': 'get_company_cik',
        'description': 'Get SEC CIK number from ticker symbol',
        'inputs': {
            'ticker': 'str - Stock ticker symbol'
        },
        'outputs': 'JSON with CIK and company info',
        'size_estimate': 'small - Company metadata',
        'store_result': False
    },
    'get_company_filings': {
        'name': 'get_company_filings',
        'description': 'Get SEC filings for a company',
        'inputs': {
            'cik': 'str - Company CIK number',
            'filing_type': 'str (optional) - Filing type filter',
            'start_date': 'str (optional) - Start date',
            'end_date': 'str (optional) - End date'
        },
        'outputs': 'JSON with filing list',
        'size_estimate': 'small to medium - Filing metadata',
        'store_result': False
    },
    'get_filing_document': {
        'name': 'get_filing_document',
        'description': 'Get full text of SEC filing',
        'inputs': {
            'cik': 'str - Company CIK',
            'accession_number': 'str - Filing accession number',
            'document_type': 'str - Document type'
        },
        'outputs': 'String with filing text',
        'size_estimate': 'large (>10KB) - Full filing text',
        'store_result': True
    },
    'search_sec_filings': {
        'name': 'search_sec_filings',
        'description': 'Search SEC filings by criteria',
        'inputs': {
            'query': 'str - Search query',
            'filing_type': 'str (optional) - Filing type filter',
            'start_date': 'str (optional) - Start date',
            'end_date': 'str (optional) - End date'
        },
        'outputs': 'JSON with search results',
        'size_estimate': 'small to medium - Search results',
        'store_result': False
    }
}

def get_tool_specification(tool_name: str) -> dict:
    """Get specification for a tool by name"""
    return TOOL_SPECIFICATIONS.get(tool_name, {})

def get_all_tool_names() -> list:
    """Get list of all available tool names"""
    return list(TOOL_SPECIFICATIONS.keys())

def get_tools_by_category() -> dict:
    """Get tools organized by category"""
    return {
        'financial_data': ['get_financial_data', 'get_multiple_financial_data', 'get_crypto_data_tool'],
        'calculations': ['python_financial_calculator', 'analyze_portfolio', 'calculate_stock_correlation'],
        'visualization': ['generate_chart_tool', 'generate_stock_chart'],
        'file_generation': ['generate_agent_file_tool', 'generate_excel_file_tool'],
        # NOTE: generate_html_file_tool and generate_pdf_tool moved to planner/agent_tools/
        # NOTE: embed_images_tool, generate_html_template_tool, manipulate_pdf_tool moved to planner/agent_tools/
        'worker_tools': ['convert_markdown_to_html_tool', 'upload_file_tool'],
        # NOTE: read_image_tool, read_pdf_tool moved to planner/agent_tools/
        'validation_tools': ['read_s3_file_tool'],
        'session_context': ['get_session_context_tool', 'get_session_files_tool', 'get_chat_history_tool', 'search_chat_history_tool'],
        # NOTE: read_pdf_tool, analyze_pdf_content_tool moved to planner/agent_tools/
        'data_retrieval': ['read_s3_file_tool', 'fetch_web_content_tool'],
        'sec_filings': ['get_company_cik', 'get_company_filings', 'get_filing_document', 'search_sec_filings']
    }

