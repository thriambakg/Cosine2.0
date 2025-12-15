# Tool Refactoring Plan - Single Responsibility Principle

## Analysis Summary

### Current Issues
Many tools combine multiple responsibilities:
1. **html_generator.py**: Combines markdown conversion, HTML template generation, image embedding, and file upload
2. **agent.py (generate_pdf_content)**: Combines PDF generation, image embedding, markdown parsing, and content formatting
3. **chart_generator.py**: Combines chart generation AND file upload
4. **portfolio_analysis_tool.py**: ✅ Good - single responsibility (portfolio calculations)
5. **financial_calculator.py**: ✅ Good - single responsibility (financial calculations)

### New Worker Tools Created

#### ✅ 1. image_embedder.py
**Purpose**: Embed images from S3 into various file types
**Responsibilities**:
- Extract image references from content
- Download images from S3
- Convert to appropriate format (base64, PDF Image, HTML img tag)
- Return embedded content

**Input**: content, target_format (pdf/html/base64), optional image_s3_keys
**Output**: Embedded content with metadata

#### ✅ 2. markdown_converter.py
**Purpose**: Convert markdown text to HTML
**Responsibilities**:
- Parse markdown syntax (headings, lists, code blocks, etc.)
- Convert to HTML elements
- Preserve formatting

**Input**: markdown_content, preserve_line_breaks
**Output**: HTML string

#### ✅ 3. html_template_generator.py
**Purpose**: Create HTML document structure with styling
**Responsibilities**:
- Generate HTML document wrapper
- Apply CSS themes (default, minimal, dark)
- Support custom CSS

**Input**: body_content, title, custom_css, theme
**Output**: Complete HTML document

### Worker Tools To Create

#### 4. pdf_generator.py (TODO)
**Purpose**: Generate PDF from content
**Responsibilities**:
- Convert text/markdown to PDF elements
- Apply PDF styling
- Build PDF document structure
- Return PDF bytes

**Input**: content, filename, page_size, margins
**Output**: PDF bytes

**Note**: Should use image_embedder for images, markdown_converter for markdown

#### 5. file_uploader.py (TODO)
**Purpose**: Upload files to S3
**Responsibilities**:
- Upload content to S3
- Set metadata
- Notify agent files processor
- Return file reference

**Input**: content, filename, user_id, session_id, file_type, content_type, metadata, folder
**Output**: Success message with S3 key

**Note**: Wrapper around upload_file_and_notify from lambda_invocation.py

### Refactoring Plan

#### html_generator.py → Use Worker Tools
**Current**: Does everything (markdown → HTML → template → embed images → upload)
**New Flow**:
1. convert_markdown_to_html_tool (if markdown)
2. embed_images_tool (target_format='html')
3. generate_html_template_tool
4. file_uploader_tool

#### agent.py generate_pdf_content → pdf_generator.py
**Current**: Embedded in agent.py, does PDF generation + image embedding
**New Flow**:
1. embed_images_tool (target_format='pdf') - get PDF Image objects
2. pdf_generator_tool - generate PDF with embedded images
3. file_uploader_tool - upload PDF

#### chart_generator.py
**Current**: Generates chart AND uploads to S3
**New Flow**:
1. chart_generator.py - ONLY generates chart (returns bytes or in-memory image)
2. file_uploader_tool - uploads chart image

### Tool Registration Order

The planner should be able to call tools in any order. Example flows:

**HTML Report with Chart**:
1. generate_chart_tool → returns chart S3 key
2. convert_markdown_to_html_tool → converts text to HTML
3. embed_images_tool → embeds chart into HTML
4. generate_html_template_tool → wraps in document
5. file_uploader_tool → uploads final HTML

**PDF Report with Chart**:
1. generate_chart_tool → returns chart S3 key
2. embed_images_tool (target_format='pdf') → gets PDF Image objects
3. pdf_generator_tool → creates PDF with images
4. file_uploader_tool → uploads PDF

### Benefits

1. **Modularity**: Each tool does one thing well
2. **Reusability**: Tools can be combined in any order
3. **Testability**: Easier to test individual components
4. **Flexibility**: Planner can orchestrate complex workflows
5. **Maintainability**: Changes to one tool don't affect others

