import { NextRequest, NextResponse } from 'next/server'
import {
  DELIVERY_GATE_REPORT_DIR,
  getCompletedDeliveryGateReports,
  readDeliveryGateReportMarkdown,
} from '@/lib/delivery-gate-reports'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const latest = getCompletedDeliveryGateReports(1)[0]
    if (!latest) {
      return NextResponse.json({
        ok: false,
        error: 'No completed E2E delivery gate reports found',
        reportDir: DELIVERY_GATE_REPORT_DIR,
      }, { status: 404 })
    }

    if (request.nextUrl.searchParams.get('format') === 'markdown') {
      return new Response(readDeliveryGateReportMarkdown(latest.reportPath), {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'X-Delivery-Gate-Report': latest.report,
        },
      })
    }

    return NextResponse.json({ ...latest, checkedAt: Date.now() })
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to read E2E delivery gate report',
      reportDir: DELIVERY_GATE_REPORT_DIR,
    }, { status: 503 })
  }
}
