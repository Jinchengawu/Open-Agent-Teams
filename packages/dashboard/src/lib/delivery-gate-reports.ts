import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'

export interface DeliveryGateReportSummary {
  ok: boolean
  report: string
  reportPath: string
  reportTime: string | null
  mtimeMs: number
  pass: number
  fail: number
  warn: number
  total: number
  summary: string
}

const ROOT = resolve(process.cwd(), '../..')
export const DELIVERY_GATE_REPORT_DIR = join(ROOT, 'scripts', 'test-reports')
const REPORT_PATTERN = /^e2e-delivery-gate-\d{8}_\d{6}\.md$/

function parseCount(content: string, label: 'PASS' | 'FAIL' | 'WARN') {
  const match = content.match(new RegExp(`- ${label}:\\s*(\\d+)`))
  return match ? Number(match[1]) : 0
}

function parseReportTime(name: string) {
  const match = name.match(/^e2e-delivery-gate-(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.md$/)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

function parseCompletedReport(path: string) {
  const content = readFileSync(path, 'utf8')
  if (!content.includes('## Summary')) return null

  const pass = parseCount(content, 'PASS')
  const fail = parseCount(content, 'FAIL')
  const warn = parseCount(content, 'WARN')
  const total = pass + fail + warn
  if (total === 0) return null
  return { pass, fail, warn, total }
}

export function getCompletedDeliveryGateReports(limit = 10): DeliveryGateReportSummary[] {
  if (!existsSync(DELIVERY_GATE_REPORT_DIR)) return []

  return readdirSync(DELIVERY_GATE_REPORT_DIR)
    .filter((name) => REPORT_PATTERN.test(name))
    .map((name) => {
      const path = join(DELIVERY_GATE_REPORT_DIR, name)
      return { name, path, mtimeMs: statSync(path).mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((report) => {
      const summary = parseCompletedReport(report.path)
      if (!summary) return null
      const { pass, fail, warn, total } = summary
      return {
        ok: fail === 0 && warn === 0 && pass > 0,
        report: report.name,
        reportPath: report.path,
        reportTime: parseReportTime(report.name),
        mtimeMs: report.mtimeMs,
        pass,
        fail,
        warn,
        total,
        summary: `PASS=${pass} FAIL=${fail} WARN=${warn}`,
      }
    })
    .filter((report): report is DeliveryGateReportSummary => Boolean(report))
    .slice(0, limit)
}

export function readDeliveryGateReportMarkdown(reportPath: string) {
  return readFileSync(reportPath, 'utf8')
}
