import { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { DELIVERY_GATE_REPORT_DIR, getCompletedDeliveryGateReports } from '@/lib/delivery-gate-reports'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function parseLimit(request: NextRequest) {
  const rawLimit = Number(request.nextUrl.searchParams.get('limit') ?? 10)
  if (!Number.isFinite(rawLimit)) return 10
  return Math.min(Math.max(Math.trunc(rawLimit), 1), 50)
}

export async function GET(request: NextRequest) {
  try {
    const limit = parseLimit(request)
    const reports = getCompletedDeliveryGateReports(limit)

    return NextResponse.json({
      ok: reports.length > 0,
      checkedAt: Date.now(),
      reportDir: DELIVERY_GATE_REPORT_DIR,
      count: reports.length,
      latestOk: reports[0]?.ok ?? false,
      reports,
    }, { status: reports.length > 0 ? 200 : 404 })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to read E2E delivery gate history',
      reportDir: DELIVERY_GATE_REPORT_DIR,
    }, { status: 503 })
  }
}
