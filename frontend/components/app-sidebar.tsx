import { Home, TrendingUp, DollarSign, Bell, BarChart2 } from 'lucide-react'
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
} from "@/components/ui/sidebar"
import Link from "next/link"

export function AppSidebar() {
  return (
    <Sidebar>
      <SidebarHeader>
        <h2 className="text-2xl font-bold p-6">Investment Assistant</h2>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-lg font-bold px-4 py-2">General</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className="px-4 text-sm text-[#b5b3b3]">
                  <Link href="/">
                    <Home className="mr-2 h-4 w-4 inline-block align-text-bottom" />
                    <span>Dashboard</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-lg font-bold px-4 py-2">Crypto</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className="px-4 text-sm text-[#b5b3b3]">
                  <Link href="/crypto-stats">
                    <TrendingUp className="mr-2 h-4 w-4 inline-block align-text-bottom" />
                    <span>Crypto Statistics</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-lg font-bold px-4 py-2">Stock Trading</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className="px-4 text-sm text-[#b5b3b3]">
                  <Link href="/volatility-fetcher">
                    <BarChart2 className="mr-2 h-4 w-4 inline-block align-text-bottom" />
                    <span>Volatility Fetcher</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className="px-4 text-sm text-[#b5b3b3]">
                  <Link href="/portfolio-risk">
                    <DollarSign className="mr-2 h-4 w-4 inline-block align-text-bottom" />
                    <span>Portfolio Risk</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className="px-4 text-sm text-[#b5b3b3]">
                  <Link href="/stock-alerts">
                    <Bell className="mr-2 h-4 w-4 inline-block align-text-bottom" />
                    <span>Stock Alerts</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-lg font-bold px-4 py-2">Options</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className="px-4 text-sm text-[#b5b3b3]">
                  <Link href="/option-pricing">
                    <BarChart2 className="mr-2 h-4 w-4 inline-block align-text-bottom" />
                    <span>Option Pricing</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild className="px-4 text-sm text-[#b5b3b3]">
                  <Link href="/option-heatmaps">
                    <BarChart2 className="mr-2 h-4 w-4 inline-block align-text-bottom" />
                    <span>Option Heatmaps</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

