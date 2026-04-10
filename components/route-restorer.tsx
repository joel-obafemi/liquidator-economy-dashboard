"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

const STORAGE_KEY = "liq-last-route"

/**
 * Persists the current route in sessionStorage so that when the page is
 * reloaded (e.g. parent iframe refresh), the user is returned to the page
 * they were on rather than being dumped back to "/".
 */
export function RouteRestorer() {
  const pathname = usePathname()
  const router = useRouter()
  const restored = useRef(false)

  // On first mount: if we landed on "/" but sessionStorage says we were
  // somewhere else, redirect there. This only fires once per session reload.
  useEffect(() => {
    if (restored.current) return
    restored.current = true

    try {
      const stored = sessionStorage.getItem(STORAGE_KEY)
      if (stored && stored !== "/" && pathname === "/") {
        router.replace(stored)
      }
    } catch {
      // sessionStorage not available (e.g. incognito in some browsers)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On every route change, persist the current path
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, pathname)
    } catch {
      // ignore
    }
  }, [pathname])

  return null
}
