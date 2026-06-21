# Gaming

A small, good-looking site for me and my friends to track games to play and when
they release. Searchable / filterable / sortable list with blurred trailers in
the background; click a game and it goes fullscreen with its trailer playing.

**No build step.** This is plain HTML/CSS/JS. The files in this repo *are* the
website — GitHub Pages serves them exactly as-is. Open `index.html` through any
web server and it runs.

## Files

| File | What it is |
|------|------------|
| `index.html` | The page shell + mount points |
| `styles.css` | All styling |
| `app.js` | All behaviour (list, search, filters, sort, fullscreen view, admin) |
| `favicon.svg` | Tab icon |
| `supabase/schema.sql` | One-time database setup |
| `supabase/functions/igdb/` | Edge Function that powers **Autofill** (IGDB lookup) |

## One-time Supabase setup

1. In your Supabase project, open **SQL Editor** and run
   [`supabase/schema.sql`](supabase/schema.sql). It creates the `games` table,
   opens read/write access (friends-only site, no real auth), and creates a
   public `game-media` storage bucket for uploaded images.
2. The project URL + anon key are already filled into `app.js` (top of file).
   These are public values, which is fine here.

### Landing-page soundtrack + volume

- **Which video is the soundtrack** is shared: enter admin mode → **Settings** →
  paste a YouTube URL. It's stored in the `settings` table so everyone hears the
  same track. The blurred background still shows **random** trailers from the
  list (muted); only the audio comes from this one chosen video. Blank = silent.
  (Browsers won't autoplay sound until you click/press a key once.)
- **Volume is per-person and client-side** (saved in your browser, never in the
  DB). There's no on-screen volume slider — instead, set the volume/mute on any
  game **trailer** using YouTube's own controls, and that level is remembered and
  reused for the hidden background music too.

The starting volume default lives in `DEFAULT_SETTINGS.volume` at the top of
`app.js`.

### Autofill from IGDB (the ✨ Autofill button)

The add/edit form can pull a game's **description, genre, platforms, store links,
release date and cover** from [IGDB](https://www.igdb.com/) — you just type the
title and click **Autofill** (tags stay manual). IGDB can't be called from the
browser (no CORS, and its Twitch auth needs a secret), so a tiny **Supabase Edge
Function** (`supabase/functions/igdb`) does it server-side. The secrets live in
Supabase, never in this repo.

One-time setup:

1. **Get Twitch credentials.** Create a Twitch account, enable 2FA, then at
   [dev.twitch.tv](https://dev.twitch.tv) → *Your Console* → *Applications* →
   *Register Your Application*. Use OAuth redirect `http://localhost`, client type
   **Confidential**. Copy the **Client ID** and generate a **Client Secret**.
   (IGDB authenticates purely with these — no separate IGDB signup.)
2. **Deploy the function.** In the Supabase dashboard → **Edge Functions** →
   *Create a function* named `igdb`, and paste in
   [`supabase/functions/igdb/index.ts`](supabase/functions/igdb/index.ts).
3. **Add the secrets** (Edge Functions → *Secrets* / *Manage secrets*):
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`

   These are read by the function at runtime and are **never** committed to the
   repo. Leave "Verify JWT" on — the site calls the function with the public anon
   key, which satisfies it.

If the secrets are missing or the function isn't deployed, Autofill just shows an
error and you fill the form in by hand — nothing else breaks.

## Run it locally

You can't just double-click `index.html` (the `file://` protocol blocks the
Supabase request). Serve it with any static server, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Using it

- Click **Admin** (top-right), enter the password (**4054**) to unlock editing.
- **+ Add game**: title, genre, tags, description, a YouTube trailer URL, a fuzzy
  release date (day / month / year / unknown), and images (upload or paste a URL).
- Click any row → the game fills the screen with its trailer behind it. Move the
  mouse to see the title/description/genre/tags; stop and they fade away.
  **Esc** (or the top-left link) returns to the list.
- Sort by clicking a column header; filter with the genre/tag chips; search
  across everything.

## Deploying (GitHub Pages)

Just push to the branch GitHub Pages serves (Settings → Pages → "Deploy from a
branch" → `main` / root). Since these are already plain static files, the live
site updates with no build. The app uses relative paths, so it works whether
it's served at the domain root or under a subpath like `hetland.dev/gaming/`.
