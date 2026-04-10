"use client"

import { useState, useRef, useCallback, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { toPng } from "html-to-image"

interface ChartWrapperProps {
  /** Card title shown in the header */
  title: string
  /** Optional subtitle / secondary text */
  subtitle?: string
  /** Optional extra content in the header (e.g. legend, links) */
  headerExtra?: ReactNode
  /** The chart + any surrounding content to render */
  children: ReactNode
  /** Extra classes on the outer card */
  className?: string
  /** Fixed height for the chart area (default: auto) */
  height?: number
}

/**
 * Wraps any chart card with expand (fullscreen) and screenshot (PNG download)
 * buttons. Screenshots use html-to-image which serializes the SVG natively
 * so Recharts charts are pixel-perfect with no distortion.
 */
export function ChartWrapper({
  title,
  subtitle,
  headerExtra,
  children,
  className = "",
  height,
}: ChartWrapperProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const fullscreenRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [capturing, setCapturing] = useState(false)

  const handleScreenshot = useCallback(async () => {
    const target = expanded ? fullscreenRef.current : chartRef.current
    if (!target || capturing) return

    setCapturing(true)
    try {
      // Compute styles so CSS variables resolve to real colors
      const computedBg = getComputedStyle(document.documentElement)
        .getPropertyValue("--card-bg")
        .trim()

      const dataUrl = await toPng(target, {
        pixelRatio: 2, // 2x for retina-quality output
        backgroundColor: computedBg || "#111318",
        cacheBust: true,
        // Ensure fonts render in the screenshot
        style: {
          fontFamily: "'JetBrains Mono', monospace",
        },
      })

      // Download
      const link = document.createElement("a")
      link.download = `${title.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-${Date.now()}.png`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error("Screenshot failed:", err)
    } finally {
      setCapturing(false)
    }
  }, [title, expanded, capturing])

  const handleExpand = useCallback(() => {
    setExpanded(true)
    // Prevent body scroll when modal is open
    document.body.style.overflow = "hidden"
  }, [])

  const handleClose = useCallback(() => {
    setExpanded(false)
    document.body.style.overflow = ""
  }, [])

  const actionButtons = (
    <div className="flex items-center gap-1">
      {/* Screenshot button */}
      <button
        onClick={handleScreenshot}
        disabled={capturing}
        className="p-1.5 rounded transition-colors hover:bg-card-border/30"
        style={{ color: "var(--text-muted)" }}
        title="Download as PNG"
        aria-label="Download chart as PNG"
      >
        {capturing ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        )}
      </button>

      {/* Expand button */}
      {!expanded && (
        <button
          onClick={handleExpand}
          className="p-1.5 rounded transition-colors hover:bg-card-border/30"
          style={{ color: "var(--text-muted)" }}
          title="Expand chart"
          aria-label="Expand chart to fullscreen"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      )}

      {/* Close button (only in expanded mode) */}
      {expanded && (
        <button
          onClick={handleClose}
          className="p-1.5 rounded transition-colors hover:bg-card-border/30"
          style={{ color: "var(--text-muted)" }}
          title="Close"
          aria-label="Close fullscreen"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  )

  // Card header with title + action buttons
  const header = (
    <div className="flex items-start justify-between mb-3">
      <div>
        <h2 className="text-xs font-medium text-text-secondary">{title}</h2>
        {subtitle && (
          <p className="text-[10px] text-text-tertiary mt-0.5">{subtitle}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {headerExtra}
        {actionButtons}
      </div>
    </div>
  )

  // Inline card (normal mode)
  const card = (
    <div
      ref={chartRef}
      className={`tui-card bg-card-bg border border-card-border rounded p-4 ${className}`}
    >
      {header}
      <div style={height ? { height } : undefined}>{children}</div>
    </div>
  )

  // Fullscreen modal
  const modal =
    expanded && typeof window !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.85)" }}
            onClick={(e) => {
              // Close when clicking backdrop
              if (e.target === e.currentTarget) handleClose()
            }}
          >
            <div
              ref={fullscreenRef}
              className="tui-card bg-card-bg border border-card-border rounded p-6 w-[92vw] max-h-[90vh] overflow-auto"
              style={{
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-sm font-medium text-text-primary">{title}</h2>
                  {subtitle && (
                    <p className="text-[11px] text-text-tertiary mt-0.5">{subtitle}</p>
                  )}
                </div>
                {actionButtons}
              </div>
              <div style={{ height: "calc(90vh - 120px)" }}>{children}</div>
            </div>
          </div>,
          document.body
        )
      : null

  return (
    <>
      {card}
      {modal}
    </>
  )
}
