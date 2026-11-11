import { RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, ListSkeleton } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/misc'
import { todayISO } from '@/lib/dates'
import { getErrorMessage } from '@/lib/errors'
import { useUserId } from '@/modules/auth/AuthProvider'
import { type Language, type Progress, useProgress, useReviewAgain, useVocab } from '../api'
import { LANGUAGES } from '../lib/languages'

type List = 'known' | 'wrong'

/** One language: the words you know, or the ones you've got wrong, each with Review again to bring it back today. */
function Words({ language }: { language: Language }) {
  const me = useUserId()
  const progress = useProgress()
  const vocab = useVocab(language)
  const again = useReviewAgain()
  const [list, setList] = useState<List>('known')
  const today = todayISO()

  const lookup = useMemo(() => {
    const m = new Map<string, { reading: string; meaning: string }>()
    for (const v of [...(vocab.data?.words ?? []), ...(vocab.data?.characters ?? [])]) m.set(`${v.kind}|${v.text}`, v)
    return m
  }, [vocab.data])

  if (progress.error ?? vocab.error) return <ErrorState error={progress.error ?? vocab.error} onRetry={() => { void progress.refetch(); void vocab.refetch() }} />
  if (progress.isPending || vocab.isPending) return <ListSkeleton rows={6} />

  const mine = progress.data.filter((p) => p.user_id === me && p.language === language)
  const known = mine.filter((p) => p.lapses === 0).sort((a, b) => b.learned_on.localeCompare(a.learned_on))
  const wrong = mine.filter((p) => p.lapses > 0).sort((a, b) => b.lapses - a.lapses || a.item.localeCompare(b.item))
  const rows = list === 'known' ? known : wrong

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <Segmented
        aria-label="Which words"
        size="sm"
        className="w-full [&>*]:flex-1"
        value={list}
        onChange={(v) => setList(v as List)}
        options={[
          { value: 'known', label: `Known ${known.length}` },
          { value: 'wrong', label: `Got wrong ${wrong.length}` },
        ]}
      />
      {rows.length ? (
        <Card className="divide-y px-3">
          {rows.map((p: Progress) => {
            const v = lookup.get(`${p.kind}|${p.item}`)
            const due = p.due_on <= today
            return (
              <div key={p.id} className="flex items-center gap-3 py-2">
                <span lang={LANGUAGES[language].speech} className="min-w-0 shrink-0 text-lg font-medium">{p.item}</span>
                <span className="min-w-0 flex-1 text-sm">
                  {v?.reading ? <span className="block truncate text-xs text-muted-foreground">{v.reading}</span> : null}
                  <span className="block truncate">{v?.meaning || '—'}</span>
                </span>
                {list === 'wrong' ? <span className="shrink-0 text-xs text-destructive tabular">{p.lapses}×</span> : null}
                <Button
                  size="sm"
                  variant={due ? 'secondary' : 'ghost'}
                  className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
                  disabled={due || again.isPending}
                  aria-label={due ? `${p.item} is in today’s reviews` : `Review ${p.item} again today`}
                  onClick={() => again.mutate(p.id, { onSuccess: () => toast.success(`${p.item} is back in today’s reviews`), onError: (e) => toast.error(getErrorMessage(e)) })}
                >
                  {due ? 'Due' : <><RotateCcw className="size-3.5" /> Again</>}
                </Button>
              </div>
            )
          })}
        </Card>
      ) : (
        <Card className="p-3 text-sm text-muted-foreground">
          {list === 'known' ? 'No words learned yet. Learn some under Details.' : 'Nothing got wrong yet.'}
        </Card>
      )}
    </div>
  )
}

/** The Languages page's first view: Spanish and Mandarin, each with the words you know and the ones you've got wrong. Studying is under Details. */
export function WordLists() {
  const [language, setLanguage] = useState<Language>('es')
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 md:max-w-2xl">
      <Segmented
        aria-label="Language"
        className="w-full [&>*]:flex-1"
        value={language}
        onChange={(v) => setLanguage(v as Language)}
        options={[
          { value: 'es', label: LANGUAGES.es.name },
          { value: 'zh', label: LANGUAGES.zh.name },
        ]}
      />
      <Words key={language} language={language} />
    </div>
  )
}
