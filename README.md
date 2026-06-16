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

## One-time Supabase setup

1. In your Supabase project, open **SQL Editor** and run
   [`supabase/schema.sql`](supabase/schema.sql). It creates the `games` table,
   opens read/write access (friends-only site, no real auth), and creates a
   public `game-media` storage bucket for uploaded images.
2. The project URL + anon key are already filled into `app.js` (top of file).
   These are public values, which is fine here.

### Landing-page soundtrack + volume

These are edited in-app: enter admin mode, click **Settings**. They're stored in
the shared `settings` table so everyone sees the same values.

- **Landing-page audio** — a YouTube URL used as the soundtrack. The blurred
  background still shows **random** trailers from the list (muted); the audio
  comes from this one chosen video. Blank = silent landing page. (Browsers won't
  autoplay sound until you click/press a key once — it starts on first
  interaction.)
- **Landing audio volume** / **Game trailer starting volume** — 0–100.

The starting defaults (used until the Settings row is saved) live in
`DEFAULT_SETTINGS` at the top of `app.js`.

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
