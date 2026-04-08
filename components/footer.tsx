import Link from "next/link"

export function Footer() {
  return (
    <footer
      className="mt-10"
      style={{
        borderTop: "1px solid var(--card-border)",
        background: "var(--panel-header)",
      }}
    >
      <div className="max-w-[1400px] mx-auto px-4 lg:px-6 py-5">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div
            className="text-[11px] leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            Found any inaccurate data, or want a new data point added? Send me a DM on{" "}
            <a
              href="https://x.com/joel_obafemi"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline font-medium"
              style={{ color: "var(--accent-orange)" }}
            >
              X (@joel_obafemi)
            </a>{" "}
            or email{" "}
            <a
              href="mailto:joelobafemii@gmail.com"
              className="hover:underline font-medium"
              style={{ color: "var(--accent-orange)" }}
            >
              joelobafemii@gmail.com
            </a>
            .
          </div>
          <div
            className="flex items-center gap-4 text-[10px] uppercase tracking-[0.1em]"
            style={{ color: "var(--text-muted)" }}
          >
            <Link href="/methodology" className="hover:opacity-80 transition-opacity">
              Methodology
            </Link>
            <span style={{ color: "var(--card-border)" }}>|</span>
            <a
              href="https://x.com/joel_obafemi"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:opacity-80 transition-opacity"
              aria-label="DM on X"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              X
            </a>
            <span style={{ color: "var(--card-border)" }}>|</span>
            <a
              href="mailto:joelobafemii@gmail.com"
              className="flex items-center gap-1 hover:opacity-80 transition-opacity"
              aria-label="Email"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
              Email
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
