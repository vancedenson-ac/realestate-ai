"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/auth-context";
import { getRoleDisplayName } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Home,
  FileText,
  Building2,
  ListChecks,
  DollarSign,
  FileCheck,
  MessageSquare,
  Sparkles,
  Bookmark,
  Calendar,
  ClipboardCheck,
  Scale,
  KeyRound,
} from "lucide-react";

interface NavItem {
  title: string;
  href: string;
  icon: React.ElementType;
  roles?: string[];
}

const navItems: NavItem[] = [
  { title: "Dashboard", href: "/", icon: Home },
  { title: "Transactions", href: "/transactions", icon: FileText },
  { title: "Properties", href: "/properties", icon: Building2 },
  { title: "Listings", href: "/listings", icon: ListChecks },
  { title: "Showings", href: "/showings", icon: Calendar },
  { title: "Offers", href: "/offers", icon: DollarSign },
  { title: "Documents", href: "/documents", icon: FileCheck },
  { title: "Inspections", href: "/inspections", icon: ClipboardCheck, roles: ["INSPECTOR", "BUYER", "BUYER_AGENT", "SELLER", "SELLER_AGENT", "ADMIN"] },
  { title: "Escrow", href: "/escrow", icon: Scale, roles: ["ESCROW_OFFICER", "BUYER", "SELLER", "BUYER_AGENT", "SELLER_AGENT", "ADMIN"] },
  { title: "Title", href: "/title", icon: KeyRound, roles: ["ESCROW_OFFICER", "BUYER", "SELLER", "BUYER_AGENT", "SELLER_AGENT", "LENDER", "ADMIN"] },
  { title: "Chat", href: "/chat", icon: MessageSquare },
  { title: "Saved", href: "/saved", icon: Bookmark, roles: ["BUYER", "BUYER_AGENT"] },
  { title: "Recommendations", href: "/recommendations", icon: Sparkles, roles: ["BUYER", "BUYER_AGENT"] },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  const visibleItems = navItems.filter(
    (item) => !item.roles || (user && item.roles.includes(user.role))
  );

  return (
    <>
      {/* Desktop: always-visible sidebar */}
      <aside
        className={cn(
          "flex h-full w-64 shrink-0 flex-col border-r bg-card transition-transform duration-200 ease-out",
          "md:translate-x-0 md:relative",
          "fixed inset-y-0 left-0 z-50 md:static",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        role="navigation"
        aria-label="Main navigation"
      >
        {/* Logo */}
        <div className="flex h-16 items-center justify-between border-b px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2" onClick={onClose}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Building2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold">RealTrust AI</span>
          </Link>
        </div>

        {/* Theme toggle */}
        <div className="flex items-center justify-end border-b px-4 py-2">
          <ThemeToggle />
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {visibleItems.map((item) => {
            const isActive =
              pathname != null &&
              (pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href)));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {item.title}
              </Link>
            );
          })}
        </nav>

        {/* User info at bottom */}
        {user && (
          <div className="border-t p-4">
            <div className="rounded-lg bg-muted p-3">
              <p className="truncate text-sm font-medium">{user.full_name || user.email}</p>
              <p className="text-xs text-muted-foreground">{getRoleDisplayName(user.role)}</p>
              <p className="truncate text-xs text-muted-foreground">{user.organization_name}</p>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
