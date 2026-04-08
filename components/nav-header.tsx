"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "./theme-provider"

// Prefetch API data on nav hover to speed up page loads
const prefetchCache = new Set<string>()
const API_MAP: Record<string, string[]> = {
  "/": ["/api/overview?protocol=all&period=all"],
  "/leaderboard": ["/api/liquidators?protocol=all&period=all&page=1&limit=25&sort=total_gross_profit"],
  "/explorer": ["/api/liquidations?period=all&page=1&limit=50&sort=block_timestamp&order=DESC"],
  "/insights": ["/api/insights?protocol=all"],
}

function prefetchApis(href: string) {
  const apis = API_MAP[href]
  if (!apis) return
  apis.forEach((url) => {
    if (prefetchCache.has(url)) return
    prefetchCache.add(url)
    fetch(url).catch(() => prefetchCache.delete(url))
  })
}

const DASHBOARD_TITLE = "Liquidator Economy Terminal"

const NAV_ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/explorer", label: "Explorer" },
  { href: "/insights", label: "Insights" },
  { href: "/methodology", label: "Methodology" },
]

export function NavHeader() {
  const pathname = usePathname()
  const { theme, toggleTheme } = useTheme()

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href)

  return (
    <>
      {/* Top Navigation Bar */}
      <nav style={{ borderBottom: "1px solid var(--card-border)", background: "var(--panel-header)" }}>
        <div className="max-w-[1400px] mx-auto px-4 lg:px-6 flex items-center justify-between h-10">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/branding/icon.png"
                alt="Datum Labs"
                width={22}
                height={22}
                className="rounded-sm"
              />
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                |
              </span>
              <span
                className="text-[10px] uppercase tracking-[0.15em]"
                style={{ color: "var(--text-muted)" }}
              >
                {DASHBOARD_TITLE}
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={true}
                    onMouseEnter={() => prefetchApis(item.href)}
                    className="px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] rounded transition-colors"
                    style={{
                      color: active ? "var(--accent-orange)" : "var(--text-muted)",
                      background: active ? "rgba(255, 107, 53, 0.08)" : "transparent",
                      borderBottom: active
                        ? "1px solid var(--accent-orange)"
                        : "1px solid transparent",
                    }}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>

            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-1 rounded transition-colors"
              style={{ color: "var(--text-muted)" }}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>

            {/* CONNECTED indicator */}
            <span
              className="inline-flex items-center gap-1.5 text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: "var(--accent-orange)" }}
              />
              CONNECTED
            </span>
          </div>
        </div>
      </nav>

      {/* Mobile Nav */}
      <div
        className="md:hidden flex items-center gap-1 px-4 py-2 overflow-x-auto"
        style={{ borderBottom: "1px solid var(--card-border)", background: "var(--panel-header)" }}
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className="px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] rounded whitespace-nowrap transition-colors"
              style={{
                color: active ? "var(--accent-orange)" : "var(--text-muted)",
                background: active ? "rgba(255, 107, 53, 0.08)" : "transparent",
              }}
            >
              {item.label}
            </Link>
          )
        })}
      </div>
    </>
  )
}
