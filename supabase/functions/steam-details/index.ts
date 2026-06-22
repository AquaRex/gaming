// ============================================================
// Steam details — Supabase Edge Function (Deno).
//
// Best-effort enrichment for the add-game form: given a Steam app id (which the
// store catalog already gives us), return a short description, genre and a fuzzy
// release date. Steam's public `appdetails` endpoint has no CORS, so the browser
// can't call it directly — this tiny proxy does, server-side.
//
// No secrets, no auth keys — it just forwards to Steam. If it isn't deployed the
// site still works fully; the form simply doesn't get an auto description.
// ============================================================

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

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

// Steam's free-text date → this site's { precision, year, month, day }.
function parseSteamDate(rd: any): { precision: string; year: string; month: string; day: string } | null {
  const s = String(rd?.date || '').trim()
  if (!s) return null
  let m = s.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/) // 12 Mar, 2025
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()]
    if (mon) return { precision: 'day', year: m[3], month: String(mon), day: String(Number(m[1])) }
  }
  m = s.match(/^([A-Za-z]+)\s+(\d{4})$/) // March 2025
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()]
    if (mon) return { precision: 'month', year: m[2], month: String(mon), day: '' }
  }
  m = s.match(/^Q[1-4]\s+(\d{4})$/i) // Q1 2025
  if (m) return { precision: 'year', year: m[1], month: '', day: '' }
  m = s.match(/^(\d{4})$/) // 2025
  if (m) return { precision: 'year', year: m[1], month: '', day: '' }
  return null // "Coming soon", "To be announced", etc. → leave as TBA
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { appid } = await req.json()
    if (!appid || !/^\d+$/.test(String(appid))) return json({ error: 'Provide a numeric Steam "appid".' }, 400)

    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`)
    if (!res.ok) return json({ error: `Steam responded ${res.status}` }, 502)
    const payload = await res.json()
    const entry = payload?.[String(appid)]
    if (!entry?.success || !entry.data) return json({ description: '', genre: '', release: null })

    const d = entry.data
    return json({
      description: d.short_description || '',
      genre: d.genres?.[0]?.description || '',
      release: parseSteamDate(d.release_date),
    })
  } catch (err) {
    return json({ error: String((err as Error)?.message || err) }, 500)
  }
})
