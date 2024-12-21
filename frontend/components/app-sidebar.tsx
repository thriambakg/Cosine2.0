"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart, Clock, CreditCard, DollarSign, Home, LineChart, PieChart, Settings } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

const navItems = [
  { title: 'Home', icon: Home, href: '/' },
  { title: 'Stock Volatility', icon: LineChart, href: '/stock-volatility' },
  { title: 'Crypto Stats', icon: CreditCard, href: '/crypto-stats' },
  { title: 'Portfolio Risk', icon: PieChart, href: '/portfolio-risk' },
  { title: 'Stock Alerts', icon: BarChart, href: '/stock-alerts' },
  { title: 'Option Pricing', icon: DollarSign, href: '/option-pricing' },
  { title: 'Heatmap', icon: Settings, href: '/heatmap' },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader>
        <h2 className="text-2xl font-bold">Cosine</h2>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href}>
                    <Link href={item.href}>
                      <item.icon className="mr-2 h-4 w-4" />
                      {item.title}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}

