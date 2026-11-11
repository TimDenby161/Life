import { format } from 'date-fns'
import { Check } from 'lucide-react'
import { useState } from 'react'
import { ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { parseISODate } from '@/lib/dates'
import { useMealNames } from '../api'

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Swap one meal for another: the meals you have had, most recent first, with
 * when you last had them. Typing filters the list, and anything typed that is
 * not in it can be used as it is.
 */
export function SwapMeal({
  open,
  onOpenChange,
  what,
  current,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "Thursday dinner" */
  what: string
  current: string
  onPick: (name: string) => void
}) {
  const past = useMealNames()
  const [text, setText] = useState('')
  const q = tidy(text).toLowerCase()
  const now = tidy(current).toLowerCase()
  const shown = (past.data ?? []).filter((m) => !q || m.name.toLowerCase().includes(q))
  const typedNew = q && !shown.some((m) => m.name.toLowerCase() === q)
  const pick = (name: string) => {
    onPick(tidy(name))
    onOpenChange(false)
    setText('')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setText('')
      }}
    >
      <DialogContent title={`Swap ${what}`} description={current ? `Instead of ${current}` : undefined}>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (typedNew) pick(text)
            else if (shown.length === 1) pick(shown[0].name)
          }}
        >
          <Input
            aria-label="Find a meal, or type a new one"
            placeholder="Find or type a meal…"
            maxLength={80}
            autoComplete="off"
            enterKeyHint="done"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {typedNew ? <Button type="submit">Use</Button> : null}
        </form>
        {past.isPending ? (
          <ListSkeleton rows={4} />
        ) : shown.length ? (
          <ul className="mt-2 grid">
            {shown.map((m) => {
              const isNow = m.name.toLowerCase() === now
              return (
                <li key={m.name} className="border-t first:border-t-0">
                  <button
                    type="button"
                    disabled={isNow}
                    className="flex w-full items-center gap-2 py-2.5 text-left text-sm hover:bg-muted/50 disabled:opacity-60"
                    onClick={() => pick(m.name)}
                  >
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    {isNow ? <Check className="size-4 text-muted-foreground" aria-label="Planned now" /> : null}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {format(parseISODate(m.last), 'd MMM')}
                      {m.times > 1 ? ` · ${m.times}×` : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">{q ? 'Not had before' : 'Meals you have had show here'}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
