import { supabase, MEDIA_BUCKET, isSupabaseConfigured } from './supabase'

export function slugify(title) {
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// Ensure a slug is unique by appending -2, -3, ... if needed.
async function uniqueSlug(base, ignoreId = null) {
  let slug = base || 'game'
  let n = 1
  // Pull all matching prefixes once.
  const { data } = await supabase
    .from('games')
    .select('id, slug')
    .like('slug', `${base}%`)
  const taken = new Set(
    (data || []).filter((r) => r.id !== ignoreId).map((r) => r.slug)
  )
  while (taken.has(slug)) {
    n += 1
    slug = `${base}-${n}`
  }
  return slug
}

export async function fetchGames() {
  if (!isSupabaseConfigured) return []
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function fetchGameBySlug(slug) {
  if (!isSupabaseConfigured) return null
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function createGame(values) {
  const base = slugify(values.title)
  const slug = await uniqueSlug(base)
  const { data, error } = await supabase
    .from('games')
    .insert({ ...values, slug })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateGame(id, values) {
  // Keep slug stable unless the title changed enough to need a new base.
  const patch = { ...values }
  if (values.title) {
    const base = slugify(values.title)
    patch.slug = await uniqueSlug(base, id)
  }
  const { data, error } = await supabase
    .from('games')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteGame(id) {
  const { error } = await supabase.from('games').delete().eq('id', id)
  if (error) throw error
}

// Upload an image File to the media bucket, return its public URL.
export async function uploadImage(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `images/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path)
  return data.publicUrl
}
