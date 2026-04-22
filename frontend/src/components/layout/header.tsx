"use client";

import { useAuth, SEED_USERS } from "@/context/auth-context";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn, getRoleDisplayName, getRoleBadgeColor } from "@/lib/utils";
import { displayName, getUniqueUsers } from "@/lib/seed-users";
import { ChevronDown, User, Building, Shield, Menu } from "lucide-react";

interface HeaderProps {
  onMenuClick?: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const { user, setUser } = useAuth();
  const uniqueUsers = getUniqueUsers();

  if (!user) {
    return (
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4 sm:h-16 sm:px-6">
        <div className="flex items-center gap-3">
          {onMenuClick && (
            <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenuClick} aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <h1 className="text-base font-semibold sm:text-lg">RealTrust AI</h1>
        </div>
        <div className="h-8 w-8 rounded-full bg-muted animate-pulse" aria-hidden />
      </header>
    );
  }

  const initials = user.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
    : (user.email?.[0] ?? "?").toUpperCase();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-card px-4 sm:h-16 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {onMenuClick && (
          <Button variant="ghost" size="icon" className="shrink-0 md:hidden" onClick={onMenuClick} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <h1 className="truncate text-base font-semibold sm:text-lg">RealTrust AI</h1>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        {/* Role badge - hide on very small to prevent overflow */}
        <Badge className={cn("hidden sm:inline-flex", getRoleBadgeColor(user.role))}>
          {getRoleDisplayName(user.role)}
        </Badge>

        {/* User switcher dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden min-w-0 flex-col items-start text-left sm:flex">
                <span className="truncate text-sm font-medium">{displayName(user)}</span>
                <span className="truncate text-xs text-muted-foreground">{user.organization_name}</span>
              </div>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
            <DropdownMenuLabel className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Switch User (Dev Mode)
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {uniqueUsers.map((u) => (
              <DropdownMenuItem
                key={`${u.user_id}-${u.organization_id}`}
                onClick={() => setUser(u)}
                className="flex items-center gap-3 cursor-pointer"
              >
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {u.full_name
                      ? u.full_name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                      : u.email[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex flex-col flex-1">
                  <span className="text-sm font-medium">{displayName(u)}</span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    {getRoleDisplayName(u.role)}
                    <Building className="h-3 w-3 ml-1" />
                    {u.organization_name}
                  </div>
                </div>
                {u.user_id === user.user_id && u.organization_id === user.organization_id && (
                  <div className="h-2 w-2 rounded-full bg-primary" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
