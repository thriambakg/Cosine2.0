import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { TimeFrameProvider } from '@/contexts/TimeFrameContext';
import AmplifyClientConfig from '@/components/AmplifyClientConfig';
import ThemeProvider from '@/providers/ThemeProvider';
import ReduxProvider from '@/providers/ReduxProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Cosine - AI Trading Platform',
  description: 'Advanced AI-powered trading intelligence platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ReduxProvider>
          <ThemeProvider>
            <AmplifyClientConfig>
              <AuthProvider>
                <TimeFrameProvider>
                  {children}
                </TimeFrameProvider>
              </AuthProvider>
            </AmplifyClientConfig>
          </ThemeProvider>
        </ReduxProvider>
      </body>
    </html>
  );
}