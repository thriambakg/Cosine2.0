import './globals.css'
import { Inter } from 'next/font/google'
import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Investment Assistant',
  description: 'Your interactive Investment Assistant',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <SidebarProvider>
          <AppSidebar />
          <main className="p-4 md:ml-64">
            {children}
          </main>
        </SidebarProvider>
      </body>
    </html>
  )
}

