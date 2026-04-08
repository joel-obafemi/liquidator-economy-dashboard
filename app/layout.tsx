import type { Metadata } from "next"
import { Suspense } from "react"
import { NavHeader } from "@/components/nav-header"
import { Footer } from "@/components/footer"
import { ThemeProvider } from "@/components/theme-provider"
import "./globals.css"

export const metadata: Metadata = {
  title: "Liquidator Economy Terminal — Datum Labs",
  description: "Real-time liquidator economy analytics across Aave V3, SparkLend, Morpho Blue, and Fluid by Datum Labs.",
  icons: {
    icon: "/branding/icon.png",
    apple: "/branding/icon.png",
  },
}

function PageFallback() {
  return (
    <div className="max-w-[1400px] mx-auto px-4 lg:px-6 py-5 animate-pulse space-y-4">
      <div className="h-4 w-32 bg-card-bg rounded" />
      <div className="grid grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-card-bg border border-card-border rounded" />
        ))}
      </div>
      <div className="h-[340px] bg-card-bg border border-card-border rounded" />
    </div>
  )
}

// Inline script to set theme before paint (prevents FOUC)
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('liq-theme');
    var theme = stored || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch(e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <div
            className="min-h-screen font-mono flex flex-col"
            style={{ background: "var(--background)", color: "var(--text-primary)" }}
          >
            <NavHeader />
            <main className="flex-1">
              <Suspense fallback={<PageFallback />}>{children}</Suspense>
            </main>
            <Footer />

            {/* Terminal status bar */}
            <div
              className="flex items-center justify-between px-4 lg:px-6 h-7 text-[11px]"
              style={{
                borderTop: "1px solid var(--card-border)",
                background: "var(--panel-header)",
                color: "var(--text-muted)",
              }}
            >
              <div className="flex items-center gap-1.5">
                <span style={{ color: "var(--accent-orange)" }}>&gt;</span>
                <span>datumlab.xyz/liquidator-economy</span>
              </div>
              <span>Powered by Datum Labs</span>
            </div>
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
