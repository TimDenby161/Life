import { Check, GraduationCap, Plus, Repeat, Settings2, Volume2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
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
import type { TaskCategory } from '@/modules/tasks/api'
import { useOpenOccurrences, useTaskCategories } from '@/modules/tasks/hooks'
import {
  type Progress,
  type Study,
  type StudySettings,
  type StudyTask,
  studyTasks,
  useLearnItem,
  useProgress,
  useReviewItem,
  useSaveStudy,
  useSetStudying,
  useStudy,
  useTickOffJob,
  useVocab,
} from './api'
import { isLanguage, type Language, LANGUAGE_IDS, LANGUAGES, type LanguageConfig, studyPartOf } from './lib/languages'
import { canSpeak, speak } from './lib/speech'
import { dueForReview, type Kind, levelProgress, nextToLearn, remainingToday, type Vocab, type VocabItem } from './lib/vocab'

const KIND: Record<Kind, { plural: string; job: 'words_task_id' | 'characters_task_id'; perDay: 'words_per_day' | 'characters_per_day' }> = {
  word: { plural: 'words', job: 'words_task_id', perDay: 'words_per_day' },
  character: { plural: 'characters', job: 'characters_task_id', perDay: 'characters_per_day' },
}

export default function LanguagesPage() {
  const { me, partner, member } = useHousehold()
  const [params, setParams] = useSearchParams()
  // Arriving from a task (?person=…&part=…) opens that person's study at that part.
  const [personId, setPersonId] = useState(() => member(params.get('person'))?.id ?? me.id)
  const person = member(personId) ?? me
  const own = personId === me.id
  const study = useStudy()
  const progress = useProgress()
  const openOccurrences = useOpenOccurrences()
  const tasks = useMemo(() => studyTasks(openOccurrences.data ?? []), [openOccurrences.data])
  const categories = useTaskCategories()
  const setStudying = useSetStudying()
  const [reviewing, setReviewing] = useState(false)
  const [editing, setEditing] = useState(false)

  // Each person sees only the languages they learn (Tim: both; Sophie: Spanish).
  const learning = languagesOf(personId, study.data ?? [], tasks)
  const myLanguages = languagesOf(me.id, study.data ?? [], tasks)
  const fromUrl = params.get('lang')
  const language: Language = isLanguage(fromUrl) && learning.includes(fromUrl) ? fromUrl : (learning[0] ?? 'zh')
  const config = LANGUAGES[language]
  const vocab = useVocab(language)
  const notLearning = !learning.length

  const today = todayISO()
  const rows = useMemo(
    () => (progress.data ?? []).filter((p) => p.user_id === personId && p.language === language),
    [progress.data, personId, language],
  )
  const learned = useMemo(
    () => ({
      word: new Set(rows.filter((r) => r.kind === 'word').map((r) => r.item)),
      character: new Set(rows.filter((r) => r.kind === 'character').map((r) => r.item)),
    }),
    [rows],
  )
  const row = study.data?.find((s) => s.user_id === personId && s.language === language)
  const settings = withDefaultTasks(row, defaultSettings(config, tasks, categories.data ?? [], personId))
  const settingsFor = (l: Language) =>
    withDefaultTasks(study.data?.find((s) => s.user_id === me.id && s.language === l), defaultSettings(LANGUAGES[l], tasks, categories.data ?? [], me.id))

  // Saving every language the person learns makes the choice explicit, so a
  // guessed list (no rows yet) doesn't change when one is added or stopped.
  function changeLanguage(target: Language, active: boolean) {
    const changes = LANGUAGE_IDS.flatMap((l) => {
      const want = l === target ? active : myLanguages.includes(l)
      const existing = study.data?.find((s) => s.user_id === me.id && s.language === l)
      if (existing ? existing.active === want : !want) return []
      return [{ language: l, active: want, exists: !!existing, settings: settingsFor(l) }]
    })
    setStudying.mutate(changes, {
      onSuccess: () => {
        setEditing(false)
        setParams(active ? { lang: target } : {}, { replace: true })
      },
    })
  }
  const addable = LANGUAGE_IDS.filter((l) => !myLanguages.includes(l))
  const due = dueForReview(rows, today)
  const jobById = (id: string | null) => (id ? tasks.find((t) => t.id === id) : undefined)
  const error = vocab.error ?? study.error ?? progress.error
  const kinds: Kind[] = config.hasCharacters ? ['word', 'character'] : ['word']

  // Straight to the part the task was for: the review starts, words scroll into view.
  const part = params.get('part')
  const ready = Boolean(vocab.data && study.data && progress.data)
  useEffect(() => {
    if (!part || !ready) return
    if (part === 'review' && own && due.length) setReviewing(true)
    else document.getElementById(`study-${part}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setParams((p) => { p.delete('part'); return p }, { replace: true })
  }, [part, ready]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        title={notLearning ? 'Languages' : config.name}
        description={notLearning ? 'Words a day, with reviews spaced out so they stick.' : config.description}
        actions={own && !notLearning ? <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Settings2 /> Settings</Button> : null}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {learning.length > 1 ? (
          <Segmented
            aria-label="Language"
            value={language}
            onChange={(l) => setParams({ lang: l }, { replace: true })}
            options={learning.map((l) => ({ value: l, label: LANGUAGES[l].name }))}
          />
        ) : null}
        {partner ? (
          <Segmented aria-label="Person" value={personId} onChange={setPersonId} options={[{ value: me.id, label: 'Me' }, { value: partner.id, label: partner.display_name }]} />
        ) : null}
        {own && !notLearning
          ? addable.map((l) => (
              <Button key={l} variant="ghost" size="sm" disabled={setStudying.isPending} onClick={() => changeLanguage(l, true)}>
                <Plus /> Learn {LANGUAGES[l].name}
              </Button>
            ))
          : null}
      </div>

      {notLearning ? (
        <Card>
          <EmptyState
            icon={GraduationCap}
            title={own ? "You're not learning a language here" : `${person.display_name} isn't learning a language here`}
            action={own ? (
              <div className="flex flex-wrap justify-center gap-2">
                {LANGUAGE_IDS.map((l) => (
                  <Button key={l} disabled={setStudying.isPending} onClick={() => changeLanguage(l, true)}><Plus /> Learn {LANGUAGES[l].name}</Button>
                ))}
              </div>
            ) : undefined}
          />
        </Card>
      ) : error ? (
        <ErrorState error={error} onRetry={() => { vocab.refetch(); study.refetch(); progress.refetch() }} />
      ) : !vocab.data || study.isPending || progress.isPending ? (
        <div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : !own && !rows.length ? (
        <Card><EmptyState icon={GraduationCap} title="Not started yet" description={`${person.display_name} hasn't learned any ${config.name} here yet.`} /></Card>
      ) : (
        <>
          <div className={cn('grid gap-3', config.hasCharacters ? 'grid-cols-3' : 'grid-cols-2')}>
            <Tile label="Words" value={learned.word.size} of={vocab.data.words.length} />
            {config.hasCharacters ? <Tile label="Characters" value={learned.character.size} of={vocab.data.characters.length} /> : null}
            <Tile label="To review" value={due.length} />
          </div>

          {own ? (
            <ReviewSection due={due.length} hasLearned={rows.length > 0} reviewJob={jobById(settings.review_task_id)} onStart={() => setReviewing(true)} />
          ) : null}

          {kinds.map((kind) => (
            <NewItemsSection
              key={`${language}-${kind}`}
              language={language}
              kind={kind}
              own={own}
              vocab={vocab.data!}
              rows={rows}
              learned={learned[kind]}
              perDay={settings[KIND[kind].perDay]}
              startLevel={settings.start_level}
              job={jobById(settings[KIND[kind].job])}
            />
          ))}

          <SectionTitle>{config.levelsTitle}</SectionTitle>
          <Card className="grid gap-3 p-4">
            {levelProgress(vocab.data.words, learned.word).map((l) => (
              <div key={l.level} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-sm">
                <span className="font-medium">{config.levelLabel(l.level)}</span>
                <ProgressBar value={(l.learned / l.total) * 100} />
                <span className="tabular text-muted-foreground">{l.learned} / {l.total}</span>
              </div>
            ))}
          </Card>
          <p className="mt-4 text-xs text-muted-foreground">{config.credit}</p>
        </>
      )}

      {reviewing && vocab.data ? (
        <ReviewDialog language={language} rows={due} vocab={vocab.data} reviewJob={jobById(settings.review_task_id)} onClose={() => setReviewing(false)} />
      ) : null}
      {editing ? (
        <SettingsDialog
          key={language}
          language={language}
          exists={!!row}
          initial={settings}
          jobs={tasks.filter((t) => !t.assignee_id || t.assignee_id === me.id)}
          stopping={setStudying.isPending}
          onStop={() => changeLanguage(language, false)}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </>
  )
}

/**
 * The languages someone learns: their active settings rows. Before they have
 * any, the languages their jobs mention, or all of them to choose from.
 */
function languagesOf(personId: string, study: Study[], jobs: StudyTask[]): Language[] {
  const rows = study.filter((s) => s.user_id === personId)
  if (rows.length) return LANGUAGE_IDS.filter((l) => rows.some((s) => s.language === l && s.active))
  const mine = jobs.filter((j) => j.assignee_id === personId)
  const guessed = LANGUAGE_IDS.filter((l) => mine.some((j) => LANGUAGES[l].jobPattern.test(j.title)))
  return guessed.length ? guessed : LANGUAGE_IDS
}

/** Before anyone saves settings: the language's daily amounts from the start, linked to their tasks by name. */
function defaultSettings(config: LanguageConfig, tasks: StudyTask[], categories: TaskCategory[], personId: string): StudySettings {
  const category = (id: string | null) => categories.find((c) => c.id === id)?.name ?? ''
  const mine = tasks.filter((t) => !t.assignee_id || t.assignee_id === personId)
  // Someone's own task beats a shared one.
  mine.sort((a, b) => Number(!a.assignee_id) - Number(!b.assignee_id))
  const find = (part: string) =>
    mine.find((t) => {
      const found = studyPartOf(t.title, category(t.category_id))
      return found?.part === part && LANGUAGES[found.language] === config
    })?.id ?? null
  return {
    ...config.defaults,
    start_level: 1,
    words_task_id: find('word'),
    characters_task_id: config.hasCharacters ? find('character') : null,
    review_task_id: find('review'),
  }
}

/** Saved settings, with any part left unlinked linked to the task its name matches. */
function withDefaultTasks(row: Study | undefined, defaults: StudySettings): StudySettings | Study {
  if (!row) return defaults
  return {
    ...row,
    words_task_id: row.words_task_id ?? defaults.words_task_id,
    characters_task_id: row.characters_task_id ?? defaults.characters_task_id,
    review_task_id: row.review_task_id ?? defaults.review_task_id,
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

function ReviewSection({ due, hasLearned, reviewJob, onStart }: { due: number; hasLearned: boolean; reviewJob?: StudyTask; onStart: () => void }) {
  const tick = useTickOffJob()
  const jobDue = !!reviewJob?.open[0]?.due_date && reviewJob.open[0].due_date <= todayISO()
  return (
    <div id="study-review" className="scroll-mt-20">
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
    </div>
  )
}

function NewItemsSection({
  language,
  kind,
  own,
  vocab,
  rows,
  learned,
  perDay,
  startLevel,
  job,
}: {
  language: Language
  kind: Kind
  own: boolean
  vocab: Vocab
  rows: Progress[]
  learned: ReadonlySet<string>
  perDay: number
  startLevel: number
  job?: StudyTask
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
  const { plural } = KIND[kind]
  const config = LANGUAGES[language]

  if (!perDay && !learnedToday.length && !extra) return null

  function gotIt(item: VocabItem) {
    learn.mutate(
      { language, kind, item: item.text },
      {
        onSuccess: () => {
          if (extra) setExtra((e) => e - 1)
          if (learnedToday.length + 1 >= perDay) tick.mutate(job)
        },
      },
    )
  }

  return (
    <div id={`study-${kind}`} className="scroll-mt-20">
      <SectionTitle action={<span className="text-xs text-muted-foreground tabular">{learnedToday.length} / {perDay} today</span>}>
        New {plural}
      </SectionTitle>
      <div className="grid gap-3 lg:grid-cols-2">
        {learnedToday.map((r) => (
          <ItemCard key={r.id} language={language} item={byText.get(r.item)} text={r.item} vocab={vocab} done />
        ))}
        {next.map((item) => (
          <ItemCard
            key={item.text}
            language={language}
            item={item}
            text={item.text}
            vocab={vocab}
            action={<Button size="sm" disabled={learn.isPending} onClick={() => gotIt(item)}><Check /> Got it</Button>}
          />
        ))}
      </div>
      {own && !next.length ? (
        <div className="mt-2 flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>{learnedToday.length ? `Today's ${plural} done.` : `All ${plural} from ${config.levelLabel(startLevel)} up are learned.`}</span>
          {nextToLearn(items, learned, startLevel, 1).length ? (
            <Button variant="ghost" size="sm" onClick={() => setExtra((e) => e + 1)}>Learn one more</Button>
          ) : null}
        </div>
      ) : null}
      {learn.error ? <p className="mt-2 text-sm text-destructive">{getErrorMessage(learn.error)}</p> : null}
    </div>
  )
}

function ItemCard({ language, item, text, vocab, done, action }: { language: Language; item?: VocabItem; text: string; vocab: Vocab; done?: boolean; action?: React.ReactNode }) {
  const config = LANGUAGES[language]
  return (
    <Card className={cn('flex items-start gap-4 p-4', done && 'opacity-70')}>
      <span lang={config.speech} className={cn('min-w-14 break-words text-center leading-tight', config.big, !config.hasCharacters && 'max-w-[40%] text-left')}>{text}</span>
      <div className="min-w-0 flex-1">
        {item ? <ItemDetails language={language} item={item} vocab={vocab} /> : <p className="text-sm text-muted-foreground">No longer in the word list</p>}
      </div>
      {done ? <Check className="mt-1 size-5 shrink-0 text-success" aria-label="Learned today" /> : action}
    </Card>
  )
}

function ItemDetails({ language, item, vocab }: { language: Language; item: VocabItem; vocab: Vocab }) {
  const config = LANGUAGES[language]
  const words = useMemo(() => new Map(vocab.words.map((w) => [w.text, w])), [vocab])
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{item.reading}</p>
        <SpeakButton text={item.text} lang={config.speech} />
        <Badge>{config.levelLabel(item.level)}</Badge>
      </div>
      {item.meaning ? <p className="text-sm text-muted-foreground">{item.meaning}</p> : null}
      {item.examples.length ? (
        <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">
          {item.examples.map((w) => (
            <li key={w}>
              <span lang={config.speech} className="text-sm text-foreground">{w}</span> {words.get(w)?.reading} · {words.get(w)?.meaning}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function SpeakButton({ text, lang }: { text: string; lang: string }) {
  if (!canSpeak()) return null
  return (
    <Button variant="ghost" size="icon-sm" className="-my-1" aria-label="Listen" onClick={() => speak(text, lang)}>
      <Volume2 />
    </Button>
  )
}

function ReviewDialog({ language, rows, vocab, reviewJob, onClose }: { language: Language; rows: Progress[]; vocab: Vocab; reviewJob?: StudyTask; onClose: () => void }) {
  const review = useReviewItem()
  const tick = useTickOffJob()
  const config = LANGUAGES[language]
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
            <p lang={config.speech} className={cn('break-words py-4 text-center', config.hasCharacters ? 'text-6xl' : 'text-4xl font-medium')}>{current.item}</p>
            {shown ? (
              <>
                <div className="min-h-16">{item ? <ItemDetails language={language} item={item} vocab={vocab} /> : null}</div>
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

function SettingsDialog({
  language,
  exists,
  initial,
  jobs,
  stopping,
  onStop,
  onClose,
}: {
  language: Language
  exists: boolean
  initial: StudySettings | Study
  jobs: StudyTask[]
  stopping: boolean
  onStop: () => void
  onClose: () => void
}) {
  const save = useSaveStudy()
  const config = LANGUAGES[language]
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
      <DialogContent title={`${config.name} settings`} className="sm:max-w-lg">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate({ language, exists, settings: values }, { onSuccess: onClose })
          }}
        >
          <div className={cn('grid gap-3', config.hasCharacters ? 'grid-cols-3' : 'grid-cols-2')}>
            <Field label="Words a day" htmlFor="words-per-day">
              <Input id="words-per-day" type="number" inputMode="numeric" min={0} max={50} value={values.words_per_day} onChange={(e) => set('words_per_day', count(e.target.value))} />
            </Field>
            {config.hasCharacters ? (
              <Field label="Characters a day" htmlFor="chars-per-day">
                <Input id="chars-per-day" type="number" inputMode="numeric" min={0} max={50} value={values.characters_per_day} onChange={(e) => set('characters_per_day', count(e.target.value))} />
              </Field>
            ) : null}
            <Field label="Start at" htmlFor="start-level">
              <NativeSelect id="start-level" value={values.start_level} onChange={(e) => set('start_level', Number(e.target.value))}>
                {config.levels.map((l) => <option key={l} value={l}>{config.levelLabel(l)}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">Finishing each part ticks off the job linked to it.</p>
          {jobSelect('words_task_id', 'New words job')}
          {config.hasCharacters ? jobSelect('characters_task_id', 'New characters job') : null}
          {jobSelect('review_task_id', 'Review job')}
          {save.error ? <p className="text-sm text-destructive">{getErrorMessage(save.error)}</p> : null}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="ghost" className="text-destructive" disabled={stopping} onClick={onStop}>Stop learning {config.name}</Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>Save</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
