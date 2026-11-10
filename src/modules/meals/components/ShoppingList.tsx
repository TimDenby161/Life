import { Plus, ShoppingBasket, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { SectionTitle } from '@/components/PageHeader'
import { EmptyState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/misc'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { AISLES } from '../../../../supabase/functions/_shared/meals.ts'
import { type MakeListResult, type ShoppingItemRow, useAddItem, useDeleteItem, useToggleItem } from '../api'

/**
 * The week's shopping list by aisle. Claude writes it from the meal names
 * (`onMake`); you can tick things off, add your own and remove what you don't need.
 */
export function ShoppingList({
  weekStart,
  items,
  hasMeals,
  stale,
  making,
  notice,
  onMake,
}: {
  weekStart: string
  items: ShoppingItemRow[]
  hasMeals: boolean
  /** The meals have changed since the list was written. */
  stale: boolean
  making: boolean
  /** Why the last attempt made no list. */
  notice: Exclude<MakeListResult, { status: 'ok' }> | null
  onMake: () => void
}) {
  const toggle = useToggleItem(weekStart)
  const add = useAddItem()
  const del = useDeleteItem()
  const [text, setText] = useState('')
  const onError = (e: unknown) => toast.error(getErrorMessage(e))
  const fromClaude = items.some((i) => i.source === 'ai')

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button onClick={onMake} disabled={making || !hasMeals} variant={fromClaude && !stale ? 'outline' : 'default'}>
          <Sparkles /> {making ? 'Writing…' : fromClaude ? 'Rebuild' : 'Make list'}
        </Button>
        <p className="min-w-0 flex-1 text-sm text-muted-foreground" aria-live="polite">
          {making ? 'Claude is writing your list. This takes a few seconds.' : !hasMeals ? 'Add a meal first.' : stale ? 'Meals changed since this list.' : null}
        </p>
      </div>

      {notice && !making ? (
        <Card role="status" className="mt-3 border-warning/40 bg-warning/10 p-3 text-sm">
          {notice.message}
          {notice.status === 'not_configured' ? ' Until it has one you can still plan meals and add items yourself.' : null}
        </Card>
      ) : null}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (!text.trim()) return
          add.mutate({ weekStart, name: text }, { onSuccess: () => setText(''), onError })
        }}
      >
        <Input aria-label="Add an item" placeholder="Add an item" maxLength={80} enterKeyHint="done" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" size="icon" variant="outline" aria-label="Add" disabled={add.isPending || !text.trim()}>
          <Plus />
        </Button>
      </form>

      {!items.length ? (
        <Card className="mt-3">
          <EmptyState icon={ShoppingBasket} title="No list yet" description={hasMeals ? 'Make the list from this week’s meals, or add items yourself.' : 'Plan some meals, then make the list.'} />
        </Card>
      ) : (
        AISLES.map((aisle) => {
          // Ticked items drop to the bottom of their aisle.
          const rows = items.filter((i) => i.aisle === aisle.key).toSorted((a, b) => Number(a.checked) - Number(b.checked))
          if (!rows.length) return null
          return (
            <section key={aisle.key} className="mt-5">
              <SectionTitle>{aisle.label}</SectionTitle>
              <Card className="px-3 py-1">
                <ul className="divide-y">
                  {rows.map((item) => (
                    <li key={item.id} className="flex items-center gap-3 py-1">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1.5">
                        <Checkbox checked={item.checked} onCheckedChange={(c) => toggle.mutate({ id: item.id, checked: c === true }, { onError })} />
                        <span className={cn('min-w-0 flex-1 truncate text-sm', item.checked && 'text-muted-foreground line-through')}>{item.name}</span>
                        {item.quantity ? <span className="shrink-0 text-sm text-muted-foreground tabular-nums">{item.quantity}</span> : null}
                      </label>
                      <Button size="icon-sm" variant="ghost" className="text-muted-foreground" aria-label={`Remove ${item.name}`} onClick={() => del.mutate(item.id, { onError })}>
                        <X />
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )
        })
      )}

      {fromClaude ? <p className="mt-4 text-xs text-muted-foreground">Claude worked this out from the meal names. Check the quantities before you shop.</p> : null}
    </>
  )
}
