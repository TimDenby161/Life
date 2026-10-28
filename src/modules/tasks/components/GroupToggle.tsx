import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A collapsible group of task rows. Level 1 is a section (Today, Overdue…),
 * level 2 a category inside it; a level-2 group's rows hang off a guide line
 * so it's clear which heading they belong to.
 */
export function TaskGroup({
  id,
  level,
  label,
  count,
  dot,
  danger,
  open,
  onToggle,
  children,
}: {
  id: string
  level: 1 | 2
  label: ReactNode
  count: number
  dot?: string
  danger?: boolean
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const Heading = level === 1 ? 'h2' : 'h3'
  return (
    <section aria-labelledby={id} className={level === 1 ? 'mb-1 last:mb-0' : undefined}>
      <Heading id={id}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className={cn(
            'flex w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-muted/60',
            level === 1 ? 'py-2 text-sm font-semibold text-foreground' : 'py-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground',
            danger && 'text-destructive hover:text-destructive',
          )}
        >
          <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          {dot ? <span className={cn('size-2.5 shrink-0 rounded-full', dot)} /> : null}
          <span className="truncate">{label}</span>
          <span
            className={cn(
              'ml-auto shrink-0 rounded-full px-2 text-xs font-medium tabular',
              level === 1 ? 'bg-muted py-0.5 text-muted-foreground' : 'text-muted-foreground',
              danger && level === 1 && 'bg-destructive/10 text-destructive',
            )}
          >
            {count}
          </span>
        </button>
      </Heading>
      {open ? <div className={level === 2 ? 'mb-1 ml-4 border-l pl-1' : 'pb-1 pl-3'}>{children}</div> : null}
    </section>
  )
}
