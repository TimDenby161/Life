import { useState } from 'react'
import { useNavigate } from 'react-router'
import { WeighInDialog } from '@/modules/health/components/WeighInDialog'
import { isWeighIn } from '@/modules/health/lib/metrics'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import { studyLinkFor, useStudy } from '@/modules/languages/api'
import type { OccurrenceWithTask, TaskCategory, TaskList } from '../api'
import { ownerOf } from '../lib/owner'

/**
 * What tapping a task does: a language task opens its study, my (or a joint)
 * weigh-in asks for my weight, anything else opens the task via openDetail.
 * Render `dialogs` once on the page.
 */
export function useTaskOpener(categories: TaskCategory[], lists: TaskList[], openDetail: (taskId: string) => void) {
  const { me } = useHousehold()
  const study = useStudy().data ?? []
  const navigate = useNavigate()
  const [weighIn, setWeighIn] = useState<{ id: string; title: string } | null>(null)

  const open = (o: OccurrenceWithTask) => {
    const link = studyLinkFor({ ...o.task, id: o.task_id }, o.assignee_id, study, categories)
    if (link) return navigate(link)
    const owner = ownerOf(o.task, categories, lists)
    if (isWeighIn(o.task.title) && (owner ?? me.id) === me.id) return setWeighIn({ id: o.id, title: o.task.title })
    openDetail(o.task_id)
  }

  return { open, dialogs: <WeighInDialog occurrence={weighIn} onClose={() => setWeighIn(null)} /> }
}
