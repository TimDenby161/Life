// Briefing notifications. Off unless the VAPID secrets are set and the person
// has turned "Morning notification" on; then the headline (counts only) goes to
// each device they allowed. A failure here never fails the briefing run.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { briefingMessage, type PushMessage, type PushTarget, sendPush, type Vapid } from '../_shared/push.ts'
import type { BriefingDraft } from '../_shared/agents/types.ts'

export function vapidFromEnv(): Vapid | null {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT')
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null
}

type Device = PushTarget & { id: string; user_id: string }

async function devices(db: SupabaseClient, householdId: string, userIds: string[]): Promise<Device[]> {
  if (!userIds.length) return []
  const res = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth').eq('household_id', householdId).in('user_id', userIds)
  if (res.error) throw new Error(res.error.message)
  return res.data as Device[]
}

/** Sends each message to its person's devices; forgets devices the push service says are gone. Returns how many arrived. */
async function deliver(db: SupabaseClient, householdId: string, vapid: Vapid, messages: Map<string, PushMessage>, now: Date) {
  const targets = await devices(db, householdId, [...messages.keys()])
  const results = await Promise.all(targets.map((d) => sendPush(d, messages.get(d.user_id)!, vapid, now).catch(() => ({ ok: false, gone: false, status: 0 }))))
  const gone = targets.filter((_, i) => results[i].gone).map((d) => d.id)
  if (gone.length) await db.rpc('push_subscriptions_gone', { p_household_id: householdId, p_ids: gone })
  const failed = results.filter((r) => !r.ok && !r.gone)
  if (failed.length) console.warn(`agents: ${failed.length} notification(s) refused (${failed.map((r) => r.status).join(', ')})`)
  return results.filter((r) => r.ok).length
}

export async function notifyBriefings(db: SupabaseClient, householdId: string, briefings: BriefingDraft[], wantsPush: Set<string>, now: Date) {
  const vapid = vapidFromEnv()
  if (!vapid) return
  const messages = new Map(
    briefings.filter((b) => wantsPush.has(b.recipient_id)).map((b) => [b.recipient_id, briefingMessage(b.kind, (b.content as { headline: string }).headline)]),
  )
  if (messages.size) await deliver(db, householdId, vapid, messages, now)
}

/** "Send a test" from the AI Hub: only to the caller's own devices. */
export async function notifyTest(db: SupabaseClient, householdId: string, userId: string, now: Date) {
  const vapid = vapidFromEnv()
  if (!vapid) return null
  const message: PushMessage = { title: 'Life', body: 'Notifications are working.', url: 'ai', tag: 'test' }
  return deliver(db, householdId, vapid, new Map([[userId, message]]), now)
}
