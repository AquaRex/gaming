# Gaming

A small, good-looking site for you and your friends to track games to play and
their release dates. Searchable, filterable, sortable list with blurred trailer
videos in the background; click a game for a fullscreen trailer page.

Built with **React + Vite** and **Supabase** (Postgres + Storage).

> Security is intentionally minimal — this is a private friends-only site. The
> "admin" password (default `4054`) only hides the edit UI; anyone technical can
> still write to the database. That's a deliberate trade-off, not a bug.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste and run [`supabase/schema.sql`](supabase/schema.sql).
   It creates the `games` table, opens read/write access, and creates a public
   `game-media` storage bucket for images.
3. In **Project Settings → API**, copy the **Project URL** and the **anon public**
   key.

## 2. Configure the app

```bash
cp .env.example .env
```

Edit `.env`:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
VITE_ADMIN_PASSWORD=4054
```

## 3. Run

```bash
npm install
npm run dev
```

Open http://localhost:5173.

## Using it

- Click **Admin** (top-right), enter the password to unlock add/edit.
- **+ Add game** to create one: title, genre, tags, description, release date
  (with day / month / year / unknown precision), a YouTube trailer URL, and
  uploaded images.
- Click any row to open `/<slug>` — the fullscreen trailer. Move the mouse to
  see the title/description/genre/tags; stop moving and they fade away. **Esc**
  returns to the list.
- Sort by clicking a column header in the legend; filter with the genre/tag
  chips; search across everything.

## Deploying (GitHub Pages)

This deploys as a **GitHub Pages project site** served at
`https://hetland.dev/gaming/`. The config is already wired for that subpath:

- `vite.config.js` → `base: '/gaming/'`
- `src/main.jsx` → `<BrowserRouter basename="/gaming">`
- `public/404.html` → `pathSegmentsToKeep = 1`

GitHub Pages has no server-side rewrites, so deep links like
`/gaming/bloodmessage` are handled with the SPA redirect trick
([rafgraph/spa-github-pages](https://github.com/rafgraph/spa-github-pages)):
`404.html` stashes the path in a query string and bounces to `index.html`, where
a snippet in `<head>` restores it. Clean URLs, no hash.

**To deploy:**

1. Push this repo to GitHub.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` — [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
   builds and publishes `dist/` automatically.

The build reads `.env.production` (committed, public values), so CI needs no
secrets.

> Moving the app to a different path? Change all three values above (e.g. for the
> domain root use `base: '/'`, `basename="/"`, `pathSegmentsToKeep = 0`).

## Notes on background trailers

The blurred background uses YouTube embeds (muted autoplay, looping). YouTube
sometimes shows end-screens/branding over embeds — unavoidable with their
player. If you ever want pixel-perfect backgrounds, upload short clips to the
`game-media` bucket and swap the iframe for a `<video>` element.
