// Static class maps so Tailwind can see every class at build time.
export const COLOR_NAMES = ['indigo', 'rose', 'emerald', 'amber', 'sky', 'violet', 'teal', 'orange', 'slate'] as const
export type ColorName = (typeof COLOR_NAMES)[number]

export const swatch: Record<ColorName, { bg: string; soft: string; text: string; dot: string; ring: string }> = {
  indigo: { bg: 'bg-indigo-500', soft: 'bg-indigo-500/12 dark:bg-indigo-400/15', text: 'text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500', ring: 'ring-indigo-500/40' },
  rose: { bg: 'bg-rose-500', soft: 'bg-rose-500/12 dark:bg-rose-400/15', text: 'text-rose-700 dark:text-rose-300', dot: 'bg-rose-500', ring: 'ring-rose-500/40' },
  emerald: { bg: 'bg-emerald-500', soft: 'bg-emerald-500/12 dark:bg-emerald-400/15', text: 'text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500', ring: 'ring-emerald-500/40' },
  amber: { bg: 'bg-amber-500', soft: 'bg-amber-500/15 dark:bg-amber-400/15', text: 'text-amber-800 dark:text-amber-300', dot: 'bg-amber-500', ring: 'ring-amber-500/40' },
  sky: { bg: 'bg-sky-500', soft: 'bg-sky-500/12 dark:bg-sky-400/15', text: 'text-sky-700 dark:text-sky-300', dot: 'bg-sky-500', ring: 'ring-sky-500/40' },
  violet: { bg: 'bg-violet-500', soft: 'bg-violet-500/12 dark:bg-violet-400/15', text: 'text-violet-700 dark:text-violet-300', dot: 'bg-violet-500', ring: 'ring-violet-500/40' },
  teal: { bg: 'bg-teal-500', soft: 'bg-teal-500/12 dark:bg-teal-400/15', text: 'text-teal-700 dark:text-teal-300', dot: 'bg-teal-500', ring: 'ring-teal-500/40' },
  orange: { bg: 'bg-orange-500', soft: 'bg-orange-500/12 dark:bg-orange-400/15', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500', ring: 'ring-orange-500/40' },
  slate: { bg: 'bg-slate-500', soft: 'bg-slate-500/12 dark:bg-slate-400/15', text: 'text-slate-700 dark:text-slate-300', dot: 'bg-slate-400', ring: 'ring-slate-500/40' },
}

export function colorOf(name: string | null | undefined) {
  return swatch[(name as ColorName) in swatch ? (name as ColorName) : 'slate']
}

/** Chart colours for people and series, from CSS tokens (theme-aware). */
export const chartColor = (i: number) => `var(--chart-${(i % 6) + 1})`
