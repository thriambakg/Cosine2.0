import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Collapse,
  Dialog,
  DialogContent,
  IconButton,
} from '@mui/material';
import {
  Menu as MenuIcon,
  Close as CloseIcon,
  ExpandMore as ExpandMoreIcon,
  ArrowForward as ArrowRightIcon,
} from '@mui/icons-material';

import { AuthModal } from '../auth';
import { useAuth } from '@/contexts/AuthContext';
import { GlobalChatProvider } from '@/contexts/GlobalChatContext';
import LandingDemoDashboard from './LandingDemoDashboard';

// Screenshot block: matches screenshot size/shape, scaled to fit; click opens full-size dialog
const ScreenshotBlock = ({
  title,
  imageSrc,
  imageAlt,
  onPreview,
}: {
  title: string;
  imageSrc?: string;
  imageAlt?: string;
  onPreview?: (src: string, alt: string) => void;
}) => (
  <Box
    sx={{
      width: '100%',
      padding: 0,
      borderRadius: 1,
      overflow: 'hidden',
      border: '1px solid',
      borderColor: 'divider',
      bgcolor: 'grey.900',
      cursor: imageSrc && onPreview ? 'pointer' : 'default',
      '&:hover': imageSrc && onPreview ? { borderColor: 'primary.main', boxShadow: 2 } : {},
    }}
    onClick={() => imageSrc && onPreview?.(imageSrc, imageAlt || title)}
    role={imageSrc && onPreview ? 'button' : undefined}
    aria-label={imageSrc && onPreview ? `View larger: ${imageAlt || title}` : undefined}
  >
    {imageSrc ? (
      <Box
        component="img"
        src={imageSrc}
        alt={imageAlt || title}
        sx={{
          display: 'block',
          width: '100%',
          height: 'auto',
          maxHeight: 'min(65vh, 520px)',
          objectFit: 'contain',
          verticalAlign: 'middle',
        }}
      />
    ) : (
      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', px: 2, py: 3 }}>
        Screenshot placeholder: {title}
        <br />
        <Typography component="span" variant="caption" color="text.disabled">
          Add image to public/screenshots/ and set imageSrc
        </Typography>
      </Typography>
    )}
  </Box>
);

const FEATURES = [
  {
    id: 'dashboards',
    title: 'Unified dashboards',
    description: 'Build a custom research workspace with tiles for SEC search, LDA disclosures, Congress bills, politician trades, government contracts, news, and portfolios. Arrange and resize tiles to match how you work, and pin what matters most.',
    placeholderLabel: 'Dashboards',
    imageSrc: '/screenshots/DashboardPreview.png',
    imageAlt: 'FinGov dashboard',
  },
  {
    id: 'search',
    title: 'Search across government data',
    description: 'Query SEC filings, lobbying disclosures, Congress bills, politician trades, and government contracts from one interface. Use filters to narrow results, save search sessions for later, and return to your work without starting over.',
    placeholderLabel: 'Search pages',
    imageSrc: '/screenshots/ContractSearchPreview.png',
    imageAlt: 'Search pages',
  },
  {
    id: 'files',
    title: 'Files and storage',
    description: 'Keep your research organized in an integrated filesystem. Store documents and data in one workspace, attach files or folders to the AI assistant for context, and avoid juggling multiple tools to find what you need.',
    placeholderLabel: 'File storage',
    imageSrc: '/screenshots/FilepagePreview.png',
    imageAlt: 'File storage',
  },
  {
    id: 'chat',
    title: 'AI research assistant',
    description: 'Bring SEC filings, bills, trades, or any document into the conversation. The AI reads your selected context and helps with summaries, comparisons, and answers—so you can analyze faster and make better decisions.',
    placeholderLabel: 'AI Chat',
    imageSrc: '/screenshots/ChatPreview.png',
    imageAlt: 'AI Chat',
  },
];

const FAQ_ITEMS = [
  { q: 'What is FinGov?', a: 'FinGov is a research platform that brings together government disclosures, SEC filings, lobbying data, Congress bills, politician trades, and government contracts in one workspace. You can search across these sources, save sessions and files, and use an AI assistant to summarize, compare, and answer questions about the data you select.' },
  { q: 'What data can I search?', a: 'You can search SEC filings, LDA lobbying disclosures, Congress bills, politician stock trades, and government contract awards. The platform also supports news, stock data, and your own files, so you can combine public and private sources in a single workflow.' },
  { q: 'How does the AI chat work?', a: 'You choose what the AI sees by adding search results, filings, or documents to your session context. The assistant reads that material and can summarize it, compare entities, and answer questions—so the answers are grounded in the data you’ve selected rather than generic information.' },
];

