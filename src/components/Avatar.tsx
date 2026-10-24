import { colorOf } from '@/lib/colors'
import { cn } from '@/lib/utils'

export function Avatar({
  name,
  color,
  size = 'md',
  className,
}: {
  name: string | null | undefined
  color?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const c = colorOf(color)
  const sizes = { xs: 'size-5 text-[10px]', sm: 'size-6 text-[11px]', md: 'size-8 text-xs', lg: 'size-11 text-base' }
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white', c.bg, sizes[size], className)}
      title={name ?? undefined}
      aria-hidden
    >
      {(name ?? '?').slice(0, 1).toUpperCase()}
    </span>
  )
}
