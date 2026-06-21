// ============================================================
// IGDB proxy — Supabase Edge Function (Deno).
//
// Why this exists: IGDB (and its Twitch auth) can't be called from the
// browser — no CORS, and the OAuth token exchange needs the client secret,
// which must never ship to a public page. This function runs server-side:
// it swaps the Twitch client id/secret for an app token (client-credentials
// grant), queries IGDB, maps the result to this site's shape, and returns it.
//
// Secrets are read from the environment — set them in the Supabase dashboard
// (Edge Functions → Secrets), NOT in this file or the repo:
//   TWITCH_CLIENT_ID      — your Twitch app's Client ID
//   TWITCH_CLIENT_SECRET  — your Twitch app's Client Secret
//
// The browser calls it with `db.functions.invoke('igdb', { body: { q } })`.
// ============================================================

const TWITCH_CLIENT_ID = Deno.env.get('TWITCH_CLIENT_ID') ?? ''
const TWITCH_CLIENT_SECRET = Deno.env.get('TWITCH_CLIENT_SECRET') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

// ---- Twitch app token (client-credentials), cached across warm invocations ----
let cachedToken: { token: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: TWITCH_CLIENT_ID,
      client_secret: TWITCH_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  })
  if (!res.ok) throw new Error(`Twitch token error ${res.status}: ${await res.text()}`)
  const data = await res.json()
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return cachedToken.token
}

async function igdb(endpoint: string, query: string, token: string) {
  const res = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'text/plain',
    },
    body: query,
  })
  if (!res.ok) throw new Error(`IGDB error ${res.status}: ${await res.text()}`)
  return res.json()
}

// ---- Mapping IGDB → this site's shape ----

// IGDB platform names → the site's canonical selectable platforms.
function mapPlatform(name: string): string | null {
  const s = (name || '').toLowerCase()
  if (s.includes('vr') || s.includes('quest') || s.includes('oculus') || s.includes('vive')) return 'VR'
  if (s.includes('playstation') || s.startsWith('ps')) return 'PlayStation'
  if (s.includes('xbox')) return 'Xbox'
  if (s.includes('switch') || s.includes('nintendo')) return 'Switch'
  if (s.includes('mac')) return 'Mac'
  if (s.includes('linux')) return 'Linux'
  if (s.includes('windows') || s === 'pc' || s.includes('pc (')) return 'PC'
  return null
}

// IGDB website categories (PC storefronts).
const WEB_STEAM = 13, WEB_EPIC = 16, WEB_GOG = 17
// IGDB external_games categories (console storefronts).
const EXT_MICROSOFT = 11, EXT_XBOX = 31, EXT_PSN_US = 36

// IGDB release_date `category` → this site's fuzzy precision.
function mapRelease(releaseDates: any[]): { precision: string; year: string; month: string; day: string } | null {
  const dated = (releaseDates || []).filter((r) => typeof r.date === 'number')
  if (!dated.length) return null
  dated.sort((a, b) => a.date - b.date)
  const r = dated[0]
  const d = new Date(r.date * 1000)
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate()
  const cat = r.category
  if (cat === 7) return { precision: 'unknown', year: '', month: '', day: '' } // TBD
  let precision = 'day'
  if (cat === 2 || (cat >= 3 && cat <= 6)) precision = 'year'      // YYYY or quarter
  else if (cat === 1) precision = 'month'                          // YYYY-MM
  return {
    precision,
    year: String(y),
    month: precision === 'year' ? '' : String(m),
    day: precision === 'day' ? String(day) : '',
  }
}

function mapGame(g: any) {
  if (!g?.name) return null

  const platforms = [...new Set((g.platforms || []).map((p: any) => mapPlatform(p.name)).filter(Boolean))]

  // Store links. Steam (and Epic/GOG as fallback) → the PC/Steam group; the
  // PlayStation/Xbox stores come from external_games when IGDB has a URL.
  const store: Record<string, string> = {}
  for (const w of g.websites || []) {
    if (w.category === WEB_STEAM && w.url && !store.PC) store.PC = w.url
  }
  for (const w of g.websites || []) {
    if ((w.category === WEB_EPIC || w.category === WEB_GOG) && w.url && !store.PC) store.PC = w.url
  }
  for (const e of g.external_games || []) {
    if (!e.url) continue
    if (e.category === EXT_PSN_US && !store.PlayStation) store.PlayStation = e.url
    if ((e.category === EXT_MICROSOFT || e.category === EXT_XBOX) && !store.Xbox) store.Xbox = e.url
  }

  const cover = g.cover?.image_id
    ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`
    : null

  const year = typeof g.first_release_date === 'number'
    ? String(new Date(g.first_release_date * 1000).getUTCFullYear())
    : ''

  return {
    name: g.name,
    year,
    cover,
    summary: g.summary || '',
    genre: g.genres?.[0]?.name || '',
    platforms,
    store_links: store,
    release: mapRelease(g.release_dates),
  }
}

function buildQuery(q: string): string {
  const safe = q.replace(/["\\]/g, ' ').slice(0, 100)
  return `search "${safe}"; ` +
    `fields name, summary, first_release_date, genres.name, platforms.name, ` +
    `cover.image_id, websites.url, websites.category, ` +
    `external_games.url, external_games.category, ` +
    `release_dates.date, release_dates.category; ` +
    `limit 8;`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    return json({ error: 'Server missing TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET secrets.' }, 500)
  }
  try {
    const { q } = await req.json()
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      return json({ error: 'Provide a game title ("q") of at least 2 characters.' }, 400)
    }
    const token = await getToken()
    const games = await igdb('games', buildQuery(q.trim()), token)
    return json({ results: games.map(mapGame).filter(Boolean) })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})
