// Extract a YouTube video id from any common URL shape, and build embed URLs.

export function youTubeId(url) {
  if (!url) return null
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  // Bare id?
  if (/^[\w-]{11}$/.test(url.trim())) return url.trim()
  return null
}

export function thumbnailUrl(url) {
  const id = youTubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
}

// Background autoplay embed: muted, looping, no controls/branding.
export function backgroundEmbedUrl(url) {
  const id = youTubeId(url)
  if (!id) return null
  const params = new URLSearchParams({
    autoplay: '1', mute: '1', controls: '0', loop: '1', playlist: id,
    modestbranding: '1', rel: '0', showinfo: '0', iv_load_policy: '3',
    disablekb: '1', playsinline: '1',
  })
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`
}

// Foreground embed for the detail page: autoplay + sound off by default
// (browsers block unmuted autoplay), controls available.
export function foregroundEmbedUrl(url) {
  const id = youTubeId(url)
  if (!id) return null
  const params = new URLSearchParams({
    autoplay: '1', mute: '1', loop: '1', playlist: id,
    modestbranding: '1', rel: '0', iv_load_policy: '3', playsinline: '1',
  })
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`
}
