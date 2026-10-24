// Shared chart building blocks. Conventions (see docs/ARCHITECTURE.md → Charts):
// thin marks, 2px surface gaps, recessive grid, a legend for 2+ series, text in
// text tokens (never the series colour), and a table view for every chart.
import { Table2 } from 'lucide-react'
import { useState } from 'react'
import type { TooltipContentProps } from 'recharts'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

export type SeriesKey = { key: string; label: string; color: string; dashed?: boolean }

export const axisProps = {
  tick: { fill: 'var(--chart-axis)', fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const

export const gridProps = { stroke: 'var(--chart-grid)', vertical: false, strokeDasharray: undefined } as const

export function Legend({ items, className }: { items: SeriesKey[]; className?: string }) {
  if (items.length < 2) return null
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground', className)}>
      {items.map((i) => (
        <li key={i.key} className="inline-flex items-center gap-1.5">
          {i.dashed ? (
            <span className="h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: i.color }} aria-hidden />
          ) : (
            <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} aria-hidden />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  )
}

export function ChartCard({
  title,
  description,
  legend,
  table,
  children,
  className,
  action,
}: {
  title: string
  description?: React.ReactNode
  legend?: SeriesKey[]
  /** Accessible table alternative of the chart's data. */
  table?: { columns: string[]; rows: (string | number)[][] }
  children: React.ReactNode
  className?: string
  action?: React.ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  return (
    <Card className={className}>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription className="mt-0.5 text-xs">{description}</CardDescription> : null}
        </div>
        <div className="flex items-center gap-1">
          {action}
          {table ? (
            <button
              type="button"
              onClick={() => setShowTable(!showTable)}
              aria-pressed={showTable}
              className={cn('rounded-full p-1.5 text-muted-foreground hover:bg-muted', showTable && 'bg-muted text-foreground')}
              aria-label={showTable ? 'Show chart' : 'Show as table'}
              title={showTable ? 'Show chart' : 'Show as table'}
            >
              <Table2 className="size-4" />
            </button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {legend && !showTable ? <Legend items={legend} className="mb-3" /> : null}
        {showTable && table ? <DataTable {...table} /> : children}
      </CardContent>
    </Card>
  )
}

export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-80 overflow-auto">
      <table className="w-full text-sm tabular">
        <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
          <tr>
            {columns.map((c, i) => (
              <th key={c} className={cn('py-1.5 font-medium', i > 0 && 'text-right')}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {r.map((cell, j) => (
                <td key={j} className={cn('py-1.5', j > 0 && 'text-right')}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ChartTooltip({
  active,
  payload,
  label,
  formatValue = (v) => String(v),
  labelFormatter,
}: Partial<TooltipContentProps<number, string>> & {
  formatValue?: (v: number) => string
  labelFormatter?: (label: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{labelFormatter ? labelFormatter(String(label)) : label}</p>
      <ul className="grid gap-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-[2px]" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="tabular font-medium">{formatValue(Number(p.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function StatTile({
  label,
  value,
  sub,
  tone,
  className,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'danger' | 'success'
  className?: string
}) {
  return (
    <Card className={cn('p-4', className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tracking-tight tabular',
          tone === 'danger' && 'text-destructive',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </Card>
  )
}

/** A single 100% bar split between series, with 2px surface gaps and labels. */
export function ShareBar({
  segments,
  label,
}: {
  segments: { key: string; label: string; value: number; color: string }[]
  label: string
}) {
  const total = segments.reduce((s, x) => s + x.value, 0)
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular">{total}</span>
      </div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label}: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
        {total > 0
          ? segments
              .filter((s) => s.value > 0)
              .map((s) => <div key={s.key} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />)
          : null}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {segments.map((s) => (
          <span key={s.key} className="tabular">
            {s.label} {total ? Math.round((s.value / total) * 100) : 0}%
          </span>
        ))}
      </div>
    </div>
  )
}

/** Horizontal bar list with values at the bar tip; segments stack by series. */
export function BarList({
  rows,
  series,
  formatValue = (v) => String(v),
}: {
  rows: { key: string; label: string; values: Record<string, number> }[]
  series: SeriesKey[]
  formatValue?: (v: number) => string
}) {
  const totals = rows.map((r) => series.reduce((s, x) => s + (r.values[x.key] ?? 0), 0))
  const max = Math.max(1, ...totals)
  return (
    <ul className="grid gap-2.5">
      {rows.map((r, i) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,7.5rem)_1fr] items-center gap-3 text-sm sm:grid-cols-[minmax(0,10rem)_1fr]">
          <span className="truncate text-muted-foreground" title={r.label}>
            {r.label}
          </span>
          <div className="flex items-center gap-2">
            <div className="flex h-3.5 gap-[2px]" style={{ width: `${(totals[i] / max) * 100}%` }} title={series.map((s) => `${s.label}: ${formatValue(r.values[s.key] ?? 0)}`).join(' · ')}>
              {series.map((s, j) => {
                const v = r.values[s.key] ?? 0
                if (!v) return null
                const last = series.slice(j + 1).every((n) => !(r.values[n.key] ?? 0))
                return <div key={s.key} className={cn(last && 'rounded-r-[4px]')} style={{ flexGrow: v, background: s.color }} />
              })}
            </div>
            <span className="shrink-0 text-xs font-medium tabular">{formatValue(totals[i])}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