export default function LandingPageMUI() {
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [authModalOpen, setAuthModalOpenRaw] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('authModalOpen');
      return saved === 'true';
    }
    return false;
  });
  const [authMode, setAuthModeRaw] = useState<'login' | 'register'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('authMode');
      return (saved as 'login' | 'register') || 'login';
    }
    return 'login';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();

  const setAuthModalOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    setAuthModalOpenRaw(prev => {
      const next = typeof value === 'function' ? value(prev) : value;
      if (typeof window !== 'undefined') localStorage.setItem('authModalOpen', String(next));
      return next;
    });
  };

  const setAuthMode = (mode: 'login' | 'register' | ((prev: 'login' | 'register') => 'login' | 'register')) => {
    setAuthModeRaw(prev => {
      const next = typeof mode === 'function' ? mode(prev) : mode;
      if (typeof window !== 'undefined') localStorage.setItem('authMode', next);
      return next;
    });
  };

  useEffect(() => {
    if (isAuthenticated && !authModalOpen) window.location.href = '/chat';
  }, [isAuthenticated, authModalOpen]);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      setAuthMode('login');
      setAuthModalOpen(true);
    }
  }, [searchParams]);

  const handleGetStarted = () => {
    setAuthMode('register');
    setAuthModalOpen(true);
  };

  const handleSignIn = () => {
    setAuthMode('login');
    setAuthModalOpen(true);
  };

  const scrollTo = (id: string) => {
    setMobileMenuOpen(false);
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'grey.900', position: 'relative', overflow: 'hidden' }}>
      {/* Background */}
      <Box sx={{ position: 'absolute', inset: 0 }}>
        <Box sx={{ position: 'absolute', top: '20%', left: '20%', width: 400, height: 400, bgcolor: 'primary.main', opacity: 0.06, borderRadius: '50%', filter: 'blur(60px)' }} />
        <Box sx={{ position: 'absolute', bottom: '20%', right: '20%', width: 400, height: 400, bgcolor: 'secondary.main', opacity: 0.06, borderRadius: '50%', filter: 'blur(60px)' }} />
      </Box>

      {/* Nav */}
      <Box
        component="nav"
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          bgcolor: 'grey.900',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Container maxWidth="lg" disableGutters sx={{ px: { xs: 1.5, md: 2 }, py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Link
              to="/"
              style={{
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                margin: 0,
                padding: 0,
                lineHeight: 1,
              }}
            >
              <Box
                component="img"
                src="/icon.png"
                alt="FinGov"
                sx={{
                  height: { xs: 44, sm: 52, md: 60 },
                  width: 'auto',
                  display: 'block',
                }}
              />
            </Link>
            <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 3 }}>
              <Button color="inherit" onClick={() => scrollTo('features')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: '1rem' }}>
                Features
              </Button>
              <Button color="inherit" onClick={() => scrollTo('faq')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: '1rem' }}>
                FAQ
              </Button>
              <Button color="inherit" onClick={() => scrollTo('demo')} sx={{ textTransform: 'none', fontWeight: 600, fontSize: '1rem' }}>
                Try Demo
              </Button>
              <Button color="inherit" onClick={handleSignIn} sx={{ textTransform: 'none', fontWeight: 600, fontSize: '1rem' }}>
                Sign In
              </Button>
              <Button
                variant="contained"
                onClick={handleGetStarted}
                endIcon={<ArrowRightIcon />}
                sx={{ textTransform: 'none', fontWeight: 600, px: 2.5, py: 1.25, fontSize: '1rem', borderRadius: 0, boxShadow: 'none', '&:hover': { boxShadow: 'none' } }}
              >
                Get Started
              </Button>
            </Box>
            <Button
              color="inherit"
              sx={{ display: { md: 'none' }, minWidth: 40 }}
              onClick={() => setMobileMenuOpen(o => !o)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
            </Button>
          </Box>
        </Container>
        <Collapse in={mobileMenuOpen}>
          <Box sx={{ px: 2, pb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Button color="inherit" fullWidth onClick={() => scrollTo('features')}>Features</Button>
            <Button color="inherit" fullWidth onClick={() => scrollTo('faq')}>FAQ</Button>
            <Button color="inherit" fullWidth onClick={() => scrollTo('demo')}>Try Demo</Button>
            <Button color="inherit" fullWidth onClick={handleSignIn}>Sign In</Button>
            <Button variant="contained" fullWidth onClick={handleGetStarted} sx={{ borderRadius: 0, boxShadow: 'none', '&:hover': { boxShadow: 'none' } }}>Get Started</Button>
          </Box>
        </Collapse>
      </Box>

      <Box component="main" sx={{ position: 'relative', zIndex: 1, pt: { xs: 8, md: 10 } }}>
        {/* Hero */}
        <Box sx={{ py: { xs: 6, md: 10 }, px: 2 }}>
          <Container maxWidth="md">
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
              <Box component="img" src="/logo-new.png" alt="FinGov" sx={{ height: { xs: 100, sm: 130, md: 160 }, width: 'auto' }} />
            </Box>
            <Typography component="h1" sx={{ fontWeight: 800, color: 'text.primary', mt: 1, mb: 2, fontSize: { xs: '1.75rem', sm: '2.25rem', md: '2.75rem' }, lineHeight: 1.2 }}>
              Government data and financial research in one place
            </Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: { xs: '1.125rem', md: '1.25rem' }, lineHeight: 1.7, mb: 4 }}>
              FinGov unifies SEC filings, lobbying disclosures, congressional legislation, political disclosures, and government contracts in a single workspace. Search and filter across sources, then add any result to your AI assistant for analysis, summaries, and answers. Designed for researchers, compliance professionals, and investors who need reliable access to government and financial data.
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              <Button variant="contained" size="large" onClick={handleGetStarted} endIcon={<ArrowRightIcon />} sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 0, boxShadow: 'none' }}>
                Get Started Free
              </Button>
              <Button variant="outlined" size="large" onClick={() => scrollTo('demo')} sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 0 }}>
                Try Demo
              </Button>
            </Box>
          </Container>
        </Box>

        {/* Features: screenshots — 30% larger; click for full-size preview */}
        <Box id="features" sx={{ py: 8, px: 2, scrollMarginTop: 80 }}>
          <Container maxWidth="lg">
            <Box sx={{ textAlign: 'center', mb: 6 }}>
              <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary', mb: 1, fontSize: { xs: '1.75rem', md: '2rem' } }}>
                What you can do with FinGov
              </Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: { xs: '1.125rem', md: '1.25rem' } }}>
                A single platform for dashboards, search, file storage, and an AI research assistant—so you can find, organize, and analyze without switching tools.
              </Typography>
            </Box>

            {FEATURES.map((feature, index) => {
              const reverse = index % 2 === 1;
              return (
                <Box
                  key={feature.id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: reverse ? '1.3fr 1fr' : '1fr 1.3fr' },
                    gap: { xs: 3, md: 5 },
                    alignItems: 'center',
                    mb: 8,
                  }}
                >
                  <Box sx={{ order: { xs: 1, md: reverse ? 2 : 1 }, pr: { md: reverse ? 0 : 1 } }}>
                    <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', mb: 1.5, fontSize: { xs: '1.2rem', md: '1.4rem' } }}>
                      {feature.title}
                    </Typography>
                    <Typography sx={{ color: 'text.secondary', lineHeight: 1.65, fontSize: { xs: '0.95rem', md: '1.0625rem' } }}>
                      {feature.description}
                    </Typography>
                  </Box>
                  <Box sx={{ order: { xs: 2, md: reverse ? 1 : 2 } }}>
                    <ScreenshotBlock
                      title={feature.placeholderLabel}
                      imageSrc={feature.imageSrc}
                      imageAlt={feature.imageAlt}
                      onPreview={(src, alt) => setPreviewImage({ src, alt })}
                    />
                  </Box>
                </Box>
              );
            })}
          </Container>
        </Box>

        <Dialog
          open={!!previewImage}
          onClose={() => setPreviewImage(null)}
          maxWidth={false}
          PaperProps={{
            sx: {
              maxWidth: '95vw',
              maxHeight: '95vh',
              bgcolor: 'grey.900',
              borderRadius: 2,
            },
          }}
        >
          <DialogContent sx={{ p: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconButton
              aria-label="Close preview"
              onClick={() => setPreviewImage(null)}
              sx={{ position: 'absolute', top: 8, right: 8, color: 'grey.400', zIndex: 1 }}
            >
              <CloseIcon />
            </IconButton>
            {previewImage && (
              <Box
                component="img"
                src={previewImage.src}
                alt={previewImage.alt}
                sx={{ maxWidth: '100%', maxHeight: '95vh', width: 'auto', height: 'auto', objectFit: 'contain' }}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Who is it for */}
        <Box sx={{ py: 8, px: 2, bgcolor: 'grey.800' }}>
          <Container maxWidth="lg">
            <Box sx={{ textAlign: 'center', mb: 6 }}>
              <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary', mb: 1, fontSize: { xs: '1.75rem', md: '2rem' } }}>
                Who uses FinGov
              </Typography>
              <Typography sx={{ color: 'text.secondary', fontSize: { xs: '1.125rem', md: '1.25rem' } }}>
                Professionals who need to move quickly between government disclosures and financial research—without leaving one platform or losing context.
              </Typography>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 3 }}>
              {[
                { title: 'Research & due diligence', desc: 'Run searches across SEC, LDA, Congress, and contracts in one place, save sessions for later, and share context with your team so everyone works from the same view.' },
                { title: 'Compliance & policy', desc: 'Monitor lobbying activity, political trades, and government spending. Use the AI assistant to summarize and compare filings so you can stay on top of what matters.' },
                { title: 'Investors', desc: 'Use SEC filings, political trades, and government data for due diligence and market context. Combine them with news and portfolio tools inside a single workspace.' },
                { title: 'Data & filings', desc: 'Keep filings, documents, and files in one place. Attach them to the AI assistant when you need analysis or answers, without switching between apps.' },
              ].map((card, i) => (
                <Box key={i} sx={{ p: 3, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'grey.900' }}>
                  <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', mb: 1, fontSize: '1.125rem' }}>
                    {card.title}
                  </Typography>
                  <Typography sx={{ color: 'text.secondary', fontSize: { xs: '1rem', md: '1.0625rem' }, lineHeight: 1.6 }}>
                    {card.desc}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Container>
        </Box>

        {/* FAQ */}
        <Box id="faq" sx={{ py: 8, px: 2, scrollMarginTop: 80 }}>
          <Container maxWidth="md">
            <Box sx={{ textAlign: 'center', mb: 6 }}>
              <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary', mb: 1, fontSize: { xs: '1.75rem', md: '2rem' } }}>
                Frequently Asked Questions
              </Typography>
            </Box>
            {FAQ_ITEMS.map((item, i) => (
              <Box
                key={i}
                sx={{
                  borderBottom: 1,
                  borderColor: 'divider',
                  py: 2,
                }}
              >
                <Button
                  fullWidth
                  onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                  endIcon={<ExpandMoreIcon sx={{ transform: faqOpen === i ? 'rotate(180deg)' : 'none' }} />}
                  sx={{ justifyContent: 'space-between', textTransform: 'none', fontWeight: 600, color: 'text.primary', fontSize: '1.125rem' }}
                >
                  {item.q}
                </Button>
                <Collapse in={faqOpen === i}>
                  <Typography sx={{ color: 'text.secondary', pl: 0, pr: 4, pt: 1, fontSize: '1.0625rem' }}>
                    {item.a}
                  </Typography>
                </Collapse>
              </Box>
            ))}
          </Container>
        </Box>

        {/* Demo: interactive dashboard; zoom so it fits 1080p without browser zoom */}
        <Box id="demo" sx={{ scrollMarginTop: 80, zoom: 0.67, paddingBottom: 6 }}>
          <GlobalChatProvider>
            <LandingDemoDashboard />
          </GlobalChatProvider>
        </Box>

        {/* CTA */}
        <Box sx={{ py: 8, px: 2, bgcolor: 'grey.800' }}>
          <Container maxWidth="sm">
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="h3" sx={{ fontWeight: 800, color: 'text.primary', mb: 1, fontSize: { xs: '1.75rem', md: '2rem' } }}>
                Ready to bring your research into one place?
              </Typography>
              <Typography sx={{ color: 'text.secondary', mb: 3, fontSize: { xs: '1.125rem', md: '1.25rem' } }}>
                Create a free account to build your workspace, connect your data sources, and start using the AI assistant with your own context.
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 2 }}>
                <Button variant="contained" size="large" onClick={handleGetStarted} endIcon={<ArrowRightIcon />} sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 0, boxShadow: 'none', '&:hover': { boxShadow: 'none' } }}>
                  Start Free
                </Button>
                <Button variant="outlined" size="large" onClick={() => scrollTo('demo')} sx={{ textTransform: 'none', fontWeight: 600, borderRadius: 0 }}>
                  Try Demo
                </Button>
              </Box>
            </Box>
          </Container>
        </Box>

        {/* Footer */}
        <Box component="footer" sx={{ py: 4, px: 2, borderTop: 1, borderColor: 'divider' }}>
          <Container maxWidth="lg">
            <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '1rem' }}>
                © {new Date().getFullYear()} FinGov. All rights reserved.
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center' }}>
                <Button component={Link} to="/" size="small" color="inherit">Privacy</Button>
                <Button component={Link} to="/" size="small" color="inherit">Terms</Button>
              </Box>
            </Box>
          </Container>
        </Box>
      </Box>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        defaultMode={authMode}
      />
    </Box>
  );
}