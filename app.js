/* ============================================================
   Gaming — a single static site, no build step.
   The browser runs this file directly. GitHub Pages serves it raw.
   ============================================================ */

// ---- Config (public values; this is a friends-only site) ----
const SUPABASE_URL = 'https://fsfagnwonxsmnozapwsd.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzZmFnbndvbnhzbW5vemFwd3NkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA5MzYsImV4cCI6MjA5NzE5NjkzNn0.IXUNmLCyLG38Iq2K3UegQdCticDsYB52xdKQkKYtiVc'
const ADMIN_PASSWORD = '4054'
// A second password that grants the same admin access PLUS the Settings button
// (which the default admin password doesn't show).
const SETTINGS_PASSWORD = '1254'
const MEDIA_BUCKET = 'game-media'

// Defaults for the editable settings (see the Settings tab in admin mode).
// These are used only if the `settings` row in Supabase hasn't been saved yet.
//   main_audio_tracks: the landing page shows RANDOM trailers (muted, blurred),
//                      but its soundtrack comes from ONE randomly-chosen video in
//                      this list, played at that track's own volume. Empty list =
//                      silent landing page. Browsers block autoplaying sound until
//                      you interact, so it starts on first click/key.
//   *_volume:          0–100.
const DEFAULT_AUDIO_TRACKS = [
  { url: 'https://www.youtube.com/watch?v=PZS85WIejTg', volume: 100 },
]
const DEFAULT_SETTINGS = {
  volume: 100, // per-person (client): starting trailer volume until changed on a trailer
}

// Clamp anything to a valid 0–100 volume, defaulting to 100 when not a number.
function clampVolume(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 100
  return Math.max(0, Math.min(100, Math.round(n)))
}
// Normalize a stored settings row into a clean track list. Falls back to the
// legacy single url/volume columns for rows saved before the multi-track change.
function normalizeAudioTracks(data) {
  const raw = Array.isArray(data?.main_audio_tracks) ? data.main_audio_tracks : null
  if (raw) {
    return raw
      .map((t) => ({ url: String(t?.url || '').trim(), volume: clampVolume(t?.volume) }))
      .filter((t) => t.url)
  }
  if (data?.main_audio_url) {
    return [{ url: String(data.main_audio_url).trim(), volume: clampVolume(data.main_audio_volume) }]
  }
  return []
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ---- App state ----
const state = {
  games: [],
  query: '',
  activeTags: [],
  activeGenres: [],
  showReleased: false, // hide already-released games until the user opts in
  sort: { key: 'release', dir: 'asc' },
  isAdmin: sessionStorage.getItem('gaming.admin') === '1',
  // Only the secondary password unlocks Settings.
  canSettings: sessionStorage.getItem('gaming.settings') === '1',
  // Shared (from DB): the list of landing-page audio tracks (each {url, volume}).
  // One is chosen at random to play.
  settings: {
    main_audio_tracks: DEFAULT_AUDIO_TRACKS.map((t) => ({ ...t })),
  },
  // Per-person (this browser only): one volume + mute shared by the background
  // music and the trailers. Whatever you set on a trailer's YouTube controls
  // is captured here and carried back to the background music.
  volume: loadStoredVolume(),
  muted: localStorage.getItem('gaming.muted') === '1',
  loading: true,
  error: null,
}

function loadStoredVolume() {
  const v = Number(localStorage.getItem('gaming.volume'))
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : DEFAULT_SETTINGS.volume
}
function saveVolumePrefs() {
  localStorage.setItem('gaming.volume', String(state.volume))
  localStorage.setItem('gaming.muted', state.muted ? '1' : '0')
}

// ---- Small DOM helpers ----
const $ = (sel) => document.querySelector(sel)
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k === 'html') node.innerHTML = v
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v)
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v)
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue
    node.append(c.nodeType ? c : document.createTextNode(c))
  }
  return node
}

/* ============================================================
   YouTube helpers
   ============================================================ */
