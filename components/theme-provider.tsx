"use client"

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react"

type Theme = "light" | "dark"

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  toggleTheme: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

/** Returns CSS variable values for the current theme (for inline styles / Recharts) */
export function useThemeColors() {
  const { theme } = useTheme()
  return theme === "light"
    ? {
        background: "#F5F7FA",
        cardBg: "#FFFFFF",
        cardBorder: "rgba(0, 0, 0, 0.08)",
        textPrimary: "#1A1E24",
        textSecondary: "#4B5563",
        textMuted: "#6B7280",
        accent: "#E55A1F",
        success: "#059669",
        danger: "#DC2626",
      }
    : {
        background: "#0B0D0F",
        cardBg: "#111318",
        cardBorder: "rgba(255, 255, 255, 0.08)",
        textPrimary: "#E0E0E0",
        textSecondary: "#A0A4AB",
        textMuted: "#6B7280",
        accent: "#FF6B35",
        success: "#10B981",
        danger: "#FF4444",
      }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark")

  useEffect(() => {
    const stored = localStorage.getItem("liq-theme") as Theme | null
    if (stored === "light" || stored === "dark") {
      setTheme(stored)
      document.documentElement.setAttribute("data-theme", stored)
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches
      const systemTheme = prefersDark ? "dark" : "light"
      setTheme(systemTheme)
      document.documentElement.setAttribute("data-theme", systemTheme)
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem("liq-theme")
      if (!stored) {
        const newTheme = e.matches ? "dark" : "light"
        setTheme(newTheme)
        document.documentElement.setAttribute("data-theme", newTheme)
      }
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark"
      localStorage.setItem("liq-theme", next)
      document.documentElement.setAttribute("data-theme", next)
      return next
    })
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
