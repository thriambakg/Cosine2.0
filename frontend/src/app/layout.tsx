import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { TimeFrameProvider } from '@/contexts/TimeFrameContext';
import AmplifyClientConfig from '@/components/AmplifyClientConfig';
import ThemeProvider from '@/providers/ThemeProvider';
import ReduxProvider from '@/providers/ReduxProvider';
import SPARouter from '@/components/SPARouter';
import ErrorBoundary from '@/components/ErrorBoundary';
import RouteChangeHandler from '@/components/RouteChangeHandler';
import DebugInfo from '@/components/DebugInfo';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Cosine - AI Trading Intelligence',
  description: 'AI-powered trading intelligence platform combining mathematical precision with market analysis. Calculate, analyze, and cosign your investment decisions.',
  keywords: ['trading', 'AI', 'stocks', 'portfolio', 'analysis', 'cosine', 'financial', 'investment'],
  authors: [{ name: 'Cosine Team' }],
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'Cosine - AI Trading Intelligence',
    description: 'AI-powered trading intelligence platform',
    url: 'https://investcosine.com',
    siteName: 'Cosine',
    images: [
      {
        url: '/logo.svg',
        width: 200,
        height: 60,
        alt: 'Cosine Logo',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cosine - AI Trading Intelligence',
    description: 'AI-powered trading intelligence platform',
    images: ['/logo.svg'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  console.log('🎯 RootLayout render function executing');
  
  return (
    <html lang="en">
      <body className={inter.className}>
        <ReduxProvider>
          <ThemeProvider>
            <AmplifyClientConfig>
              <AuthProvider>
                <TimeFrameProvider>
                  <ErrorBoundary>
                    <RouteChangeHandler>
                      <SPARouter>
                        {children}
                      </SPARouter>
                      <DebugInfo />
                    </RouteChangeHandler>
                  </ErrorBoundary>
                </TimeFrameProvider>
              </AuthProvider>
            </AmplifyClientConfig>
          </ThemeProvider>
        </ReduxProvider>
      </body>
    </html>
  );
}