import { useEffect, useMemo, useState } from 'react'
import { backgroundEmbedUrl } from '../lib/youtube'

// Cycles through random game trailers, playing one blurred in the background.
// We render a single iframe at a time (cheap) and swap the source on an interval.
export default function BackgroundTrailers({ games, intervalMs = 18000 }) {
  const trailers = useMemo(
    () =>
      games
        .map((g) => backgroundEmbedUrl(g.trailer_url))
        .filter(Boolean),
    [games]
  )

  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (trailers.length <= 1) return
    // Start at a random trailer each mount.
    setIndex(Math.floor(Math.random() * trailers.length))
    const id = setInterval(() => {
      setIndex((i) => {
        if (trailers.length < 2) return i
        let next = i
        while (next === i) next = Math.floor(Math.random() * trailers.length)
        return next
      })
    }, intervalMs)
    return () => clearInterval(id)
  }, [trailers, intervalMs])

  return (
    <div className="bg-trailers" aria-hidden="true">
      {trailers.length > 0 && (
        <iframe
          key={index}
          src={trailers[index]}
          title="background trailer"
          allow="autoplay; encrypted-media"
          tabIndex={-1}
        />
      )}
    </div>
  )
}
