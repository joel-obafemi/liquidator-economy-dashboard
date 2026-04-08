import { NextResponse } from "next/server"
import { scanLiquidations } from "@/lib/scanner"

export const maxDuration = 300
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const url = new URL(request.url)
    const protocol = url.searchParams.get("protocol") || "all"
    const result = await scanLiquidations(protocol)
    return NextResponse.json({ ok: true, result })
  } catch (e: any) {
    console.error("Scan error:", e)
    return NextResponse.json(
      { error: e?.message?.slice(0, 200) },
      { status: 500 }
    )
  }
}

export async function GET(request: Request) {
  return POST(request)
}
