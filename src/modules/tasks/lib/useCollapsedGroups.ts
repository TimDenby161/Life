import { useState } from 'react'

/** Which groups are collapsed, remembered on this device under storageKey. */
export function useCollapsedGroups(storageKey: string) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      try {
        localStorage.setItem(storageKey, JSON.stringify([...next]))
      } catch {
        // Storage blocked: collapsing still works for this visit.
      }
      return next
    })
  return { collapsed, toggle }
}
