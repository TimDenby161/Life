import { ListPlus, Pencil, Plus, Receipt, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Progress } from '@/components/ui/misc'
import { formatDay } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { parseMoney, toMoneyInput } from '@/lib/money'
import { cn } from '@/lib/utils'
import { MoneyInput } from '@/modules/finances/components/forms'
import { type BudgetItem, useAddBudgetItems, useBudgetItems, useDeleteBudgetItem, useSaveBudgetItem, useSuppliers } from '../api'
import { budgetTotals, byCategory } from '../lib/summary'
import { money } from '../lib/money'
import { missingStarterLines, STARTER_NOTE } from '../lib/starterBudget'

export const BUDGET_CATEGORIES = ['Venue', 'Food & drink', 'Photography & video', 'Attire & beauty', 'Flowers & decor', 'Music & entertainment', 'Stationery', 'Rings', 'Transport', 'Honeymoon', 'Other']

export function BudgetTab() {
  const items = useBudgetItems()
  const suppliers = useSuppliers()
  const addMany = useAddBudgetItems()
  const [editing, setEditing] = useState<BudgetItem | 'new' | null>(null)

  if (items.isPending) return <ListSkeleton rows={4} />
  if (items.error) return <ErrorState error={items.error} onRetry={() => items.refetch()} />
  const totals = budgetTotals(items.data)
  const supplierName = (id: string | null) => suppliers.data?.find((s) => s.id === id)?.name
  const missing = missingStarterLines(items.data)
  const addTypical = () =>
    addMany.mutate(missing.map((l) => ({ category: l.category, name: l.name, budget_minor: l.pounds * 100, notes: STARTER_NOTE })), {
      onSuccess: () => toast.success(`Added ${missing.length} typical costs`),
      onError: (err) => toast.error(getErrorMessage(err)),
    })

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground tabular">
          {items.data.length ? `${money(totals.budget)} budgeted · ${money(totals.paid)} paid · ${money(totals.remaining)} to pay` : 'The budget total sets the Wedding pot’s target.'}
        </p>
        <div className="flex shrink-0 gap-2">
          {items.data.length && missing.length ? <Button variant="ghost" size="sm" disabled={addMany.isPending} onClick={addTypical}><ListPlus /> Add typical costs</Button> : null}
          <Button variant="outline" size="sm" onClick={() => setEditing('new')}><Plus /> Add line</Button>
        </div>
      </div>
      {!items.data.length ? (
        <Card>
          <EmptyState
            icon={Receipt}
            title="No budget yet"
            description="Add a line for each cost, or start from typical costs for a North of England wedding (rough estimates to replace with quotes). Until then the pot keeps its £20k placeholder."
            action={<Button variant="outline" disabled={addMany.isPending} onClick={addTypical}><ListPlus /> Add typical costs</Button>}
          />
        </Card>
      ) : (
        byCategory(items.data).map((group) => (
          <Card key={group.category} className="overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2 text-sm">
              <span className="font-semibold">{group.category}</span>
              <span className="tabular text-muted-foreground">{money(group.totals.paid)} / {money(group.totals.budget)}</span>
            </div>
            <ul className="divide-y">
              {group.items.map((i) => {
                const pct = i.budget_minor ? Math.min(100, Math.round((i.paid_minor / i.budget_minor) * 100)) : 0
                return (
                  <li key={i.id} className="group grid gap-1.5 px-4 py-2.5">
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{i.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[supplierName(i.supplier_id), i.due_date && `due ${formatDay(i.due_date)}`, i.notes].filter(Boolean).join(' · ') || ' '}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        <p className="text-right tabular">
                          <span className="font-medium">{money(i.budget_minor)}</span>
                          <span className={cn('block text-xs', i.paid_minor >= i.budget_minor && i.budget_minor ? 'text-success' : 'text-muted-foreground')}>
                            {i.paid_minor >= i.budget_minor && i.budget_minor ? 'Paid' : `${money(i.paid_minor)} paid`}
                          </span>
                        </p>
                        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${i.name}`} onClick={() => setEditing(i)}><Pencil /></Button>
                      </div>
                    </div>
                    <Progress value={pct} className="h-1" indicatorClassName={pct >= 100 ? 'bg-success' : undefined} />
                  </li>
                )
              })}
            </ul>
          </Card>
        ))
      )}
      {editing ? <BudgetItemDialog item={editing === 'new' ? undefined : editing} categories={[...new Set([...BUDGET_CATEGORIES, ...items.data.map((i) => i.category)])]} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function BudgetItemDialog({ item, categories, onClose }: { item?: BudgetItem; categories: string[]; onClose: () => void }) {
  const suppliers = useSuppliers()
  const save = useSaveBudgetItem()
  const del = useDeleteBudgetItem()
  const [category, setCategory] = useState(item?.category ?? 'Venue')
  const [name, setName] = useState(item?.name ?? '')
  const [budget, setBudget] = useState(item ? toMoneyInput(item.budget_minor) : '')
  const [paid, setPaid] = useState(item ? toMoneyInput(item.paid_minor) : '')
  const [due, setDue] = useState(item?.due_date ?? '')
  const [supplierId, setSupplierId] = useState(item?.supplier_id ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={item ? `Edit ${item.name}` : 'Add a budget line'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const b = budget.trim() ? parseMoney(budget) : 0
            const p = paid.trim() ? parseMoney(paid) : 0
            if (!name.trim()) return setError('Give it a name')
            if (b === null || b < 0) return setError('Budget isn’t a valid amount')
            if (p === null || p < 0) return setError('Paid isn’t a valid amount')
            save.mutate(
              { id: item?.id, category, name: name.trim(), budget_minor: b, paid_minor: p, due_date: due || null, supplier_id: supplierId || null, notes: notes.trim() || null },
              { onSuccess: onClose, onError: (err) => toast.error(getErrorMessage(err)) },
            )
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="b-cat">
              <NativeSelect id="b-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </NativeSelect>
            </Field>
            <Field label="What" htmlFor="b-name" error={error}>
              <Input id="b-name" autoFocus value={name} maxLength={120} placeholder="e.g. Venue hire" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Budget" htmlFor="b-budget"><MoneyInput id="b-budget" value={budget} onChange={setBudget} /></Field>
            <Field label="Paid so far" htmlFor="b-paid"><MoneyInput id="b-paid" value={paid} onChange={setPaid} /></Field>
            <Field label="Due (optional)" htmlFor="b-due"><Input id="b-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Supplier (optional)" htmlFor="b-sup">
              <NativeSelect id="b-sup" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">None</option>
                {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.role} · {s.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Notes" htmlFor="b-notes"><Textarea id="b-notes" rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></Field>
          <DialogFooter className="sm:justify-between">
            {item ? (
              <Button type="button" variant={confirm ? 'destructive' : 'ghost'} onClick={() => (confirm ? del.mutate(item.id, { onSuccess: onClose }) : setConfirm(true))}>
                <Trash2 /> {confirm ? 'Delete this line?' : 'Delete'}
              </Button>
            ) : <span />}
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