function youTubeId(url) {
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
  if (/^[\w-]{11}$/.test(url.trim())) return url.trim()
  return null
}
function thumbnailUrl(url) {
  const id = youTubeId(url)
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null
}
// Muted, chromeless, looping — used for the blurred background only.
// `start` (seconds) lets a trailer begin partway in instead of at 0:00.
function embedUrl(url, { blurred, start } = {}) {
  const id = youTubeId(url)
  if (!id) return null
  const params = new URLSearchParams({
    autoplay: '1', mute: '1', controls: '0', loop: '1', playlist: id,
    modestbranding: '1', rel: '0', iv_load_policy: '3', playsinline: '1',
    ...(start ? { start: String(start) } : {}),
    ...(blurred ? { disablekb: '1' } : {}),
  })
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`
}

// Load the YouTube IFrame Player API once (needed to control volume, mute and
// playback — things plain embed URLs can't do). Resolves with the global `YT`.
let ytApiPromise = null
function loadYouTubeApi() {
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve(window.YT)
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev()
      resolve(window.YT)
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  })
  return ytApiPromise
}

/* ============================================================
   Fuzzy release dates
   ============================================================ */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const PRECISIONS = ['day', 'month', 'year', 'unknown']

// Platforms a game can be marked for (multiple allowed). PC, Mac and Linux all
// share the Steam logo in the list; the consoles get their own brand logo.
const PLATFORMS = ['PC', 'Mac', 'Linux', 'PlayStation', 'Xbox', 'Switch', 'VR']

// Brand logos (simple-icons paths, 24×24, drawn with currentColor). The VR one
// is a custom goggle silhouette. Several platforms map to one icon (Steam covers
// PC/Mac/Linux), so the list shows one logo per group, not one per platform.
const PLATFORM_ICONS = {
  steam: {
    label: 'PC / Mac / Linux',
    path: 'M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z',
  },
  playstation: {
    label: 'PlayStation',
    path: 'M8.984 2.596v17.547l3.915 1.261V6.688c0-.69.304-1.151.794-.991.636.18.76.814.76 1.505v5.875c2.441 1.193 4.362-.002 4.362-3.152 0-3.237-1.126-4.675-4.438-5.827-1.307-.448-3.728-1.186-5.39-1.502zm4.656 16.241l6.296-2.275c.715-.258.826-.625.246-.818-.586-.192-1.637-.139-2.357.123l-4.205 1.5V14.98l.24-.085s1.201-.42 2.913-.615c1.696-.18 3.785.03 5.437.661 1.848.601 2.04 1.472 1.576 2.072-.465.6-1.622 1.036-1.622 1.036l-8.544 3.107V18.86zM1.807 18.6c-1.9-.545-2.214-1.668-1.352-2.32.801-.586 2.16-1.052 2.16-1.052l5.615-2.013v2.313L4.205 17c-.705.271-.825.632-.239.826.586.195 1.637.15 2.343-.12L8.247 17v2.074c-.12.03-.256.044-.39.073-1.939.331-3.996.196-6.038-.479z',
  },
  xbox: {
    label: 'Xbox',
    path: 'M4.102 21.033C6.211 22.881 8.977 24 12 24c3.026 0 5.789-1.119 7.902-2.967 1.877-1.912-4.316-8.709-7.902-11.417-3.582 2.708-9.779 9.505-7.898 11.417zm11.16-14.406c2.5 2.961 7.484 10.313 6.076 12.912C23.002 17.48 24 14.861 24 12.004c0-3.34-1.365-6.362-3.57-8.536 0 0-.027-.022-.082-.042-.063-.022-.152-.045-.281-.045-.592 0-1.985.434-4.805 3.246zM3.654 3.426c-.057.02-.082.041-.086.042C1.365 5.642 0 8.664 0 12.004c0 2.854.998 5.473 2.661 7.533-1.401-2.605 3.579-9.951 6.08-12.91-2.82-2.813-4.216-3.245-4.806-3.245-.131 0-.223.021-.281.046v-.002zM12 3.551S9.055 1.828 6.755 1.746c-.903-.033-1.454.295-1.521.339C7.379.646 9.659 0 11.984 0H12c2.334 0 4.605.646 6.766 2.085-.068-.046-.615-.372-1.52-.339C14.946 1.828 12 3.545 12 3.545v.006z',
  },
  switch: {
    label: 'Switch',
    path: 'M14.176 24h3.674c3.376 0 6.15-2.774 6.15-6.15V6.15C24 2.775 21.226 0 17.85 0H14.1c-.074 0-.15.074-.15.15v23.7c-.001.076.075.15.226.15zm4.574-13.199c1.351 0 2.399 1.125 2.399 2.398 0 1.352-1.125 2.4-2.399 2.4-1.35 0-2.4-1.049-2.4-2.4-.075-1.349 1.05-2.398 2.4-2.398zM11.4 0H6.15C2.775 0 0 2.775 0 6.15v11.7C0 21.226 2.775 24 6.15 24h5.25c.074 0 .15-.074.15-.149V.15c.001-.076-.075-.15-.15-.15zM9.676 22.051H6.15c-2.326 0-4.201-1.875-4.201-4.201V6.15c0-2.326 1.875-4.201 4.201-4.201H9.6l.076 20.102zM3.75 7.199c0 1.275.975 2.25 2.25 2.25s2.25-.975 2.25-2.25c0-1.273-.975-2.25-2.25-2.25s-2.25.977-2.25 2.25z',
  },
  vr: {
    label: 'VR',
    path: 'M2 7.5C2 6.12 3.12 5 4.5 5h15C20.88 5 22 6.12 22 7.5v5c0 1.38-1.12 2.5-2.5 2.5h-4.04c-.95 0-1.81-.54-2.24-1.39l-.43-.86c-.32-.65-1.25-.65-1.58 0l-.43.86c-.43.85-1.29 1.39-2.24 1.39H4.5C3.12 15 2 13.88 2 12.5v-5z',
  },
}
const PLATFORM_ICON_ORDER = ['steam', 'playstation', 'xbox', 'switch', 'vr']

// Map a stored platform string to its icon group. Handles both the current
// platform names and the older, longer ones (e.g. "PlayStation 5", "Nintendo
// Switch") so games saved before this change still show the right logo.
function platformIconKey(p) {
  const s = String(p).toLowerCase()
  if (s.includes('playstation') || /\bps[0-9]/.test(s)) return 'playstation'
  if (s.includes('xbox')) return 'xbox'
  if (s.includes('switch') || s.includes('nintendo')) return 'switch'
  if (s.includes('vr') || s.includes('quest') || s.includes('oculus') || s.includes('vive') || s.includes('index')) return 'vr'
  if (s.includes('pc') || s.includes('mac') || s.includes('linux') || s.includes('windows') || s.includes('steam')) return 'steam'
  return null // e.g. Mobile — no logo
}

// Collapse an older/longer platform name to one of the current selectable ones
// when editing, so saving migrates legacy values. Returns null to drop it.
function canonicalPlatform(p) {
  if (PLATFORMS.includes(p)) return p
  const key = platformIconKey(p)
  if (key === 'playstation') return 'PlayStation'
  if (key === 'xbox') return 'Xbox'
  if (key === 'switch') return 'Switch'
  if (key === 'vr') return 'VR'
  if (key === 'steam') return p.toLowerCase().includes('mac') ? 'Mac'
    : p.toLowerCase().includes('linux') ? 'Linux' : 'PC'
  return null
}

// A 20×20 inline SVG for a platform icon group.
function platformIconSvg(key) {
  return el('span', {
    class: 'pi-svg',
    html: `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="${PLATFORM_ICONS[key].path}"/></svg>`,
  })
}

function formatReleaseDate(date, precision) {
  if (!date || precision === 'unknown') return 'TBA'
  const [y, m, d] = date.split('-').map(Number)
  if (precision === 'year') return String(y)
  if (precision === 'month') return `${MONTHS[m - 1]} ${y}`
  return `${d} ${MONTHS[m - 1]} ${y}`
}
function releaseSortKey(date, precision) {
  if (!date || precision === 'unknown') return Number.POSITIVE_INFINITY
  const [y, m, d] = date.split('-').map(Number)
  // Vague dates sort as the LATEST they could be: a year -> Dec 31, a month ->
  // last day (31 as an upper bound). So "2026" sorts after "22 July 2026".
  if (precision === 'year') return y * 10000 + 12 * 100 + 31
  if (precision === 'month') return y * 10000 + m * 100 + 31
  return y * 10000 + m * 100 + d
}
// Today as the same yyyymmdd integer releaseSortKey produces, for comparing.
function todaySortKey() {
  const now = new Date()
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
}
// A game counts as released only once its LATEST possible date has passed, so a
// fuzzy date that might still be upcoming (e.g. "2026" mid-2026) stays visible;
// TBA/unknown is never "released" (sort key is Infinity).
function hasReleased(game) {
  return releaseSortKey(game.release_date, game.release_precision) <= todaySortKey()
}
function buildReleaseDate({ precision, year, month, day }) {
  if (precision === 'unknown' || !year) return { release_date: null, release_precision: 'unknown' }
  const y = String(year).padStart(4, '0')
  const m = String(precision === 'year' ? 1 : month || 1).padStart(2, '0')
  const d = String(precision === 'day' ? day || 1 : 1).padStart(2, '0')
  return { release_date: `${y}-${m}-${d}`, release_precision: precision }
}
function releaseToForm(date, precision) {
  if (!date || precision === 'unknown') return { precision: 'unknown', year: '', month: '', day: '' }
  const [y, m, d] = date.split('-').map(Number)
  return {
    precision,
    year: String(y),
    month: precision === 'year' ? '' : String(m),
    day: precision === 'day' ? String(d) : '',
  }
}

/* ============================================================
   Data layer (Supabase)
   ============================================================ */
function slugify(title) {
  return String(title).toLowerCase().trim()
    .replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 80) || 'game'
}
async function uniqueSlug(base, ignoreId = null) {
  let slug = base, n = 1
  const { data } = await db.from('games').select('id, slug').like('slug', `${base}%`)
  const taken = new Set((data || []).filter((r) => r.id !== ignoreId).map((r) => r.slug))
  while (taken.has(slug)) { n += 1; slug = `${base}-${n}` }
  return slug
}
async function fetchGames() {
  const { data, error } = await db.from('games').select('*').order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}
async function createGame(values) {
  const slug = await uniqueSlug(slugify(values.title))
  const { error } = await db.from('games').insert({ ...values, slug })
  if (error) throw error
}
async function updateGame(id, values) {
  const patch = { ...values }
  if (values.title) patch.slug = await uniqueSlug(slugify(values.title), id)
  const { error } = await db.from('games').update(patch).eq('id', id)
  if (error) throw error
}
async function deleteGame(id) {
  const { error } = await db.from('games').delete().eq('id', id)
  if (error) throw error
}
// Settings live in a single-row `settings` table (id = 1) so they're shared
// across everyone, not just one browser. Falls back to DEFAULT_SETTINGS.
async function fetchSettings() {
  try {
    const { data } = await db.from('settings').select('*').eq('id', 1).maybeSingle()
    if (data) {
      state.settings = { main_audio_tracks: normalizeAudioTracks(data) }
    }
  } catch {
    /* table missing or offline — keep defaults */
  }
}
async function saveSettings(values) {
  const { error } = await db
    .from('settings')
    .upsert({ id: 1, ...values, updated_at: new Date().toISOString() })
  if (error) throw error
  state.settings = { ...state.settings, ...values }
}

async function uploadImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `images/${crypto.randomUUID()}.${ext}`
  const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, file, { cacheControl: '3600' })
  if (error) throw error
  return db.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
}

/* ============================================================
   Game lookup — store catalog (Ephellon/game-store-catalog)
   Static JSON over a CDN (CORS-open, gzipped), so the browser reads it
   directly — no backend. Files are per-store, split by first letter. We fetch
   the letter for what's being typed, merge the 5 stores by normalized name,
   and get platforms + store URLs + cover for free. Descriptions aren't in the
   catalog — those come later, best-effort, from Steam (see fetchSteamDetails).
   ============================================================ */
const CATALOG_BASE = 'https://cdn.jsdelivr.net/gh/Ephellon/game-store-catalog@main'
const CATALOG_STORES = ['steam', 'epic', 'psn', 'xbox', 'nintendo'] // steam first → wins PC link + cover
const catalogCache = new Map() // letter -> Promise<record[]>

// Match key: strip accents (é→e, ñ→n), lowercase, collapse everything that
// isn't a letter/number (™®©, punctuation, the "é" leftover) to spaces. Lets
// "pokemon" find "Pokémon" and merges the same game across stores despite
// punctuation/accent differences.
function normalizeName(s) {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // decompose + drop diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
function catalogLetter(query) {
  const c = (query.trim().toLowerCase().match(/[a-z0-9]/) || [''])[0]
  return /[a-z]/.test(c) ? c : '_'
}

async function fetchStoreLetter(store, letter) {
  try {
    const res = await fetch(`${CATALOG_BASE}/${store}/${letter}.json`)
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return [] // a missing store/letter just contributes nothing
  }
}

// Fold one store's entry into the merged record for a game. Steam takes priority
// for the PC link and cover (it wins even if another store merged first, so the
// result doesn't depend on which fetch resolves first).
function mergeStoreEntry(rec, store, g) {
  const setLink = (platform, href) => { if (href && !rec.store_links[platform]) rec.store_links[platform] = href }
  if (store === 'steam') {
    const plats = Array.isArray(g.platforms) ? g.platforms : []
    if (!plats.length) rec.platforms.add('PC')
    for (const p of plats) {
      const s = String(p).toLowerCase()
      if (s.includes('mac')) rec.platforms.add('Mac')
      else if (s.includes('linux')) rec.platforms.add('Linux')
      else rec.platforms.add('PC')
    }
    if (g.href) rec.store_links.PC = g.href // Steam wins the PC/Steam slot
    if (!rec.steamAppId && g.uuid) rec.steamAppId = String(g.uuid)
    if (g.image) rec.cover = g.image // prefer Steam's (16:9 header) cover
    return
  }
  if (store === 'epic') { rec.platforms.add('PC'); setLink('PC', g.href) }
  else if (store === 'psn') { rec.platforms.add('PlayStation'); setLink('PlayStation', g.href) }
  else if (store === 'xbox') { rec.platforms.add('Xbox'); setLink('Xbox', g.href) }
  else if (store === 'nintendo') { rec.platforms.add('Switch'); setLink('Switch', g.href) }
  if (!rec.cover && g.image) rec.cover = g.image
}

function makeRecord(name, key) {
  return { name, norm: key, platforms: new Set(), store_links: {}, cover: null, steamAppId: null }
}

// Build (and cache) the merged index for ONE letter across all stores. Fast
// (~1 MB) — used for instant first results while the full index loads.
function loadLetterIndex(letter) {
  if (catalogCache.has(letter)) return catalogCache.get(letter)
  const promise = (async () => {
    const files = await Promise.all(
      CATALOG_STORES.map((s) => fetchStoreLetter(s, letter).then((games) => [s, games]))
    )
    const map = new Map()
    for (const [store, games] of files) {
      for (const g of games) {
        if (!g?.name) continue
        const key = normalizeName(g.name)
        if (!key) continue
        let rec = map.get(key)
        if (!rec) { rec = makeRecord(g.name, key); map.set(key, rec) }
        mergeStoreEntry(rec, store, g)
      }
    }
    return [...map.values()]
  })()
  catalogCache.set(letter, promise)
  return promise
}

// The FULL index (every letter, all stores; ~11 MB gzipped, ~225k games).
// Loaded once in the background so searches by a word that isn't the start of
// the official title (e.g. "silksong" → "Hollow Knight: Silksong") still work.
const CATALOG_LETTERS = '_abcdefghijklmnopqrstuvwxyz'.split('')
let fullIndex = null
let fullIndexPromise = null
function ensureFullCatalog() {
  if (fullIndexPromise) return fullIndexPromise
  const map = new Map()
  const mergeGame = (store, g) => {
    if (!g?.name) return
    const key = normalizeName(g.name)
    if (!key) return
    let rec = map.get(key)
    if (!rec) { rec = makeRecord(g.name, key); map.set(key, rec) }
    mergeStoreEntry(rec, store, g)
  }
  fullIndexPromise = (async () => {
    // Merge each file as it arrives, spreading the work off one big blocking pass.
    await Promise.all(CATALOG_STORES.flatMap((store) =>
      CATALOG_LETTERS.map((letter) =>
        fetchStoreLetter(store, letter).then((games) => { for (const g of games) mergeGame(store, g) })
      )
    ))
    fullIndex = [...map.values()]
    return fullIndex
  })()
  return fullIndexPromise
}

function rankCatalog(index, query, limit) {
  const nq = normalizeName(query)
  if (nq.length < 2) return []
  const scored = []
  for (const rec of index) {
    const i = rec.norm.indexOf(nq)
    if (i < 0) continue
    scored.push([rec, i])
  }
  scored.sort((a, b) => a[1] - b[1] || a[0].name.length - b[0].name.length)
  return scored.slice(0, limit).map((s) => s[0])
}

// Top matches for a typed query. Uses the full index once it's ready; until
// then falls back to the single-letter index for instant results. Kicks off the
// full load so later keystrokes get complete coverage.
async function searchCatalog(query, limit = 8) {
  if (normalizeName(query).length < 2) return []
  ensureFullCatalog()
  const index = fullIndex || await loadLetterIndex(catalogLetter(query))
  return rankCatalog(index, query, limit)
}

// Best-effort description/genre/release from Steam, via the `steam-details`
// edge function (Steam's API has no CORS). Throws on failure so the caller can
// surface why (e.g. the function isn't deployed); descriptions are optional, so
// a failure never blocks the form.
async function fetchSteamDetails(appId) {
  const { data, error } = await db.functions.invoke('steam-details', { body: { appid: appId } })
  if (error) throw new Error(error.message || 'edge function error (is "steam-details" deployed?)')
  if (data?.error) throw new Error(data.error)
  return data
}

/* ============================================================
   Background trailers
   ============================================================ */
const BG_SWITCH_MS = 60000
let bgTimer = null
let bgPlayer = null
let bgSeeked = false
let bgIds = []
let bgIndex = 0

// Jump to a random point (once per clip), biased to the middle: never the first
// 10s, and no later than ~60% in (so there's a good chunk left — landing with
// ~30s remaining is fine, and we just switch when it ends).
function bgSeekRandom(p) {
  try {
    const dur = p.getDuration()
    if (!dur || dur <= 20) return // too short — just play from the start
    const minStart = 10
    const maxStart = Math.max(minStart + 1, dur * 0.6)
    p.seekTo(Math.floor(minStart + Math.random() * (maxStart - minStart)), true)
  } catch {
    /* not ready */
  }
}

function bgResetTimer() {
  clearInterval(bgTimer)
  bgTimer = setInterval(bgPlayNext, BG_SWITCH_MS)
}

// Switch to a different random trailer and restart the switch clock.
function bgPlayNext() {
  if (!bgPlayer || !bgPlayer.loadVideoById || !bgIds.length) return
  if (bgIds.length > 1) {
    let next = bgIndex
    while (next === bgIndex) next = Math.floor(Math.random() * bgIds.length)
    bgIndex = next
  }
  bgSeeked = false
  bgPlayer.loadVideoById({ videoId: bgIds[bgIndex] })
  bgPlayer.mute()
  bgResetTimer()
}

function startBackgroundTrailers() {
  const host = $('#bgTrailers')
  bgIds = state.games.map((g) => youTubeId(g.trailer_url)).filter(Boolean)
  clearInterval(bgTimer)
  if (bgPlayer && bgPlayer.destroy) { try { bgPlayer.destroy() } catch {} }
  bgPlayer = null
  host.innerHTML = ''
  if (!bgIds.length) return

  bgIndex = Math.floor(Math.random() * bgIds.length)
  host.append(el('div', { id: 'bgPlayer' }))

  // Driven by the IFrame API (like the detail/audio players) for reliable
  // muted autoplay — plain autoplay iframes had stopped playing.
  loadYouTubeApi().then((YT) => {
    bgSeeked = false
    bgPlayer = new YT.Player('bgPlayer', {
      videoId: bgIds[bgIndex],
      playerVars: {
        autoplay: 1, controls: 0, mute: 1, modestbranding: 1,
        rel: 0, iv_load_policy: 3, playsinline: 1, disablekb: 1,
      },
      events: {
        onReady: (e) => { e.target.mute(); e.target.playVideo() },
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING && !bgSeeked) {
            bgSeeked = true
            bgSeekRandom(e.target)
          }
          // If a clip ends (we started late), move on to another trailer.
          if (e.data === YT.PlayerState.ENDED) bgPlayNext()
        },
      },
    })
    bgResetTimer()
  })
}

/* ============================================================
   Main-page audio (shuffles through ALL tracks, looping forever, played hidden)
   The blurred trailers above are silent; the soundtrack comes from here.
   ============================================================ */
let mainAudioPlayer = null
let audioUnlocked = false
// Which track is currently playing, so the volume preview/apply targets it.
let currentAudioId = null
let currentAudioVolume = 100
// A shuffled queue of tracks we walk through; when exhausted we reshuffle and
// keep going, so the music never stops even after every track has played.
let audioQueue = []
let audioQueuePos = 0

// The current playable tracks ({id, volume}), skipping entries with bad URLs.
function audioTrackList() {
  return (state.settings.main_audio_tracks || [])
    .map((t) => ({ id: youTubeId(t.url), volume: clampVolume(t.volume) }))
    .filter((t) => t.id)
}

function shuffled(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Next track in the shuffled queue. Reshuffles for another pass when exhausted,
// nudging the just-played track off the front so it doesn't repeat back-to-back.
function nextAudioTrack() {
  const tracks = audioTrackList()
  if (!tracks.length) return null
  if (audioQueuePos >= audioQueue.length) {
    let q = shuffled(tracks)
    if (q.length > 1 && q[0].id === currentAudioId) q.push(q.shift())
    audioQueue = q
    audioQueuePos = 0
  }
  return audioQueue[audioQueuePos++]
}

// Load + play a given track, applying its own volume.
function playAudioTrack(track) {
  currentAudioId = track.id
  currentAudioVolume = track.volume
  if (mainAudioPlayer && mainAudioPlayer.loadVideoById) {
    mainAudioPlayer.loadVideoById(track.id)
    applyBgVolume()
  }
}

function startMainAudio() {
  audioQueue = []
  audioQueuePos = 0
  const track = nextAudioTrack()
  if (!track) return
  currentAudioId = track.id
  currentAudioVolume = track.volume

  // A hidden player — no controls, invisible (but rendered so it still plays).
  // It's just the background music. Volume follows the client-side setting.
  let mount = document.getElementById('mainAudio')
  if (!mount) {
    mount = el('div', { id: 'mainAudio', class: 'bg-audio' })
    document.body.append(mount)
  }

  loadYouTubeApi().then((YT) => {
    mainAudioPlayer = new YT.Player('mainAudio', {
      width: '160',
      height: '90',
      videoId: track.id,
      playerVars: {
        // No loop/playlist here — we advance on ENDED so each track gets its own
        // volume and the whole list shuffles through.
        autoplay: 1, controls: 0,
        mute: 1, modestbranding: 1, rel: 0, playsinline: 1, disablekb: 1,
      },
      events: {
        onReady: (e) => {
          applyBgVolume()
          e.target.playVideo()
        },
        onStateChange: (e) => {
          // When a track finishes, move on to the next shuffled one.
          if (e.data === YT.PlayerState.ENDED) {
            const next = nextAudioTrack()
            if (next) playAudioTrack(next)
          }
        },
      },
    })
  })
}

// Apply the client-side volume/mute to the hidden background player.
// Stays muted until the first user gesture (browser autoplay policy).
function applyBgVolume() {
  const p = mainAudioPlayer
  if (!p || !p.setVolume) return
  p.setVolume(currentAudioVolume) // volume of the currently-playing track
  if (audioUnlocked) p.unMute()
  else p.mute() // stays muted until the first user gesture (autoplay policy)
}

// Browsers block autoplaying sound until the user interacts; unmute on the
// first gesture anywhere on the page.
function unlockAudio() {
  if (audioUnlocked) return
  audioUnlocked = true
  if (mainAudioPlayer && mainAudioPlayer.playVideo) {
    applyBgVolume()
    mainAudioPlayer.playVideo()
  }
}
window.addEventListener('pointerdown', unlockAudio)
window.addEventListener('keydown', unlockAudio)

// Rebuild the hidden audio player after the chosen video/volume changes.
function restartMainAudio() {
  if (mainAudioPlayer && mainAudioPlayer.destroy) mainAudioPlayer.destroy()
  mainAudioPlayer = null
  const mount = document.getElementById('mainAudio')
  if (mount) mount.remove()
  startMainAudio()
}

function setMainAudioPaused(paused) {
  if (!mainAudioPlayer || !mainAudioPlayer.pauseVideo) return
  if (paused) {
    mainAudioPlayer.pauseVideo()
  } else if (audioUnlocked) {
    applyBgVolume() // pick up any volume/mute change made on a trailer
    mainAudioPlayer.playVideo()
  }
}

/* ============================================================
   List rendering
   ============================================================ */
const COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'genre', label: 'Genre' },
  { key: 'platforms', label: 'Platforms', sortable: false },
  { key: 'tags', label: 'Tags', sortable: false },
  { key: 'release', label: 'Release date' },
]

function visibleGames() {
  const q = state.query.trim().toLowerCase()
  let rows = state.games.filter((g) => {
    if (q) {
      const hay = [g.title, g.description, g.genre, ...(g.tags || [])].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (state.activeGenres.length && !state.activeGenres.includes(g.genre)) return false
    if (state.activeTags.length && !state.activeTags.every((t) => (g.tags || []).includes(t))) return false
    // Default view shows only unreleased titles; the "Released" button flips it
    // to show only titles that have already released.
    if (hasReleased(g) !== state.showReleased) return false
    return true
  })
  const dir = state.sort.dir === 'asc' ? 1 : -1
  rows = [...rows].sort((a, b) => {
    if (state.sort.key === 'release') {
      return (releaseSortKey(a.release_date, a.release_precision) - releaseSortKey(b.release_date, b.release_precision)) * dir
    }
    return (a[state.sort.key] || '').toString().toLowerCase()
      .localeCompare((b[state.sort.key] || '').toString().toLowerCase()) * dir
  })
  return rows
}

function renderTopControls() {
  const host = $('#topControls')
  host.innerHTML = ''
  if (state.isAdmin) {
    host.append(...[
      el('button', { class: 'btn btn-primary', onclick: () => openGameForm(null) }, '+ Add game'),
      state.canSettings
        ? el('button', { class: 'btn btn-ghost', onclick: openSettings }, 'Settings')
        : null,
      el('button', { class: 'btn btn-ghost', onclick: () => {
        sessionStorage.removeItem('gaming.admin')
        sessionStorage.removeItem('gaming.settings')
        state.isAdmin = false
        state.canSettings = false
        render()
      } }, 'Exit admin'),
    ].filter(Boolean))
  } else {
    host.append(el('button', { class: 'btn btn-ghost', onclick: openLogin }, 'Admin'))
  }
}

function renderFilters() {
  const host = $('#filterBar')
  host.innerHTML = ''
  const allGenres = [...new Set(state.games.map((g) => g.genre).filter(Boolean))].sort()
  const allTags = [...new Set(state.games.flatMap((g) => g.tags || []))].sort()

  const group = (label, values, active, onToggle) => {
    if (!values.length) return
    const chips = values.map((v) =>
      el('button', {
        class: `chip ${active.includes(v) ? 'active' : ''}`,
        onclick: () => { onToggle(v); render() },
      }, v)
    )
    host.append(el('div', { class: 'filter-group' },
      el('span', { class: 'filter-group-label' }, label),
      el('div', { class: 'filter-chips' }, ...chips)))
  }
  const toggle = (arr, v) => {
    const i = arr.indexOf(v)
    if (i >= 0) arr.splice(i, 1)
    else arr.push(v)
  }
  group('Genres', allGenres, state.activeGenres, (v) => toggle(state.activeGenres, v))
  group('Tags', allTags, state.activeTags, (v) => toggle(state.activeTags, v))
}

// The "Released" button next to the search bar. Released games are hidden by
// default; clicking fills the button (btn-primary) and shows them.
function renderReleasedToggle() {
  const btn = $('#releasedToggle')
  if (!btn) return
  btn.classList.toggle('btn-primary', state.showReleased)
}

function renderLegend() {
  const host = $('#legend')
  host.innerHTML = ''
  for (const col of COLUMNS) {
    if (col.sortable === false) { host.append(el('span', {}, col.label)); continue }
    const sorted = state.sort.key === col.key
    host.append(el('button', {
      class: sorted ? 'sorted' : '',
      onclick: () => {
        state.sort = sorted
          ? { key: col.key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
          : { key: col.key, dir: 'asc' }
        render()
      },
    }, col.label, sorted ? el('span', { class: 'sort-caret' }, state.sort.dir === 'asc' ? '▲' : '▼') : null))
  }
  host.append(el('span'))
}

// One logo per icon group for a game's platforms. PC/Mac/Linux collapse to a
// single Steam logo. If any platform in a group has a store link, the logo
// becomes a link to it (the first one found); clicking it opens the store page
// instead of the game's trailer overlay.
function platformIconsCell(game) {
  const links = game.store_links || {}
  const groups = new Map() // iconKey -> first store link found (or null)
  for (const p of game.platforms || []) {
    const key = platformIconKey(p)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, null)
    if (!groups.get(key) && links[p]) groups.set(key, links[p])
  }

  const cell = el('div', { class: 'platform-icons' })
  for (const key of PLATFORM_ICON_ORDER) {
    if (!groups.has(key)) continue
    const href = groups.get(key)
    const label = PLATFORM_ICONS[key].label
    if (href) {
      cell.append(el('a', {
        class: `platform-icon has-link pi-${key}`,
        href, target: '_blank', rel: 'noopener noreferrer',
        title: `${label} — open store page`,
        onclick: (e) => e.stopPropagation(), // don't open the trailer overlay
      }, platformIconSvg(key)))
    } else {
      cell.append(el('span', { class: `platform-icon pi-${key}`, title: label }, platformIconSvg(key)))
    }
  }
  return cell
}

function renderRows() {
  const host = $('#rows')
  host.innerHTML = ''

  if (state.loading) { host.append(el('div', { class: 'empty' }, 'Loading…')); return }
  if (state.error) { host.append(el('div', { class: 'empty' }, `Error: ${state.error}`)); return }

  const rows = visibleGames()
  if (!rows.length) {
    host.append(el('div', { class: 'empty' },
      state.games.length === 0
        ? 'No games yet. Click “Admin”, enter the password, then “Add game”.'
        : 'No games match your filters.'))
    return
  }

  for (const game of rows) {
    const editBtn = state.isAdmin
      ? el('button', { class: 'row-edit', title: 'Edit', onclick: (e) => { e.stopPropagation(); openGameForm(game) } }, '✎')
      : el('span')
    const thumb = thumbnailUrl(game.trailer_url) || (game.images && game.images[0]) || null
    host.append(el('div', { class: 'game-row', onclick: () => openDetail(game) },
      el('div', { class: 'game-title' },
        thumb ? el('img', { src: thumb, alt: '' }) : null,
        game.title),
      el('div', { class: 'game-genre' }, game.genre || '—'),
      platformIconsCell(game),
      el('div', { class: 'tag-list' }, (game.tags || []).map((t) => el('span', { class: 'tag' }, t))),
      el('div', { class: 'game-date' }, formatReleaseDate(game.release_date, game.release_precision)),
      editBtn))
  }
}

function render() {
  renderTopControls()
  renderFilters()
  renderReleasedToggle()
  renderLegend()
  renderRows()
}

/* ============================================================
   Fullscreen game view (no page navigation — just an overlay)
   ============================================================ */
let idleTimer = null
let detailPlayer = null
let detailVolPoll = null
function openDetail(game) {
  const host = $('#detail')
  const id = youTubeId(game.trailer_url)

  // Hush the landing-page soundtrack while a trailer is playing.
  setMainAudioPaused(true)

  const overlay = el('div', { class: 'detail-overlay' },
    el('h1', {}, game.title),
    el('div', { class: 'detail-meta' },
      game.genre ? el('span', { class: 'pill' }, game.genre) : null,
      el('span', { class: 'pill' }, formatReleaseDate(game.release_date, game.release_precision)),
      (game.platforms || []).map((p) => el('span', { class: 'pill pill-platform' }, p)),
      (game.tags || []).map((t) => el('span', { class: 'pill' }, t))),
    game.description ? el('p', { class: 'detail-desc' }, game.description) : null)

  const hint = el('button', { class: 'btn btn-ghost detail-hint', onclick: closeDetail }, '‹ Esc — back to list')

  // The player is fitted (letterboxed) like fullscreen YouTube so its control
  // bar is never cropped, and it's interactive (pointer-events on) so you can
  // scrub, pause and adjust volume. Built via the IFrame API so we can start
  // the volume at the configured detail volume instead of full blast.
  const media = id
    ? el('div', { class: 'detail-stage' }, el('div', { id: 'detailPlayer' }))
    : game.images && game.images[0]
      ? el('img', { class: 'detail-image', src: game.images[0], alt: game.title })
      : el('div')

  host.innerHTML = ''
  host.append(media, hint, overlay)
  host.classList.remove('hidden')

  if (id) {
    loadYouTubeApi().then((YT) => {
      detailPlayer = new YT.Player('detailPlayer', {
        videoId: id,
        playerVars: {
          autoplay: 1, controls: 1, rel: 0,
          modestbranding: 1, playsinline: 1, fs: 1,
        },
        events: {
          onReady: (e) => {
            e.target.getIframe().classList.add('detail-video')
            // Start at the shared client-side volume/mute…
            e.target.setVolume(state.volume)
            if (state.muted) e.target.mute()
            else e.target.unMute()
            e.target.playVideo()
            // …and capture whatever the user changes on the native controls,
            // so it carries back to the background music.
            clearInterval(detailVolPoll)
            detailVolPoll = setInterval(() => {
              try {
                const v = Math.round(e.target.getVolume())
                const m = e.target.isMuted()
                if (v !== state.volume || m !== state.muted) {
                  state.volume = v
                  state.muted = m
                  saveVolumePrefs()
                }
              } catch {
                /* player not ready */
              }
            }, 600)
          },
        },
      })
    })
  }

  const wake = () => {
    host.classList.remove('hide-cursor')
    overlay.classList.remove('faded')
    hint.classList.remove('faded')
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      overlay.classList.add('faded')
      hint.classList.add('faded')
      host.classList.add('hide-cursor')
    }, 3000)
  }
  host._wake = wake
  host.addEventListener('mousemove', wake)
  host.addEventListener('touchstart', wake)
  wake()
}

function closeDetail() {
  const host = $('#detail')
  if (host.classList.contains('hidden')) return
  clearTimeout(idleTimer)
  if (host._wake) {
    host.removeEventListener('mousemove', host._wake)
    host.removeEventListener('touchstart', host._wake)
  }
  host.classList.add('hidden')
  clearInterval(detailVolPoll)
  if (detailPlayer && detailPlayer.destroy) {
    detailPlayer.destroy()
    detailPlayer = null
  }
  host.innerHTML = '' // stops the trailer audio/video
  setMainAudioPaused(false) // resume the bg music (applyBgVolume picks up changes)
}

/* ============================================================
   Modals: admin login + add/edit game form
   ============================================================ */
function openModal(buildContent) {
  const root = $('#modalRoot')
  const close = () => { root.innerHTML = '' }
  const overlay = el('div', { class: 'modal-overlay' })
  const modal = el('div', { class: 'modal' })
  // Close only on a genuine click on the backdrop — i.e. the press AND the
  // release both happen on the overlay itself. This stops a drag that starts
  // inside the modal (e.g. selecting text) and ends outside from closing it.
  let pressedOnOverlay = false
  overlay.addEventListener('mousedown', (e) => { pressedOnOverlay = e.target === overlay })
  overlay.addEventListener('click', (e) => { if (e.target === overlay && pressedOnOverlay) close() })
  overlay.append(modal)
  root.innerHTML = ''
  root.append(overlay)
  buildContent(modal, close)
  return close
}

function openLogin() {
  openModal((modal, close) => {
    const input = el('input', { type: 'password', autofocus: '', placeholder: '••••' })
    const errorText = el('div', { class: 'error-text hidden' }, 'Wrong password.')
    const submit = () => {
      const isSettings = input.value === SETTINGS_PASSWORD
      if (input.value === ADMIN_PASSWORD || isSettings) {
        sessionStorage.setItem('gaming.admin', '1')
        state.isAdmin = true
        // The secondary password additionally unlocks the Settings button.
        state.canSettings = isSettings
        sessionStorage.setItem('gaming.settings', isSettings ? '1' : '0')
        close()
        render()
      } else {
        errorText.classList.remove('hidden')
      }
    }
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
    modal.append(
      el('h2', {}, 'Admin access'),
      el('div', { class: 'field' }, el('label', {}, 'Password'), input, errorText),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
        el('div', { class: 'right' }, el('button', { class: 'btn btn-primary', onclick: submit }, 'Unlock'))))
    setTimeout(() => input.focus(), 0)
  })
}

function openSettings() {
  openModal((modal, close) => {
    // Work on a local copy of the track list; saved back on Save.
    let tracks = (state.settings.main_audio_tracks || []).map((t) => ({ url: t.url, volume: clampVolume(t.volume) }))
    if (!tracks.length) tracks = [{ url: '', volume: 100 }]

    const list = el('div', { class: 'audio-tracks' })
    const renderTracks = () => {
      list.innerHTML = ''
      tracks.forEach((track, i) => {
        const url = el('input', {
          value: track.url,
          placeholder: 'https://youtu.be/…  (YouTube URL)',
        })
        const thumb = el('div', { class: 'thumb-strip' })
        const refreshThumb = () => {
          thumb.innerHTML = ''
          const t = thumbnailUrl(url.value)
          if (t) thumb.append(el('img', { src: t, alt: 'audio video thumbnail' }))
        }
        url.addEventListener('input', () => { track.url = url.value; refreshThumb() })
        refreshThumb()

        // Per-track volume with a live read-out. If this track happens to be the
        // one currently playing, preview the change on the running player too.
        const readout = el('span', { class: 'hint', style: 'min-width:3.5ch' }, `${track.volume}%`)
        const slider = el('input', { type: 'range', min: '0', max: '100', value: String(track.volume) })
        slider.addEventListener('input', () => {
          track.volume = Number(slider.value)
          readout.textContent = `${slider.value}%`
          if (mainAudioPlayer && mainAudioPlayer.setVolume && youTubeId(url.value) === currentAudioId) {
            currentAudioVolume = track.volume
            mainAudioPlayer.setVolume(track.volume)
          }
        })

        const removeBtn = el('button', {
          class: 'btn btn-ghost audio-track-remove', type: 'button', title: 'Remove track',
          onclick: () => {
            tracks.splice(i, 1)
            if (!tracks.length) tracks.push({ url: '', volume: 100 })
            renderTracks()
          },
        }, '×')

        list.append(el('div', { class: 'audio-track' },
          el('div', { class: 'audio-track-row' }, url, removeBtn),
          thumb,
          el('div', { class: 'field-row', style: 'align-items:center' }, slider, readout)))
      })
    }
    renderTracks()

    const addBtn = el('button', {
      class: 'btn btn-ghost', type: 'button',
      onclick: () => { tracks.push({ url: '', volume: 100 }); renderTracks() },
    }, '+ Add track')

    const errorText = el('div', { class: 'error-text hidden' })
    const showError = (msg) => { errorText.textContent = msg; errorText.classList.remove('hidden') }

    const saveBtn = el('button', { class: 'btn btn-primary' }, 'Save')
    saveBtn.addEventListener('click', async () => {
      const clean = tracks
        .map((t) => ({ url: (t.url || '').trim(), volume: clampVolume(t.volume) }))
        .filter((t) => t.url)
      for (const t of clean) {
        if (!youTubeId(t.url)) return showError(`“${t.url}” doesn’t look like a YouTube URL.`)
      }
      saveBtn.disabled = true
      errorText.classList.add('hidden')
      try {
        await saveSettings({ main_audio_tracks: clean })
        restartMainAudio() // re-pick a random track from the new list
        close()
      } catch (err) {
        showError(err.message)
        saveBtn.disabled = false
      }
    })

    modal.append(
      el('h2', {}, 'Settings'),
      field('Landing-page audio tracks',
        el('div', { class: 'hint' }, 'One of these plays at random as the soundtrack, at its own volume. Background visuals stay as random trailers from the list.'),
        list, addBtn),
      errorText,
      el('div', { class: 'modal-actions' },
        el('span'),
        el('div', { class: 'right' },
          el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
          saveBtn)))
  })
}

function openGameForm(game) {
  const isEdit = Boolean(game)
  const rel = game ? releaseToForm(game.release_date, game.release_precision) : { precision: 'unknown', year: '', month: '', day: '' }
  let images = game ? [...(game.images || [])] : []
  // Normalize any legacy platform names to the current selectable set so editing
  // an old game migrates it cleanly on save.
  const platforms = new Set((game?.platforms || []).map(canonicalPlatform).filter(Boolean))
  const storeLinks = { ...(game?.store_links || {}) }

  openModal((modal, close) => {
    const f = {
      title: el('input', { value: game?.title || '' }),
      genre: el('input', { value: game?.genre || '', placeholder: 'e.g. Action RPG' }),
      tags: el('input', { value: (game?.tags || []).join(', '), placeholder: 'souls-like, co-op, open-world' }),
      description: el('textarea', { rows: '3' }),
      trailer: el('input', { value: game?.trailer_url || '', placeholder: 'https://youtu.be/…' }),
    }
    f.description.value = game?.description || ''

    // Release date controls
    const precision = el('select', {}, ...PRECISIONS.map((p) =>
      el('option', { value: p, ...(p === rel.precision ? { selected: '' } : {}) }, p === 'unknown' ? 'Unknown / TBA' : `By ${p}`)))
    const year = el('input', { type: 'number', placeholder: 'Year', value: rel.year })
    const month = el('select', {}, el('option', { value: '' }, 'Month'),
      ...MONTHS.map((name, i) => el('option', { value: String(i + 1), ...(String(i + 1) === rel.month ? { selected: '' } : {}) }, name)))
    const day = el('input', { type: 'number', min: '1', max: '31', placeholder: 'Day', value: rel.day })
    const dateRow = el('div', { class: 'field-row' }, precision)
    const syncDateRow = () => {
      dateRow.innerHTML = ''
      dateRow.append(precision)
      // Day / month / year order.
      if (precision.value === 'day') dateRow.append(day)
      if (precision.value === 'month' || precision.value === 'day') dateRow.append(month)
      if (precision.value !== 'unknown') dateRow.append(year)
    }
    precision.addEventListener('change', syncDateRow)
    syncDateRow()

    // Trailer thumbnail preview
    const thumbPreview = el('div', { class: 'thumb-strip' })
    const refreshThumb = () => {
      thumbPreview.innerHTML = ''
      const t = thumbnailUrl(f.trailer.value)
      if (t) thumbPreview.append(el('img', { src: t, alt: 'trailer thumbnail' }))
    }
    f.trailer.addEventListener('input', refreshThumb)
    refreshThumb()

    // Tag suggestions: every tag used on any other game, as buttons that add it
    // to the comma-separated field. Already-entered tags are hidden.
    const allTags = [...new Set(state.games.flatMap((g) => g.tags || []))].sort((a, b) => a.localeCompare(b))
    const tagSuggest = el('div', { class: 'tag-suggest' })
    const currentTags = () => f.tags.value.split(',').map((t) => t.trim()).filter(Boolean)
    const renderTagSuggest = () => {
      tagSuggest.innerHTML = ''
      const have = new Set(currentTags().map((t) => t.toLowerCase()))
      const available = allTags.filter((t) => !have.has(t.toLowerCase()))
      available.forEach((t) => {
        tagSuggest.append(el('button', {
          type: 'button', class: 'chip tag-suggest-chip',
          onclick: () => {
            f.tags.value = [...currentTags(), t].join(', ')
            renderTagSuggest()
          },
        }, '+ ', t))
      })
    }
    f.tags.addEventListener('input', renderTagSuggest)
    renderTagSuggest()

    // Per-platform store links: one input per selected platform, revealed as you
    // toggle platforms on. Clicking a platform logo in the list opens its link.
    const storeLinksWrap = el('div', { class: 'store-links' })
    const renderStoreLinks = () => {
      storeLinksWrap.innerHTML = ''
      const selected = PLATFORMS.filter((p) => platforms.has(p))
      if (!selected.length) return
      storeLinksWrap.append(el('div', { class: 'hint' }, 'Store links (optional) — the platform logo in the list links here.'))
      selected.forEach((name) => {
        const input = el('input', { value: storeLinks[name] || '', placeholder: `https://…  ${name} store page` })
        input.addEventListener('input', () => {
          const v = input.value.trim()
          if (v) storeLinks[name] = v
          else delete storeLinks[name]
        })
        storeLinksWrap.append(el('div', { class: 'store-link-row' },
          el('span', { class: 'store-link-label' }, name), input))
      })
    }

    // Platform multi-select (toggle chips; mark as many as apply). Rebuildable
    // so Autofill can reflect platforms it adds.
    const platformChips = el('div', { class: 'chip-select' })
    const renderPlatformChips = () => {
      platformChips.innerHTML = ''
      PLATFORMS.forEach((name) => {
        const chip = el('button', {
          type: 'button',
          class: `chip ${platforms.has(name) ? 'active' : ''}`,
        }, name)
        chip.addEventListener('click', () => {
          if (platforms.has(name)) platforms.delete(name)
          else platforms.add(name)
          chip.classList.toggle('active')
          renderStoreLinks()
        })
        platformChips.append(chip)
      })
    }
    renderPlatformChips()
    renderStoreLinks()

    // ---- Title typeahead (store-catalog lookup) --------------------------
    // As you type a title, suggest real games (with the platforms each is on).
    // Pick one and it fills platforms + store links + cover instantly, then
    // fetches a description from Steam in the background (best-effort).
    const titleSuggest = el('div', { class: 'title-suggest' })
    const descNote = el('div', { class: 'hint hidden' })

    // The small platform logos shown on each suggestion row.
    const suggestPlatformIcons = (platformSet) => {
      const keys = [...new Set([...platformSet].map(platformIconKey).filter(Boolean))]
      return PLATFORM_ICON_ORDER.filter((k) => keys.includes(k))
        .map((k) => el('span', { class: 'suggest-plat', title: PLATFORM_ICONS[k].label }, platformIconSvg(k)))
    }

    const applyCatalog = (rec) => {
      f.title.value = rec.name // use the store's canonical name
      rec.platforms.forEach((p) => { if (PLATFORMS.includes(p)) platforms.add(p) })
      renderPlatformChips()
      for (const [k, v] of Object.entries(rec.store_links)) if (v && !storeLinks[k]) storeLinks[k] = v
      renderStoreLinks()
      if (rec.cover && !images.length) { images.push(rec.cover); renderImages() }

      // Description/genre/release: background, non-blocking, Steam-only.
      descNote.classList.remove('error')
      descNote.classList.add('hidden')
      if (rec.steamAppId) {
        descNote.textContent = 'Fetching description from Steam…'
        descNote.classList.remove('hidden')
        fetchSteamDetails(rec.steamAppId)
          .then((d) => {
            if (d.description && !f.description.value.trim()) f.description.value = d.description
            if (d.genre && !f.genre.value.trim()) f.genre.value = d.genre
            if (d.release && precision.value === 'unknown') {
              precision.value = d.release.precision
              year.value = d.release.year || ''
              month.value = d.release.month || ''
              day.value = d.release.day || ''
              syncDateRow()
            }
            descNote.classList.add('hidden')
          })
          .catch((err) => {
            // Visible so we can tell deployed-but-failing from not-deployed.
            descNote.textContent = `Steam description unavailable: ${err.message}`
            descNote.classList.add('error')
            descNote.classList.remove('hidden')
          })
      }
    }

    let suggestSeq = 0
    let suggestTimer = null
    let suggestRefreshing = false
    const closeSuggest = () => { titleSuggest.innerHTML = ''; titleSuggest.classList.remove('open') }
    const renderRecs = (recs) => {
      titleSuggest.innerHTML = ''
      if (!recs.length) { closeSuggest(); return }
      titleSuggest.classList.add('open')
      recs.forEach((rec) => {
        titleSuggest.append(el('button', {
          type: 'button', class: 'suggest-item',
          // mousedown (not click) so it fires before the input's blur hides us.
          onmousedown: (e) => { e.preventDefault(); applyCatalog(rec); closeSuggest() },
        },
          rec.cover ? el('img', { src: rec.cover, alt: '', loading: 'lazy' }) : el('span', { class: 'suggest-noimg' }),
          el('span', { class: 'suggest-name' }, rec.name),
          el('span', { class: 'suggest-plats' }, ...suggestPlatformIcons(rec.platforms))))
      })
    }
    const runSuggest = async () => {
      const q = f.title.value
      if (q.trim().length < 2) { closeSuggest(); return }
      const seq = ++suggestSeq
      titleSuggest.classList.add('open')
      titleSuggest.innerHTML = ''
      titleSuggest.append(el('div', { class: 'suggest-loading' }, 'Searching…'))
      let recs = []
      try { recs = await searchCatalog(q) } catch { /* offline / blocked — silent */ }
      if (seq !== suggestSeq) return // a newer keystroke superseded this
      renderRecs(recs)
      // Initial results may come from the fast single-letter index; once the full
      // catalog finishes loading, re-run so mid-title matches ("silksong") appear.
      if (!fullIndex && !suggestRefreshing) {
        suggestRefreshing = true
        ensureFullCatalog().then(() => {
          suggestRefreshing = false
          if (document.activeElement === f.title) runSuggest()
        })
      }
    }
    f.title.addEventListener('input', () => { clearTimeout(suggestTimer); suggestTimer = setTimeout(runSuggest, 250) })
    f.title.addEventListener('blur', () => setTimeout(closeSuggest, 150))
    ensureFullCatalog() // warm the full index in the background as soon as the form opens

    // Image upload + paste-URL
    const imageStrip = el('div', { class: 'thumb-strip' })
    const renderImages = () => {
      imageStrip.innerHTML = ''
      images.forEach((url) => {
        imageStrip.append(el('div', { class: 'thumb' },
          el('img', { src: url, alt: '' }),
          el('button', { type: 'button', class: 'remove', onclick: () => { images = images.filter((u) => u !== url); renderImages() } }, '×')))
      })
    }
    renderImages()
    const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: '' })
    const uploadHint = el('div', { class: 'hint hidden' }, 'Uploading…')
    fileInput.addEventListener('change', async (e) => {
      const files = [...e.target.files]
      if (!files.length) return
      uploadHint.classList.remove('hidden')
      errorText.classList.add('hidden')
      try {
        for (const file of files) images.push(await uploadImage(file))
        renderImages()
      } catch (err) {
        showError(`Image upload failed: ${err.message}. (Tip: paste an image URL below instead.)`)
      } finally {
        uploadHint.classList.add('hidden')
        fileInput.value = ''
      }
    })
    const imageUrlInput = el('input', { placeholder: 'or paste an image URL and press Enter' })
    imageUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && imageUrlInput.value.trim()) {
        e.preventDefault()
        images.push(imageUrlInput.value.trim())
        imageUrlInput.value = ''
        renderImages()
      }
    })

    const errorText = el('div', { class: 'error-text hidden' })
    const showError = (msg) => { errorText.textContent = msg; errorText.classList.remove('hidden') }

    const saveBtn = el('button', { class: 'btn btn-primary' }, isEdit ? 'Save' : 'Add game')
    saveBtn.addEventListener('click', async () => {
      if (!f.title.value.trim()) return showError('Title is required.')
      if (f.trailer.value && !youTubeId(f.trailer.value)) return showError('That trailer URL doesn’t look like a YouTube link.')
      saveBtn.disabled = true
      errorText.classList.add('hidden')
      const payload = {
        title: f.title.value.trim(),
        genre: f.genre.value.trim() || null,
        tags: f.tags.value.split(',').map((t) => t.trim()).filter(Boolean),
        platforms: [...platforms],
        // Only keep links for platforms that are still selected and non-empty.
        store_links: Object.fromEntries(
          [...platforms]
            .map((p) => [p, (storeLinks[p] || '').trim()])
            .filter(([, v]) => v)
        ),
        description: f.description.value.trim() || null,
        trailer_url: f.trailer.value.trim() || null,
        images,
        ...buildReleaseDate({ precision: precision.value, year: year.value, month: month.value, day: day.value }),
      }
      try {
        if (isEdit) await updateGame(game.id, payload)
        else await createGame(payload)
        close()
        await reload()
      } catch (err) {
        showError(err.message)
        saveBtn.disabled = false
      }
    })

    const deleteBtn = isEdit
      ? el('button', { class: 'btn btn-danger', onclick: async () => {
          if (!confirm(`Delete "${game.title}"?`)) return
          await deleteGame(game.id)
          close()
          await reload()
        } }, 'Delete')
      : el('span')

    modal.append(
      el('h2', {}, isEdit ? 'Edit game' : 'Add game'),
      field('Title *', el('div', { class: 'title-field' }, f.title, titleSuggest), descNote),
      field('Genre', f.genre),
      field('Tags (comma separated)', f.tags, tagSuggest),
      field('Platforms', platformChips, storeLinksWrap),
      field('Description', f.description),
      field('Trailer (YouTube URL)', f.trailer, thumbPreview),
      field('Release date', dateRow),
      field('Images', fileInput, uploadHint, imageStrip, imageUrlInput),
      errorText,
      el('div', { class: 'modal-actions' },
        deleteBtn,
        el('div', { class: 'right' },
          el('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'),
          saveBtn)))
    setTimeout(() => f.title.focus(), 0)
  })
}

function field(label, ...controls) {
  return el('div', { class: 'field' }, el('label', {}, label), ...controls)
}

/* ============================================================
   Boot
   ============================================================ */
async function reload() {
  state.loading = true
  state.error = null
  render()
  try {
    state.games = await fetchGames()
  } catch (e) {
    state.error = e.message
  } finally {
    state.loading = false
    render()
    startBackgroundTrailers()
  }
}

// Global key handling: ESC closes the fullscreen view or any modal.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (!$('#detail').classList.contains('hidden')) { closeDetail(); return }
  if ($('#modalRoot').innerHTML) $('#modalRoot').innerHTML = ''
})

$('#search').addEventListener('input', (e) => {
  state.query = e.target.value
  renderRows()
})

$('#releasedToggle').addEventListener('click', () => {
  state.showReleased = !state.showReleased
  render()
})

reload()
fetchSettings().then(startMainAudio)
