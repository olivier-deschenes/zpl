import { useEffect, useState } from 'react'

/**
 * Tracks an element's content size. Attach the returned callback as a ref;
 * the element itself comes back too, once attached.
 */
export function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return [setElement, size, element] as const
}
