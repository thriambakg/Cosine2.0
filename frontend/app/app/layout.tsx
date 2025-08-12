import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import AmplifyClientConfig from '@/components/AmplifyClientConfig';
import ThemeProvider from '@/providers/ThemeProvider';

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
        <ThemeProvider>
          <AmplifyClientConfig>
            <AuthProvider>
              {children}
            </AuthProvider>
          </AmplifyClientConfig>
        </ThemeProvider>
      </body>
    </html>
  );
}