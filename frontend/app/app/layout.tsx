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

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
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
