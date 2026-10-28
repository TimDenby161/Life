import { Check, GraduationCap, Repeat, Settings2, Volume2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { EmptyState, ErrorState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Field, Input, NativeSelect } from '@/components/ui/input'
import { Badge, Progress as ProgressBar, Segmented, Skeleton } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useHousehold } from '@/modules/household/HouseholdProvider'
import type { Job, TaskCategory } from '@/modules/tasks/api'
import { useJobs, useTaskCategories } from '@/modules/tasks/hooks'
import {
  type Progress,
  type Study,
  type StudySettings,
  useLearnItem,
  useProgress,
  useReviewItem,
  useSaveStudy,
  useStudy,
  useTickOffJob,
  useVocab,
} from './api'
import { canSpeak, speak } from './lib/speech'
import { dueForReview, type Kind, levelProgress, nextToLearn, remainingToday, type Vocab, type VocabItem } from './lib/vocab'

const LANGUAGE = 'zh'
const KIND_LABEL: Record<Kind, { plural: string; job: keyof StudySettings; perDay: keyof StudySettings }> = {
  word: { plural: 'words', job: 'words_task_id', perDay: 'words_per_day' },
  character: { plural: 'characters', job: 'characters_task_id', perDay: 'characters_per_day' },
}

export default function LanguagesPage() {
  const { me, partner, member } = useHousehold()
  const [personId, setPersonId] = useState(me.id)
  const person = member(personId) ?? me
  const own = personId === me.id
  const vocab = useVocab(LANGUAGE)
  const study = useStudy()
  const progress = useProgress()
  const jobs = useJobs()
  const categories = useTaskCategories()
  const [reviewing, setReviewing] = useState(false)
  const [editing, setEditing] = useState(false)

  const today = todayISO()
  const rows = useMemo(() => (progress.data ?? []).filter((p) => p.user_id === personId && p.language === LANGUAGE), [progress.data, personId])
  const learned = useMemo(
    () => ({
      word: new Set(rows.filter((r) => r.kind === 'word').map((r) => r.item)),
      character: new Set(rows.filter((r) => r.kind === 'character').map((r) => r.item)),
    }),
    [rows],
  )
  const row = study.data?.find((s) => s.user_id === personId && s.language === LANGUAGE)
  const settings = row ?? defaultSettings(jobs.data ?? [], categories.data ?? [], personId)
  const due = dueForReview(rows, today)
  const jobById = (id: string | null) => (id ? jobs.data?.find((j) => j.id === id) : undefined)
  const error = vocab.error ?? study.error ?? progress.error

  return (
    <>
      <PageHeader
        title="Mandarin"
        description="HSK words and characters, a few a day, with reviews spaced out so they stick."
        actions={own ? <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Settings2 /> Settings</Button> : null}
      />
      {partner ? (
        <Segmented aria-label="Person" value={personId} onChange={setPersonId} className="mb-4" options={[{ value: me.id, label: 'Me' }, { value: partner.id, label: partner.display_name }]} />
      ) : null}

      {error ? (
        <ErrorState error={error} onRetry={() => { vocab.refetch(); study.refetch(); progress.refetch() }} />
      ) : !vocab.data || study.isPending || progress.isPending ? (
        <div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : !own && !rows.length ? (
        <Card><EmptyState icon={GraduationCap} title="Not started yet" description={`${person.display_name} hasn't learned any Mandarin here yet.`} /></Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tile label="Words" value={learned.word.size} of={vocab.data.words.length} />
            <Tile label="Characters" value={learned.character.size} of={vocab.data.characters.length} />
            <Tile label="To review" value={due.length} />
          </div>

          {own ? (
            <ReviewSection
              due={due.length}
              hasLearned={rows.length > 0}
              reviewJob={jobById(settings.review_task_id)}
              onStart={() => setReviewing(true)}
            />
          ) : null}

          {(['word', 'character'] as const).map((kind) => (
            <NewItemsSection
              key={kind}
              kind={kind}
              own={own}
              vocab={vocab.data!}
              rows={rows}
              learned={learned[kind]}
              perDay={settings[KIND_LABEL[kind].perDay] as number}
              startLevel={settings.start_level}
              job={jobById(settings[KIND_LABEL[kind].job] as string | null)}
            />
          ))}

          <SectionTitle>HSK levels</SectionTitle>
          <Card className="grid gap-3 p-4">
            {levelProgress(vocab.data.words, learned.word).map((l) => (
              <div key={l.level} className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 text-sm">
                <span className="font-medium">HSK {l.level}</span>
                <ProgressBar value={(l.learned / l.total) * 100} />
                <span className="tabular text-muted-foreground">{l.learned} / {l.total}</span>
              </div>
            ))}
          </Card>
          <p className="mt-4 text-xs text-muted-foreground">
            Word lists: HSK 3.0 (2025 syllabus) from complete-hsk-vocabulary. Definitions from CC-CEDICT (CC BY-SA 4.0).
          </p>
        </>
      )}

      {reviewing && vocab.data ? (
        <ReviewDialog
          rows={due}
          vocab={vocab.data}
          reviewJob={jobById(settings.review_task_id)}
          onClose={() => setReviewing(false)}
        />
      ) : null}
      {editing ? (
        <SettingsDialog
          exists={!!row}
          initial={settings}
          jobs={(jobs.data ?? []).filter((j) => !j.assignee_id || j.assignee_id === me.id)}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
  )
}

/** Before anyone saves settings: 3 words and 2 characters a day from HSK 1, linked to their Mandarin jobs by name. */
function defaultSettings(jobs: Job[], categories: TaskCategory[], personId: string): StudySettings {
  const category = (id: string | null) => categories.find((c) => c.id === id)?.name ?? ''
  const mandarin = jobs.filter(
    (j) => (!j.assignee_id || j.assignee_id === personId) && /mandarin|chinese/i.test(`${j.title} ${category(j.category_id)}`),
  )
  const find = (pattern: RegExp) => mandarin.find((j) => pattern.test(j.title))?.id ?? null
  return {
    words_per_day: 3,
    characters_per_day: 2,
    start_level: 1,
    words_task_id: find(/new .*words?/i),
    characters_task_id: find(/characters?/i),
    review_task_id: find(/review/i),
  }
}

function Tile({ label, value, of }: { label: string; value: number; of?: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular">{value}</p>
      {of ? <p className="text-xs text-muted-foreground tabular">of {of.toLocaleString()}</p> : null}
    </Card>
  )
}

function ReviewSection({ due, hasLearned, reviewJob, onStart }: { due: number; hasLearned: boolean; reviewJob?: Job; onStart: () => void }) {
  const tick = useTickOffJob()
  const jobDue = !!reviewJob?.open[0]?.due_date && reviewJob.open[0].due_date <= todayISO()
  return (
    <>
      <SectionTitle>Review</SectionTitle>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <Repeat className="size-5 text-muted-foreground" />
          <p className="text-sm">
            {due ? `${due} to review today` : hasLearned ? 'Nothing to review today' : 'Reviews start the day after you learn something'}
          </p>
        </div>
        {due ? (
          <Button onClick={onStart}>Start review</Button>
        ) : jobDue && hasLearned ? (
          <Button variant="outline" size="sm" disabled={tick.isPending} onClick={() => tick.mutate(reviewJob)}>
            <Check /> Tick off “{reviewJob!.title}”
          </Button>
        ) : null}
      </Card>
    </>
  )
}

function NewItemsSection({
  kind,
  own,
  vocab,
  rows,
  learned,
  perDay,
  startLevel,
  job,
}: {
  kind: Kind
  own: boolean
  vocab: Vocab
  rows: Progress[]
  learned: ReadonlySet<string>
  perDay: number
  startLevel: number
  job?: Job
}) {
  const learn = useLearnItem()
  const tick = useTickOffJob()
  const [extra, setExtra] = useState(0)
  const today = todayISO()
  const items = kind === 'word' ? vocab.words : vocab.characters
  const byText = useMemo(() => new Map(items.map((i) => [i.text, i])), [items])
  const learnedToday = rows.filter((r) => r.kind === kind && r.learned_on === today)
  const remaining = remainingToday(rows, kind, today, perDay) + extra
  const next = own ? nextToLearn(items, learned, startLevel, remaining) : []
  const { plural } = KIND_LABEL[kind]

  if (!perDay && !learnedToday.length) return null

  function gotIt(item: VocabItem) {
    learn.mutate(
      { language: LANGUAGE, kind, item: item.text },
      {
        onSuccess: () => {
          if (extra) setExtra((e) => e - 1)
          if (learnedToday.length + 1 >= perDay) tick.mutate(job)
        },
      },
    )
  }

  return (
    <>
      <SectionTitle action={<span className="text-xs text-muted-foreground tabular">{learnedToday.length} / {perDay} today</span>}>
        New {plural}
      </SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        {learnedToday.map((r) => (
          <ItemCard key={r.id} item={byText.get(r.item)} text={r.item} vocab={vocab} done />
        ))}
        {next.map((item) => (
          <ItemCard
            key={item.text}
            item={item}
            text={item.text}
            vocab={vocab}
            action={<Button size="sm" disabled={learn.isPending} onClick={() => gotIt(item)}><Check /> Got it</Button>}
          />
        ))}
      </div>
      {own && !next.length ? (
        <div className="mt-2 flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{learnedToday.length ? `Today's ${plural} done.` : `All ${plural} from HSK ${startLevel} up are learned.`}</span>
          {nextToLearn(items, learned, startLevel, 1).length ? (
            <Button variant="ghost" size="sm" onClick={() => setExtra((e) => e + 1)}>Learn one more</Button>
          ) : null}
        </div>
      ) : null}
      {learn.error ? <p className="mt-2 text-sm text-destructive">{getErrorMessage(learn.error)}</p> : null}
    </>
  )
}

function ItemCard({ item, text, vocab, done, action }: { item?: VocabItem; text: string; vocab: Vocab; done?: boolean; action?: React.ReactNode }) {
  return (
    <Card className={cn('flex items-start gap-4 p-4', done && 'opacity-70')}>
      <span lang="zh-CN" className="min-w-14 text-center text-4xl leading-tight">{text}</span>
      <div className="min-w-0 flex-1">
        {item ? <ItemDetails item={item} vocab={vocab} /> : <p className="text-sm text-muted-foreground">No longer in the word list</p>}
      </div>
      {done ? <Check className="mt-1 size-5 shrink-0 text-success" aria-label="Learned today" /> : action}
    </Card>
  )
}

function ItemDetails({ item, vocab }: { item: VocabItem; vocab: Vocab }) {
  const words = useMemo(() => new Map(vocab.words.map((w) => [w.text, w])), [vocab])
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{item.pinyin}</p>
        <SpeakButton text={item.text} />
        <Badge>HSK {item.level}</Badge>
      </div>
      {item.meaning ? <p className="text-sm text-muted-foreground">{item.meaning}</p> : null}
      {item.examples.length ? (
        <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
          {item.examples.map((w) => (
            <li key={w}>
              <span lang="zh-CN" className="text-sm text-foreground">{w}</span> {words.get(w)?.pinyin} · {words.get(w)?.meaning}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function SpeakButton({ text }: { text: string }) {
  if (!canSpeak()) return null
  return (
    <Button variant="ghost" size="icon-sm" className="-my-1" aria-label="Listen" onClick={() => speak(text)}>
      <Volume2 />
    </Button>
  )
}

function ReviewDialog({ rows, vocab, reviewJob, onClose }: { rows: Progress[]; vocab: Vocab; reviewJob?: Job; onClose: () => void }) {
  const review = useReviewItem()
  const tick = useTickOffJob()
  // The queue is fixed when the session starts; answers update the schedule as you go.
  const [queue] = useState(rows)
  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState(false)
  const [knew, setKnew] = useState(0)
  const lookup = useMemo(() => {
    const all = new Map<string, VocabItem>()
    for (const i of vocab.words) all.set(`word:${i.text}`, i)
    for (const i of vocab.characters) all.set(`character:${i.text}`, i)
    return all
  }, [vocab])
  const current = queue[index]
  const item = current ? lookup.get(`${current.kind}:${current.item}`) : undefined

  function answer(remembered: boolean) {
    review.mutate({ row: current, remembered })
    if (remembered) setKnew((k) => k + 1)
    setShown(false)
    setIndex((i) => i + 1)
    if (index + 1 === queue.length) tick.mutate(reviewJob)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Review" className="sm:max-w-md">
        {current ? (
          <div className="grid gap-4">
            <p className="text-xs text-muted-foreground tabular">{index + 1} of {queue.length} · {current.kind}</p>
            <p lang="zh-CN" className="py-4 text-center text-6xl">{current.item}</p>
            {shown ? (
              <>
                <div className="min-h-16">{item ? <ItemDetails item={item} vocab={vocab} /> : null}</div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => answer(false)}>Forgot</Button>
                  <Button onClick={() => answer(true)}>Knew it</Button>
                </DialogFooter>
              </>
            ) : (
              <DialogFooter>
                <Button className="w-full" onClick={() => setShown(true)}>Show answer</Button>
              </DialogFooter>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-sm">Done: you knew {knew} of {queue.length}. Forgotten ones come back tomorrow.</p>
            {review.error ? <p className="text-sm text-destructive">{getErrorMessage(review.error)}</p> : null}
            <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function SettingsDialog({ exists, initial, jobs, onClose }: { exists: boolean; initial: StudySettings | Study; jobs: Job[]; onClose: () => void }) {
  const save = useSaveStudy()
  const [values, setValues] = useState<StudySettings>({
    words_per_day: initial.words_per_day,
    characters_per_day: initial.characters_per_day,
    start_level: initial.start_level,
    words_task_id: initial.words_task_id,
    characters_task_id: initial.characters_task_id,
    review_task_id: initial.review_task_id,
  })
  const set = <K extends keyof StudySettings>(key: K, value: StudySettings[K]) => setValues((v) => ({ ...v, [key]: value }))
  const count = (value: string) => Math.max(0, Math.min(50, Math.trunc(Number(value) || 0)))
  const jobSelect = (key: 'words_task_id' | 'characters_task_id' | 'review_task_id', label: string) => (
    <Field label={label} htmlFor={key}>
      <NativeSelect id={key} value={values[key] ?? ''} onChange={(e) => set(key, e.target.value || null)}>
        <option value="">None</option>
        {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
      </NativeSelect>
    </Field>
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Mandarin settings" className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate({ language: LANGUAGE, exists, settings: values }, { onSuccess: onClose })
          }}
        >
          <div className="grid grid-cols-3 gap-3">
            <Field label="Words a day" htmlFor="words-per-day">
              <Input id="words-per-day" type="number" inputMode="numeric" min={0} max={50} value={values.words_per_day} onChange={(e) => set('words_per_day', count(e.target.value))} />
            </Field>
            <Field label="Characters a day" htmlFor="chars-per-day">
              <Input id="chars-per-day" type="number" inputMode="numeric" min={0} max={50} value={values.characters_per_day} onChange={(e) => set('characters_per_day', count(e.target.value))} />
            </Field>
            <Field label="Start at" htmlFor="start-level">
              <NativeSelect id="start-level" value={values.start_level} onChange={(e) => set('start_level', Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6].map((l) => <option key={l} value={l}>HSK {l}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">Finishing each part ticks off the job linked to it.</p>
          {jobSelect('words_task_id', 'New words job')}
          {jobSelect('characters_task_id', 'New characters job')}
          {jobSelect('review_task_id', 'Review job')}
          {save.error ? <p className="text-sm text-destructive">{getErrorMessage(save.error)}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
