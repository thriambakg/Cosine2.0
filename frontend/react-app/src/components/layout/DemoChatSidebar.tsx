import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  IconButton,
  TextField,
  List,
  ListItem,
  Tooltip,
} from '@mui/material';
import { Send as SendIcon, SmartToy as SmartToyIcon, Person as PersonIcon } from '@mui/icons-material';
import type { ContextItem } from '../tiles/common/contextManager';
import ContextItemRow from '../context/ContextItemRow';

const DEMO_SIDEBAR_WIDTH = 400;
const PRESET_RESPONSES = [
  "This is a demo. In the full app I'd use your context to answer questions and run analysis.",
  "You can add items from the dashboard tiles to this context—try the “Add to context” action on a search result.",
  "FinGov combines government data and financial research in one place. Sign up to use the real AI with your data.",
];

export const DEMO_CHAT_SIDEBAR_WIDTH = DEMO_SIDEBAR_WIDTH;

interface DemoMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: number;
}

/** Parse drag-drop data from tiles into ContextItem[] for demo sidebar */
function parseDropDataToContextItems(data: any): ContextItem[] {
  const ts = Date.now();
  const id = () => `ctx-${ts}-${Math.random().toString(36).slice(2, 9)}`;
  if (data.type === 'sec_filings' && data.filings && Array.isArray(data.filings)) {
    return data.filings.map((f: any) => ({
      id: id(),
      type: 'sec_filing' as const,
      title: `${f.form || 'SEC Filing'} - ${f.filingEntity || f.reportingFor || 'Unknown'}`,
      subtitle: f.filingDate ? `Filed: ${f.filingDate}` : undefined,
      data: f,
      timestamp: ts,
    }));
  }
  if (data.type === 'congress_bills' && data.bills && Array.isArray(data.bills)) {
    return data.bills.map((b: any) => ({
      id: id(),
      type: 'congress_bill' as const,
      title: `${b.bill_type || 'Bill'} ${b.bill_number || ''}`.trim() || b.bill_title || 'Congress Bill',
      subtitle: [b.sponsor_full_name, b.introduced_date].filter(Boolean).join(' • ') || undefined,
      data: b,
      timestamp: ts,
    }));
  }
  if (data.type === 'govt_contracts' && data.awards && Array.isArray(data.awards)) {
    return data.awards.map((a: any) => ({
      id: id(),
      type: 'govt_contract_award' as const,
      title: `${a.awarding_agency_name || 'Agency'} - ${a.recipient_name || 'Recipient'}`,
      subtitle: a.action_date ? `Date: ${a.action_date}` : undefined,
      data: a,
      timestamp: ts,
    }));
  }
  if (data.type === 'politician_trades' && data.trades && Array.isArray(data.trades)) {
    return data.trades.map((t: any) => ({
      id: id(),
      type: 'politician_trade' as const,
      title: `${t.politician_name || 'Politician'} - ${t.asset_name || t.transaction_type || 'Trade'}`,
      subtitle: t.transaction_type || t.transaction_date ? [t.transaction_type, t.transaction_date].filter(Boolean).join(' • ') : undefined,
      data: t,
      timestamp: ts,
    }));
  }
  if (data.type === 'stocks' && data.stocks && Array.isArray(data.stocks)) {
    return data.stocks.map((s: any) => ({
      id: id(),
      type: 'stock_data' as const,
      title: `${s.symbol || 'Stock'} - ${s.name || s.symbol || 'Unknown'}`,
      subtitle: s.timeframe || s.sector ? [s.timeframe, s.sector].filter(Boolean).join(' • ') : undefined,
      data: { symbol: s.symbol, name: s.name, timeframe: s.timeframe, ...s.stockData, ...s },
      timestamp: ts,
    }));
  }
  if (data.type === 'news_articles' && data.articles && Array.isArray(data.articles)) {
    return data.articles.map((a: any) => ({
      id: id(),
      type: 'article' as const,
      title: a.title || 'Article',
      subtitle: a.source_name || a.published_date ? [a.source_name, a.published_date].filter(Boolean).join(' • ') : undefined,
      data: a,
      timestamp: ts,
    }));
  }
  if (data.type === 'lda_filings' && data.filings && Array.isArray(data.filings)) {
    return data.filings.map((f: any) => ({
      id: id(),
      type: 'lda_filing' as const,
      title: f.registrant_name || f.client_name || 'LDA Filing',
      subtitle: f.filing_type || f.report_year ? [f.filing_type, f.report_year].filter(Boolean).join(' • ') : undefined,
      data: f,
      timestamp: ts,
    }));
  }
  if (data.type === 'filesystem_items' && data.items && Array.isArray(data.items)) {
    return data.items.map((item: any) => ({
      id: id(),
      type: 'filesystem' as const,
      title: item.metadata?.title || item.name || 'File',
      subtitle: item.metadata?.subtitle || item.type,
      data: {
        filesystem_type: item.type === 'folder' ? 'folder' : 'item',
        item_id: item.id,
        folder_path: data.folderPath || '',
        s3_key: item.s3_key,
        ...item.metadata?.data,
      },
      timestamp: ts,
    }));
  }
  return [];
}

