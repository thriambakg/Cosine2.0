import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Typography, Box } from '@mui/material';

interface MarkdownRendererProps {
  content: string;
  variant?: 'body1' | 'body2' | 'caption';
  sx?: any;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ 
  content, 
  variant = 'body1',
  sx = {}
}) => {
  return (
    <Box sx={{ 
      '& p': { margin: '0.5em 0' },
      '& ul, & ol': { margin: '0.5em 0', paddingLeft: '1.5em' },
      '& li': { margin: '0.25em 0' },
      '& h1, & h2, & h3, & h4, & h5, & h6': { margin: '0.75em 0 0.5em 0' },
      '& code': { 
        backgroundColor: 'rgba(0, 0, 0, 0.1)', 
        padding: '0.2em 0.4em', 
        borderRadius: '3px',
        fontFamily: 'monospace'
      },
      '& pre': { 
        backgroundColor: 'rgba(0, 0, 0, 0.1)', 
        padding: '1em', 
        borderRadius: '5px',
        overflow: 'auto',
        margin: '0.5em 0',
        '&::-webkit-scrollbar': {
          width: '6px',
          height: '6px'
        },
        '&::-webkit-scrollbar-track': {
          backgroundColor: 'rgba(55, 65, 81, 0.3)',
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(59, 130, 246, 0.5)',
          borderRadius: '3px',
        },
        '&::-webkit-scrollbar-thumb:hover': {
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
        },
      },
      '& pre code': { 
        backgroundColor: 'transparent', 
        padding: 0 
      },
      '& blockquote': { 
        borderLeft: '4px solid #ccc', 
        margin: '0.5em 0', 
        paddingLeft: '1em',
        fontStyle: 'italic'
      },
      '& .markdown-table-container': {
        overflowX: 'auto',
        margin: '1em 0',
        '&::-webkit-scrollbar': {
          width: '6px',
          height: '6px'
        },
        '&::-webkit-scrollbar-track': {
          backgroundColor: 'rgba(55, 65, 81, 0.3)',
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(59, 130, 246, 0.5)',
          borderRadius: '3px',
        },
        '&::-webkit-scrollbar-thumb:hover': {
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
        },
      },
      '& table': { 
        borderCollapse: 'collapse', 
        width: '100%', 
        fontSize: '0.875rem',
        fontFamily: 'inherit',
        minWidth: '300px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        borderRadius: '6px',
        overflow: 'hidden'
      },
      '& th, & td': { 
        border: '1px solid rgba(0, 0, 0, 0.1)', 
        padding: '0.75em 1em', 
        textAlign: 'left',
        verticalAlign: 'top'
      },
      '& th': { 
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fontWeight: '600',
        color: 'inherit',
        borderBottom: '2px solid rgba(59, 130, 246, 0.3)'
      },
      '& tbody tr:nth-of-type(even)': {
        backgroundColor: 'rgba(0, 0, 0, 0.02)'
      },
      '& tbody tr:hover': {
        backgroundColor: 'rgba(59, 130, 246, 0.05)'
      },
      '& .markdown-pre-code': {
        '&::-webkit-scrollbar': {
          width: '6px',
          height: '6px'
        },
        '&::-webkit-scrollbar-track': {
          backgroundColor: 'rgba(55, 65, 81, 0.3)',
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(59, 130, 246, 0.5)',
          borderRadius: '3px',
        },
        '&::-webkit-scrollbar-thumb:hover': {
          backgroundColor: 'rgba(59, 130, 246, 0.7)',
        },
      },
      ...sx
    }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <Typography variant={variant} component="p" sx={{ margin: '0.5em 0' }}>
              {children}
            </Typography>
          ),
          h1: ({ children }) => (
            <Typography variant="h4" component="h1" sx={{ margin: '0.75em 0 0.5em 0', fontWeight: 'bold' }}>
              {children}
            </Typography>
          ),
          h2: ({ children }) => (
            <Typography variant="h5" component="h2" sx={{ margin: '0.75em 0 0.5em 0', fontWeight: 'bold' }}>
              {children}
            </Typography>
          ),
          h3: ({ children }) => (
            <Typography variant="h6" component="h3" sx={{ margin: '0.75em 0 0.5em 0', fontWeight: 'bold' }}>
              {children}
            </Typography>
          ),
          code: ({ children, className }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.1)',
                  padding: '0.2em 0.4em',
                  borderRadius: '3px',
                  fontFamily: 'monospace',
                  fontSize: '0.9em'
                }}>
                  {children}
                </code>
              );
            }
            return (
              <pre style={{
                backgroundColor: 'rgba(0, 0, 0, 0.1)',
                padding: '1em',
                borderRadius: '5px',
                overflow: 'auto',
                margin: '0.5em 0'
              }} className="markdown-pre-code">
                <code style={{
                  backgroundColor: 'transparent',
                  padding: 0,
                  fontFamily: 'monospace'
                }}>
                  {children}
                </code>
              </pre>
            );
          },
          ul: ({ children }) => (
            <ul style={{ margin: '0.5em 0', paddingLeft: '1.5em' }}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '0.5em 0', paddingLeft: '1.5em' }}>
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: '0.25em 0' }}>
              {children}
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: '4px solid #ccc',
              margin: '0.5em 0',
              paddingLeft: '1em',
              fontStyle: 'italic'
            }}>
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="markdown-table-container">
              <table style={{
                borderCollapse: 'collapse',
                width: '100%',
                fontSize: '0.875rem',
                fontFamily: 'inherit',
                minWidth: '300px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                borderRadius: '6px',
                overflow: 'hidden'
              }}>
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th style={{
              border: '1px solid rgba(0, 0, 0, 0.1)',
              padding: '0.75em 1em',
              textAlign: 'left',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              fontWeight: '600',
              borderBottom: '2px solid rgba(59, 130, 246, 0.3)'
            }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td style={{
              border: '1px solid rgba(0, 0, 0, 0.1)',
              padding: '0.75em 1em',
              textAlign: 'left',
              verticalAlign: 'top'
            }}>
              {children}
            </td>
          ),
          strong: ({ children }) => (
            <strong style={{ fontWeight: 'bold' }}>
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em style={{ fontStyle: 'italic' }}>
              {children}
            </em>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </Box>
  );
};

export default MarkdownRenderer;
