import { type TouchEvent, useRef, useState } from 'react'

const TRIGGER_PX = 96
const LOCK_PX = 8

/**
 * Drag a row right to act on it. The first few pixels decide between swiping
 * and scrolling, so a slightly diagonal scroll never moves the row.
 */
export function useSwipeRight(onSwipe: (() => void) | undefined) {
  const [offset, setOffset] = useState(0)
  const start = useRef<{ x: number; y: number; swiping: boolean | null } | null>(null)
  const reset = () => {
    start.current = null
    setOffset(0)
  }
  if (!onSwipe) return { offset: 0, ready: false, handlers: {} }
  return {
    offset,
    ready: offset >= TRIGGER_PX,
    handlers: {
      onTouchStart: (e: TouchEvent) => {
        const { clientX: x, clientY: y } = e.touches[0]
        start.current = { x, y, swiping: null }
      },
      onTouchMove: (e: TouchEvent) => {
        const s = start.current
        if (!s) return
        const dx = e.touches[0].clientX - s.x
        const dy = e.touches[0].clientY - s.y
        if (s.swiping === null) {
          if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return
          s.swiping = Math.abs(dx) > Math.abs(dy)
        }
        if (s.swiping) setOffset(Math.max(0, dx))
      },
      onTouchEnd: () => {
        if (offset >= TRIGGER_PX) onSwipe()
        reset()
      },
      onTouchCancel: reset,
    },
  }
}