export default function DemoChatSidebar() {
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);
  const [messages, setMessages] = useState<DemoMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isDragOverSidebar, setIsDragOverSidebar] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);
  const [inputAreaHeight, setInputAreaHeight] = useState(80);
  const responseIndexRef = useRef(0);
  const suppressScrollUntilRef = useRef(0);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('text/plain') || e.dataTransfer.types.includes('application/json')) {
      setIsDragOverSidebar(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as HTMLElement;
    if (!target.contains(related)) setIsDragOverSidebar(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      let raw: string | null = null;
      if (e.dataTransfer.types.includes('application/json')) raw = e.dataTransfer.getData('application/json');
      if (!raw && e.dataTransfer.types.includes('text/plain')) raw = e.dataTransfer.getData('text/plain');
      if (!raw) return;
      const data = JSON.parse(raw);
      const items = parseDropDataToContextItems(data);
      if (items.length) setContextItems((prev) => [...prev, ...items]);
    } catch (_) {
      // ignore parse errors
    } finally {
      setIsDragOverSidebar(false);
    }
  }, []);

  useEffect(() => {
    const handleDemoReset = () => {
      setContextItems([]);
      setMessages([]);
    };
    window.addEventListener('demo-reset-context', handleDemoReset);
    return () => window.removeEventListener('demo-reset-context', handleDemoReset);
  }, []);

  useEffect(() => {
    const handleSimSendMessage = (e: Event) => {
      suppressScrollUntilRef.current = Date.now() + 2500;
      const ev = e as CustomEvent<{ text: string; response?: string }>;
      const { text, response } = ev.detail || {};
      if (!text?.trim()) return;
      const userMsg: DemoMessage = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: text.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      const aiText = response ?? PRESET_RESPONSES[responseIndexRef.current % PRESET_RESPONSES.length];
      responseIndexRef.current += 1;
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          { id: `ai-${Date.now()}`, sender: 'ai', text: aiText, timestamp: Date.now() },
        ]);
        setIsLoading(false);
      }, 600);
    };
    window.addEventListener('demo-sim-send-message', handleSimSendMessage);
    return () => window.removeEventListener('demo-sim-send-message', handleSimSendMessage);
  }, []);

  useEffect(() => {
    const handleAdd = (e: Event) => {
      const ev = e as CustomEvent<ContextItem>;
      const item = ev.detail;
      if (item && item.id && item.type && item.title) {
        setContextItems((prev) => [...prev, { ...item, id: item.id || `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }]);
      }
    };
    const handleAddMultiple = (e: Event) => {
      const ev = e as CustomEvent<ContextItem[] | { contextItems?: ContextItem[] }>;
      const items = Array.isArray(ev.detail) ? ev.detail : ev.detail?.contextItems || [];
      if (items.length) {
        setContextItems((prev) => [
          ...prev,
          ...items.map((item, i) => ({
            ...item,
            id: item.id || `ctx-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 9)}`,
          })),
        ]);
      }
    };
    window.addEventListener('add-to-sidebar-context', handleAdd);
    window.addEventListener('add-multiple-to-sidebar-context', handleAddMultiple);
    return () => {
      window.removeEventListener('add-to-sidebar-context', handleAdd);
      window.removeEventListener('add-multiple-to-sidebar-context', handleAddMultiple);
    };
  }, []);

  useEffect(() => {
    if (Date.now() < suppressScrollUntilRef.current) return;
    const el = messagesScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    const el = inputAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setInputAreaHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleRemoveContext = useCallback((index: number) => {
    setContextItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    setInputValue('');
    const userMsg: DemoMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    const preset = PRESET_RESPONSES[responseIndexRef.current % PRESET_RESPONSES.length];
    responseIndexRef.current += 1;
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: 'ai',
          text: preset,
          timestamp: Date.now(),
        },
      ]);
      setIsLoading(false);
    }, 600);
  }, [inputValue, isLoading]);

  return (
    <Box
      data-demo-context-area
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.98)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
        borderLeft: isDragOverSidebar ? '3px solid #3b82f6' : undefined,
      }}
    >
      {isDragOverSidebar && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            zIndex: 10,
            pointerEvents: 'none',
            border: '2px dashed #3b82f6',
            borderRadius: 0,
          }}
        >
          <Typography variant="body2" sx={{ color: '#60a5fa', fontWeight: 600 }}>
            Drop to add to context
          </Typography>
        </Box>
      )}
      {/* Header */}
      <Box
        sx={{
          flexShrink: 0,
          p: 2,
          borderBottom: '1px solid #374151',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography variant="h6" sx={{ color: '#ffffff', fontWeight: 600, fontSize: '1rem' }}>
          AI Chat (Demo)
        </Typography>
      </Box>

      {/* Context section */}
      <Box
        sx={{
          flexShrink: 0,
          borderBottom: '1px solid #374151',
          maxHeight: 220,
          overflow: 'auto',
          p: 1,
          '&::-webkit-scrollbar': { width: '6px' },
          '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' },
          '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: '3px' },
          '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(59, 130, 246, 0.7)' },
        }}
      >
        {contextItems.length === 0 ? (
          <Typography variant="body2" sx={{ px: 1, py: 2, color: '#6b7280', fontSize: '0.8125rem' }}>
            Add items from dashboard tiles using “Add to context”.
          </Typography>
        ) : (
          <List dense sx={{ py: 0, px: 1 }}>
            {contextItems.map((item, index) => (
              <ListItem key={item.id || index} disableGutters sx={{ display: 'block', px: 0 }}>
                <ContextItemRow
                  item={item}
                  sessionId={null}
                  userId={null}
                  onRemove={() => handleRemoveContext(index)}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>

      {/* Messages - flex 1, scrolls internally; bottom padding for floating input */}
      <Box
        ref={messagesScrollRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          p: 2,
          pb: `${inputAreaHeight + 10}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          '&::-webkit-scrollbar': { width: '6px' },
          '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' },
          '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: '3px' },
          '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(59, 130, 246, 0.7)' },
        }}
      >
        {messages.length === 0 && (
          <Typography variant="body2" sx={{ color: '#6b7280', textAlign: 'center', mt: 4 }}>
            Send a message to see a demo response. Chat is not connected in this preview.
          </Typography>
        )}
        {messages.map((msg) => (
          <Box
            key={msg.id}
            sx={{
              display: 'flex',
              gap: 1,
              alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              flexDirection: msg.sender === 'user' ? 'row-reverse' : 'row',
            }}
          >
            {msg.sender === 'ai' ? (
              <SmartToyIcon sx={{ color: '#60a5fa', fontSize: 20, mt: 0.25 }} />
            ) : (
              <PersonIcon sx={{ color: '#94a3b8', fontSize: 20, mt: 0.25 }} />
            )}
            <Box
              sx={{
                px: 1.5,
                py: 1,
                borderRadius: 1.5,
                bgcolor: msg.sender === 'user' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(55, 65, 81, 0.8)',
                color: '#e5e7eb',
                fontSize: '0.875rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {msg.text}
            </Box>
          </Box>
        ))}
        {isLoading && (
          <Box sx={{ display: 'flex', gap: 1, alignSelf: 'flex-start' }}>
            <SmartToyIcon sx={{ color: '#60a5fa', fontSize: 20, mt: 0.25 }} />
            <Box sx={{ px: 1.5, py: 1, color: '#9ca3af', fontSize: '0.875rem' }}>...</Box>
          </Box>
        )}
        <div ref={messagesEndRef} />
      </Box>

      {/* Input - floating, match GlobalChatSidebar (no file upload); no blue highlight, scrollbar, expands to half sidebar */}
      <Box
        ref={inputAreaRef}
        data-demo-input
        sx={{
          flexShrink: 0,
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          p: 0.625,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          zIndex: 1,
          pointerEvents: 'auto',
        }}
      >
        <Box
          onWheel={(e) => e.stopPropagation()}
          sx={{
            width: '100%',
            p: 1,
            borderRadius: 0.5,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
            '& *:focus': { outline: 'none !important' },
          }}
        >
          <TextField
            fullWidth
            multiline
            placeholder="Message (demo only)..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            variant="standard"
            InputProps={{ disableUnderline: true }}
            sx={{
              '& .MuiInput-root': {
                backgroundColor: 'transparent',
                border: 'none',
                outline: 'none !important',
                boxShadow: 'none !important',
                padding: 0,
                margin: 0,
                overflow: 'visible',
                '&:before': { display: 'none' },
                '&:after': { display: 'none' },
                '&:hover:before': { display: 'none' },
                '&:focus': { outline: 'none !important', boxShadow: 'none !important' },
                '&:focus-within': { outline: 'none !important', boxShadow: 'none !important' },
                '&.Mui-focused': {
                  outline: 'none !important',
                  boxShadow: 'none !important',
                  '&:before': { display: 'none' },
                  '&:after': { display: 'none' },
                },
              },
              '& .MuiInput-input': {
                color: '#ffffff',
                fontSize: '0.875rem',
                paddingTop: '3px',
                paddingBottom: '3px',
                paddingLeft: '3px',
                paddingRight: '3px',
                lineHeight: '1.5',
                outline: 'none !important',
                border: 'none !important',
                '&:focus': { outline: 'none !important', border: 'none !important', boxShadow: 'none !important' },
                '&::placeholder': { color: '#6b7280', opacity: 1 },
              },
              '& textarea': {
                outline: 'none !important',
                border: 'none !important',
                resize: 'none',
                boxShadow: 'none !important',
                maxHeight: '50vh',
                minHeight: '24px',
                overflowY: 'auto !important',
                overflowX: 'hidden',
                display: 'block',
                paddingTop: '3px',
                paddingBottom: '3px',
                paddingLeft: '3px',
                paddingRight: '3px',
                '&:focus': { outline: 'none !important', border: 'none !important', boxShadow: 'none !important' },
                '&:focus-visible': { outline: 'none !important', border: 'none !important', boxShadow: 'none !important' },
                '&::-webkit-scrollbar': { width: '6px' },
                '&::-webkit-scrollbar-track': { backgroundColor: 'rgba(55, 65, 81, 0.3)' },
                '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(59, 130, 246, 0.5)', borderRadius: '3px' },
                '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(59, 130, 246, 0.7)' },
              },
            }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', mt: 0.5 }}>
            <Tooltip title="Send">
              <span>
                <IconButton
                  onClick={handleSend}
                  disabled={!inputValue.trim() || isLoading}
                  size="small"
                  sx={{
                    color: inputValue.trim() && !isLoading ? '#22c55e' : '#6b7280',
                    '&:hover': { bgcolor: inputValue.trim() && !isLoading ? 'rgba(34, 197, 94, 0.1)' : undefined },
                  }}
                >
                  <SendIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}