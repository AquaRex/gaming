import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

// When env vars are missing we still export a client-shaped object so the app
// can boot and show a friendly "configure Supabase" message instead of crashing.
export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey)
  : null

export const MEDIA_BUCKET = 'game-media'
