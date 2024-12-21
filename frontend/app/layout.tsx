import { Inter } from 'next/font/google'
import { SidebarProvider } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { Header } from '@/components/header'
import { TimeFrameProvider } from '@/contexts/TimeFrameContext'
import { UserProvider } from '@/contexts/UserContext'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <TimeFrameProvider>
          <UserProvider>
            <SidebarProvider>
              <AppSidebar />
              <div className="flex flex-col md:ml-64 w-full">
                <Header />
                <main className="flex-1 p-4 flex justify-center items-start">
                  <div className="w-full max-w-4xl mx-auto">
                    {children}
                  </div>
                </main>
              </div>
            </SidebarProvider>
          </UserProvider>
        </TimeFrameProvider>
      </body>
    </html>
  )
}

