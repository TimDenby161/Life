import { subDays, subMonths } from 'date-fns'
import { Input } from './ui/input'
import { Segmented } from './ui/misc'
import { toISODate, todayISO } from '@/lib/dates'

export type RangePreset = '4w' | '3m' | '12m' | 'custom'

export function rangeFromPreset(preset: RangePreset, now = new Date()): { from: string; to: string } {
  const to = todayISO(now)
  switch (preset) {
    case '4w':
      return { from: toISODate(subDays(now, 27)), to }
    case '3m':
      return { from: toISODate(subMonths(now, 3)), to }
    default:
      return { from: toISODate(subMonths(now, 12)), to }
  }
}

export function RangePicker({
  preset,
  range,
  onChange,
}: {
  preset: RangePreset
  range: { from: string; to: string }
  onChange: (preset: RangePreset, range: { from: string; to: string }) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        aria-label="Period"
        size="sm"
        value={preset}
        onChange={(p) => onChange(p, p === 'custom' ? range : rangeFromPreset(p))}
        options={[
          { value: '4w', label: '4 weeks' },
          { value: '3m', label: '3 months' },
          { value: '12m', label: '12 months' },
          { value: 'custom', label: 'Custom' },
        ]}
      />
      {preset === 'custom' ? (
        <div className="flex items-center gap-1.5 text-sm">
          <Input type="date" aria-label="From" className="h-8 w-auto" value={range.from} max={range.to} onChange={(e) => e.target.value && onChange('custom', { ...range, from: e.target.value })} />
          –
          <Input type="date" aria-label="To" className="h-8 w-auto" value={range.to} min={range.from} onChange={(e) => e.target.value && onChange('custom', { ...range, to: e.target.value })} />
        </div>
      ) : null}
    </div>
  )
}
