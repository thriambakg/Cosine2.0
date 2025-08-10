import "./globals.css"
import { Inter } from 'next/font/google'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { Header } from '@/components/header'
import { TimeFrameProvider } from '@/contexts/TimeFrameContext'
import { UserProvider } from '@/contexts/UserContext'
import { AuthProvider } from '@/contexts/AuthContext'
import AuthWrapper from '@/components/AuthWrapper'
import AmplifyClientConfig from '@/components/AmplifyClientConfig'
import Script from 'next/script'

const inter = Inter({ subsets: ['latin'] })

// Generate static metadata
export const metadata = {
  title: 'Cosine - Interactive Investment Assistant',
  description: 'AI-powered investment analysis and portfolio management',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <Script id="spa-routing" strategy="beforeInteractive">
          {`
            // Handle SPA routing for CloudFront + S3
            (function() {
              var path = window.location.pathname;
              var validRoutes = ['/', '/login', '/chat', '/crypto-stats', '/heatmap', '/option-pricing', '/portfolio-risk', '/robinhood', '/stock-alerts', '/stock-volatility', '/auth/callback'];
              
              // If we're on a valid route but it's not rendering correctly,
              // it means CloudFront served index.html but the browser needs to handle routing
              if (validRoutes.includes(path) && path !== '/') {
                // Store the intended path for the app to handle
                sessionStorage.setItem('intendedPath', path);
              }
            })();
          `}
        </Script>
      </head>
      <body className={inter.className}>
        <AmplifyClientConfig>
          <AuthProvider>
            <AuthWrapper>
              <TimeFrameProvider>
                <UserProvider>
                  <SidebarProvider>
                    <div className="flex h-screen overflow-hidden">
                      {/* Sidebar Section */}
                      <AppSidebar />
                      {/* Main Content Section */}
                      <div className="flex-1 flex flex-col overflow-hidden">
                      <Header />
                      <main className="flex-1 overflow-x-hidden overflow-y-auto flex justify-center">
                        {/* Centered Container */}
                        <div className="w-full max-w-6xl px-4 py-8">
                          {children}
                        </div>
                      </main>
                    </div>
                  </div>
                </SidebarProvider>
              </UserProvider>
            </TimeFrameProvider>
          </AuthWrapper>
        </AuthProvider>
        </AmplifyClientConfig>
      </body>
    </html>
  )
}