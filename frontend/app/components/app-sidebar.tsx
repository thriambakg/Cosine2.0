"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart, CreditCard, DollarSign, Home, LineChart, PieChart, Settings, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const navItems = [
  { title: "Home", icon: Home, href: "/" },
  { title: "Stock Volatility", icon: LineChart, href: "/stock-volatility" },
  { title: "Crypto Stats", icon: CreditCard, href: "/crypto-stats" },
  { title: "Portfolio Risk", icon: PieChart, href: "/portfolio-risk" },
  { title: "Stock Alerts", icon: BarChart, href: "/stock-alerts" },
  { title: "Option Pricing", icon: DollarSign, href: "/option-pricing" },
  { title: "Heatmap", icon: Settings, href: "/heatmap" },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <div className="flex">
      {/* Sidebar always visible on large screens */}
      <aside className="hidden lg:block w-64 bg-gray-50 h-screen p-4 shadow-md">
        <SidebarContent pathname={pathname} />
      </aside>

      {/* Hamburger menu for small screens */}
      <div className="lg:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">
              <Menu className="w-6 h-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>Cosine</SheetTitle>
              <SheetDescription>Your Interactive Investment Assistant</SheetDescription>
            </SheetHeader>
            <SidebarContent pathname={pathname} />
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

function SidebarContent({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-col mt-4">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex items-center px-4 py-2 mt-2 text-gray-600 rounded-lg hover:bg-gray-100 ${
            pathname === item.href ? "bg-gray-100" : ""
          }`}
        >
          <item.icon className="w-5 h-5 mr-2" />
          {item.title}
        </Link>
      ))}
    </nav>
  );
}
