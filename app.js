/* ============================================================
   Gaming — a single static site, no build step.
   The browser runs this file directly. GitHub Pages serves it raw.
   ============================================================ */

// ---- Config (public values; this is a friends-only site) ----
const SUPABASE_URL = 'https://fsfagnwonxsmnozapwsd.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZzZmFnbndvbnhzbW5vemFwd3NkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA5MzYsImV4cCI6MjA5NzE5NjkzNn0.IXUNmLCyLG38Iq2K3UegQdCticDsYB52xdKQkKYtiVc'
const ADMIN_PASSWORD = '4054'
const MEDIA_BUCKET = 'game-media'

// Defaults for the editable settings (see the Settings tab in admin mode).
// These are used only if the `settings` row in Supabase hasn't been saved yet.
//   main_audio_url:   the landing page shows RANDOM trailers (muted, blurred),
//                     but its soundtrack comes from this one chosen video.
//                     Blank = silent landing page. Browsers block autoplaying
//                     sound until you interact, so it starts on first click/key.
//   *_volume:         0–100.
const DEFAULT_SETTINGS = {
  main_audio_url: 'https://www.youtube.com/watch?v=PZS85WIejTg',
  main_audio_volume: 25,
  detail_volume: 25,
}

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ---- App state ----
const state = {
  games: [],
  query: '',
  activeTags: [],
  activeGenres: [],
  sort: { key: 'title', dir: 'asc' },
  isAdmin: sessionStorage.getItem('gaming.admin') === '1',
  // Shared (from DB): just which video the landing-page audio comes from.
  settings: { main_audio_url: DEFAULT_SETTINGS.main_audio_url },
  loading: true,
  error: null,
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
function embedUrl(url, { blurred } = {}) {
  const id = youTubeId(url)
  if (!id) return null
  const params = new URLSearchParams({
    autoplay: '1', mute: '1', controls: '0', loop: '1', playlist: id,
    modestbranding: '1', rel: '0', iv_load_policy: '3', playsinline: '1',
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
  return y * 10000 + (precision === 'year' ? 0 : m) * 100 + (precision === 'day' ? d : 0)
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
    if (data) state.settings = { main_audio_url: data.main_audio_url ?? '' }
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
   Background trailers
   ============================================================ */
let bgTimer = null
function startBackgroundTrailers() {
  const host = $('#bgTrailers')
  const urls = state.games.map((g) => embedUrl(g.trailer_url, { blurred: true })).filter(Boolean)
  clearInterval(bgTimer)
  host.innerHTML = ''
  if (!urls.length) return

  let index = Math.floor(Math.random() * urls.length)
  const show = () => {
    host.innerHTML = ''
    host.append(el('iframe', { src: urls[index], title: 'background trailer', allow: 'autoplay; encrypted-media', tabindex: '-1' }))
  }
  show()
  if (urls.length > 1) {
    bgTimer = setInterval(() => {
      let next = index
      while (next === index) next = Math.floor(Math.random() * urls.length)
      index = next
      show()
    }, 18000)
  }
}

/* ============================================================
   Main-page audio (one chosen video, played hidden)
   The blurred trailers above are silent; the soundtrack comes from here.
   ============================================================ */
let mainAudioPlayer = null
let audioUnlocked = false

function startMainAudio() {
  const id = youTubeId(state.settings.main_audio_url)
  if (!id) return

  // A small visible YouTube mini-player in the corner — same native controls
  // (volume, mute, play/pause) as the game pages. Starts muted so it autoplays;
  // it unmutes on your first interaction (or use its own mute button).
  let mount = document.getElementById('mainAudio')
  if (!mount) {
    mount = el('div', { id: 'mainAudio', class: 'mini-player' })
    document.body.append(mount)
  }

  loadYouTubeApi().then((YT) => {
    mainAudioPlayer = new YT.Player('mainAudio', {
      width: '240',
      height: '135',
      videoId: id,
      playerVars: {
        autoplay: 1, controls: 1, loop: 1, playlist: id,
        mute: 1, modestbranding: 1, rel: 0, playsinline: 1,
      },
      events: {
        onReady: (e) => {
          e.target.setVolume(DEFAULT_SETTINGS.main_audio_volume)
          e.target.playVideo()
          if (audioUnlocked) e.target.unMute() // play with sound once unlocked
        },
      },
    })
  })
}

// Browsers block autoplaying sound until the user interacts; unmute on the
// first gesture anywhere on the page.
function unlockAudio() {
  if (audioUnlocked) return
  audioUnlocked = true
  if (mainAudioPlayer && mainAudioPlayer.unMute) {
    mainAudioPlayer.unMute()
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
  if (paused) mainAudioPlayer.pauseVideo()
  else if (audioUnlocked) mainAudioPlayer.playVideo()
}

/* ============================================================
   List rendering
   ============================================================ */
const COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'genre', label: 'Genre' },
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
    host.append(
      el('button', { class: 'btn btn-primary', onclick: () => openGameForm(null) }, '+ Add game'),
      el('button', { class: 'btn btn-ghost', onclick: openSettings }, 'Settings'),
      el('button', { class: 'btn btn-ghost', onclick: () => { sessionStorage.removeItem('gaming.admin'); state.isAdmin = false; render() } }, 'Exit admin')
    )
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
    host.append(el('span', { class: 'filter-group-label' }, label))
    for (const v of values) {
      host.append(el('button', {
        class: `chip ${active.includes(v) ? 'active' : ''}`,
        onclick: () => { onToggle(v); render() },
      }, v))
    }
  }
  const toggle = (arr, v) => {
    const i = arr.indexOf(v)
    if (i >= 0) arr.splice(i, 1)
    else arr.push(v)
  }
  group('Genres', allGenres, state.activeGenres, (v) => toggle(state.activeGenres, v))
  group('Tags', allTags, state.activeTags, (v) => toggle(state.activeTags, v))
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
    host.append(el('div', { class: 'game-row', onclick: () => openDetail(game) },
      el('div', { class: 'game-title' },
        game.images && game.images[0] ? el('img', { src: game.images[0], alt: '' }) : null,
        game.title),
      el('div', { class: 'game-genre' }, game.genre || '—'),
      el('div', { class: 'tag-list' }, (game.tags || []).map((t) => el('span', { class: 'tag' }, t))),
      el('div', { class: 'game-date' }, formatReleaseDate(game.release_date, game.release_precision)),
      editBtn))
  }
}

function render() {
  renderTopControls()
  renderFilters()
  renderLegend()
  renderRows()
}

/* ============================================================
   Fullscreen game view (no page navigation — just an overlay)
   ============================================================ */
let idleTimer = null
let detailPlayer = null
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
            e.target.setVolume(DEFAULT_SETTINGS.detail_volume)
            e.target.playVideo()
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
  if (detailPlayer && detailPlayer.destroy) {
    detailPlayer.destroy()
    detailPlayer = null
  }
  host.innerHTML = '' // stops the trailer audio/video
  setMainAudioPaused(false) // resume the landing-page soundtrack
}

