"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

const storageKey = "realtrust-theme";

interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * Wraps the app with next-themes. Uses class-based dark mode (Tailwind .dark)
 * and persists choice in localStorage. No system preference (light/dark only).
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      storageKey={storageKey}
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
