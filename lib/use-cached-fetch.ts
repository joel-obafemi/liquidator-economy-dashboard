"use client"

import { useState, useEffect, useRef, useCallback } from "react"

const cache = new Map<string, { data: any; timestamp: number }>()
const inflight = new Map<string, Promise<any>>()

const DEFAULT_TTL = 2 * 60 * 1000

function fetchAndCache<T>(url: string): Promise<T> {
  let promise = inflight.get(url)
  if (!promise) {
    promise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then((result) => {
        cache.set(url, { data: result, timestamp: Date.now() })
        inflight.delete(url)
        return result
      })
      .catch((err) => {
        inflight.delete(url)
        throw err
      })
    inflight.set(url, promise)
  }
  return promise
}

export function useCachedFetch<T = any>(
  url: string,
  options?: { ttl?: number; enabled?: boolean }
): { data: T | null; loading: boolean; error: string | null } {
  const ttl = options?.ttl ?? DEFAULT_TTL
  const enabled = options?.enabled ?? true

  const [data, setData] = useState<T | null>(() => {
    const cached = cache.get(url)
    if (cached) return cached.data
    return null
  })
  const [loading, setLoading] = useState(!data)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const hasDataRef = useRef(!!data)
  hasDataRef.current = !!data

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const doFetch = useCallback(() => {
    if (!enabled) return

    const cached = cache.get(url)
    if (cached && Date.now() - cached.timestamp < ttl) {
      setData(cached.data)
      setLoading(false)
      return
    }

    if (cached) {
      setData(cached.data)
      setLoading(false)
    }

    if (!hasDataRef.current) setLoading(true)

    fetchAndCache<T>(url)
      .then((result) => {
        if (mountedRef.current) {
          setData(result)
          setLoading(false)
          setError(null)
        }
      })
      .catch((err) => {
        if (mountedRef.current) {
          if (!hasDataRef.current) setError(err.message)
          setLoading(false)
        }
      })
  }, [url, ttl, enabled])

  const prevUrlRef = useRef(url)
  useEffect(() => {
    const urlChanged = prevUrlRef.current !== url
    prevUrlRef.current = url

    const cached = cache.get(url)
    if (cached) {
      setData(cached.data)
      setLoading(false)
    } else if (urlChanged) {
      setData(null)
      setLoading(true)
    }
    doFetch()
  }, [url, ttl, enabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return
    const interval = setInterval(() => { doFetch() }, ttl)
    return () => clearInterval(interval)
  }, [url, ttl, enabled, doFetch])

  return { data, loading, error }
}
