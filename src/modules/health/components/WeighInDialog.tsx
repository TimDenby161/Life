import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/errors'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { useCompleteOccurrence } from '@/modules/tasks/hooks'
import { useAddMeasurement, useMetricDefinitions } from '../api'

/**
 * A weigh-in task: enter your weight, and saving logs it to Health and marks
 * the task done by you. Health is owner-only, so this is always your weight.
 */
export function WeighInDialog({ occurrence, onClose }: { occurrence: { id: string; title: string } | null; onClose: () => void }) {
  const { me } = useHousehold()
  const weight = useMetricDefinitions().data?.find((d) => d.key === 'weight' && d.owner_id === null)
  const add = useAddMeasurement()
  const complete = useCompleteOccurrence()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    setValue('')
    setError(null)
    add.reset()
    onClose()
  }

  return (
    <Dialog open={Boolean(occurrence)} onOpenChange={(o) => !o && close()}>
      <DialogContent title={occurrence?.title ?? 'Weigh in'} description="Your weight is saved to Health and the task is ticked off.">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(value.replace(',', '.'))
            if (!value.trim() || !Number.isFinite(n) || n <= 0 || n > 500) return setError('Enter your weight in kg')
            if (!weight || !occurrence) return
            add.mutate(
              { metric_id: weight.id, value: n, measured_at: new Date().toISOString() },
              {
                onSuccess: () => {
                  complete.mutate({ occurrenceId: occurrence.id, completedBy: me.id })
                  close()
                },
              },
            )
          }}
        >
          <Field label={`Weight (${weight?.unit ?? 'kg'})`} htmlFor="weigh-in-value" error={error ?? (add.error ? getErrorMessage(add.error) : null)}>
            <Input
              id="weigh-in-value"
              inputMode="decimal"
              autoFocus
              placeholder="e.g. 82.4"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setError(null)
              }}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={!weight || add.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
