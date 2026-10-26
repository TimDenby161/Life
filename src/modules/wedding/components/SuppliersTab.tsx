import { ExternalLink, Mail, Pencil, Phone, Plus, Store, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, Textarea } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/errors'
import { type Supplier, useBudgetItems, useDeleteSupplier, useSaveSupplier, useSuppliers } from '../api'
import { budgetTotals } from '../lib/summary'
import { money } from '../lib/money'

export function SuppliersTab() {
  const suppliers = useSuppliers()
  const budget = useBudgetItems()
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)

  if (suppliers.isPending) return <ListSkeleton rows={3} />
  if (suppliers.error) return <ErrorState error={suppliers.error} onRetry={() => suppliers.refetch()} />

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing('new')}><Plus /> Add supplier</Button>
      </div>
      {!suppliers.data.length ? (
        <Card><EmptyState icon={Store} title="No suppliers yet" description="Keep the venue, caterer, photographer and others here; link budget lines to them to see what you've paid." /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {suppliers.data.map((s) => {
            // What's budgeted and paid on the budget lines linked to this supplier.
            const lines = (budget.data ?? []).filter((b) => b.supplier_id === s.id)
            const t = budgetTotals(lines)
            return (
              <Card key={s.id} className="grid gap-2 p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">{s.role}</p>
                    <p className="truncate font-semibold">{s.name}</p>
                    {s.contact_name ? <p className="truncate text-xs text-muted-foreground">{s.contact_name}</p> : null}
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}><Pencil /></Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {s.phone ? <Button asChild variant="outline" size="sm"><a href={`tel:${s.phone}`}><Phone /> Call</a></Button> : null}
                  {s.email ? <Button asChild variant="outline" size="sm"><a href={`mailto:${s.email}`}><Mail /> Email</a></Button> : null}
                  {s.website ? <Button asChild variant="outline" size="sm"><a href={s.website} target="_blank" rel="noreferrer noopener"><ExternalLink /> Website</a></Button> : null}
                </div>
                {lines.length ? <p className="text-xs text-muted-foreground tabular">{money(t.paid)} paid of {money(t.budget)} budgeted</p> : null}
                {s.notes ? <p className="whitespace-pre-line text-xs text-muted-foreground">{s.notes}</p> : null}
              </Card>
            )
          })}
        </div>
      )}
      {editing ? <SupplierDialog supplier={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  )
}

function SupplierDialog({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const save = useSaveSupplier()
  const del = useDeleteSupplier()
  const [role, setRole] = useState(supplier?.role ?? '')
  const [name, setName] = useState(supplier?.name ?? '')
  const [contact, setContact] = useState(supplier?.contact_name ?? '')
  const [phone, setPhone] = useState(supplier?.phone ?? '')
  const [email, setEmail] = useState(supplier?.email ?? '')
  const [website, setWebsite] = useState(supplier?.website ?? '')
  const [notes, setNotes] = useState(supplier?.notes ?? '')
  const [confirm, setConfirm] = useState(false)
  const opt = (v: string) => v.trim() || null

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent title={supplier ? `Edit ${supplier.name}` : 'Add a supplier'}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!role.trim() || !name.trim()) return
            const site = website.trim() && !/^https?:\/\//i.test(website.trim()) ? `https://${website.trim()}` : opt(website)
            save.mutate(
              { id: supplier?.id, role: role.trim(), name: name.trim(), contact_name: opt(contact), phone: opt(phone), email: opt(email), website: site, notes: opt(notes) },
              { onSuccess: onClose, onError: (err) => toast.error(getErrorMessage(err)) },
            )
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Role" htmlFor="s-role"><Input id="s-role" autoFocus value={role} maxLength={60} placeholder="e.g. Photographer" onChange={(e) => setRole(e.target.value)} required /></Field>
            <Field label="Business" htmlFor="s-name"><Input id="s-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Contact" htmlFor="s-contact"><Input id="s-contact" value={contact} maxLength={120} onChange={(e) => setContact(e.target.value)} /></Field>
            <Field label="Phone" htmlFor="s-phone"><Input id="s-phone" type="tel" value={phone} maxLength={40} onChange={(e) => setPhone(e.target.value)} /></Field>
            <Field label="Email" htmlFor="s-email"><Input id="s-email" type="email" value={email} maxLength={200} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Website" htmlFor="s-web"><Input id="s-web" value={website} maxLength={300} placeholder="example.com" onChange={(e) => setWebsite(e.target.value)} /></Field>
          </div>
          <Field label="Notes" htmlFor="s-notes" hint="Deposits, contract terms, what's included…"><Textarea id="s-notes" rows={3} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></Field>
          <DialogFooter className="sm:justify-between">
            {supplier ? (
              <Button type="button" variant={confirm ? 'destructive' : 'ghost'} onClick={() => (confirm ? del.mutate(supplier.id, { onSuccess: onClose }) : setConfirm(true))}>
                <Trash2 /> {confirm ? 'Delete supplier?' : 'Delete'}
              </Button>
            ) : <span />}
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