/* ============================================================
   Modals: admin login + add/edit game form
   ============================================================ */
function openModal(buildContent) {
  const root = $('#modalRoot')
  const close = () => { root.innerHTML = '' }
  const overlay = el('div', { class: 'modal-overlay', onclick: close })
  const modal = el('div', { class: 'modal', onclick: (e) => e.stopPropagation() })
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
      if (input.value === ADMIN_PASSWORD) {
        sessionStorage.setItem('gaming.admin', '1')
        state.isAdmin = true
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
    const s = state.settings

    const audioUrl = el('input', {
      value: s.main_audio_url || '',
      placeholder: 'https://youtu.be/…  (blank = silent landing page)',
    })
    const thumb = el('div', { class: 'thumb-strip' })
    const refreshThumb = () => {
      thumb.innerHTML = ''
      const t = thumbnailUrl(audioUrl.value)
      if (t) thumb.append(el('img', { src: t, alt: 'audio video thumbnail' }))
    }
    audioUrl.addEventListener('input', refreshThumb)
    refreshThumb()

    const errorText = el('div', { class: 'error-text hidden' })
    const showError = (msg) => { errorText.textContent = msg; errorText.classList.remove('hidden') }

    const saveBtn = el('button', { class: 'btn btn-primary' }, 'Save')
    saveBtn.addEventListener('click', async () => {
      const url = audioUrl.value.trim()
      if (url && !youTubeId(url)) return showError('That audio link doesn’t look like a YouTube URL.')
      saveBtn.disabled = true
      errorText.classList.add('hidden')
      try {
        await saveSettings({ main_audio_url: url || null })
        restartMainAudio() // apply the new soundtrack immediately
        close()
      } catch (err) {
        showError(err.message)
        saveBtn.disabled = false
      }
    })

    modal.append(
      el('h2', {}, 'Settings'),
      field('Landing-page audio (YouTube URL)', audioUrl, thumb,
        el('div', { class: 'hint' }, 'Background visuals stay as random trailers from the list; this is just the soundtrack. Volume is set per-person with the slider on screen.')),
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
      if (precision.value !== 'unknown') dateRow.append(year)
      if (precision.value === 'month' || precision.value === 'day') dateRow.append(month)
      if (precision.value === 'day') dateRow.append(day)
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
      field('Title *', f.title),
      field('Genre', f.genre),
      field('Tags (comma separated)', f.tags),
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

reload()
fetchSettings().then(startMainAudio)
