#!/usr/bin/env python3
"""Local test server that emulates GitHub Pages for the Gaming site.

`npm run dev` (Vite) is great for editing, but it does NOT exercise the two
things that only matter on GitHub Pages: the `/gaming/` base path and the
`404.html` SPA redirect trick that makes deep links like /gaming/bloodmessage
survive a refresh. This script builds the production bundle and serves `dist/`
the way GitHub Pages will, so you can sanity-check the real deployed behaviour
before pushing.

Behaviour mirrored from GitHub Pages:
  - the app is mounted under /gaming/
  - "/" (and a bare "/gaming") redirect to "/gaming/"
  - any path with no matching file falls back to 404.html (which then runs the
    SPA redirect into index.html) — exactly what GitHub Pages does

Usage:
  python3 dev-server.py                # build, then serve at /gaming/ on :8000
  python3 dev-server.py --port 9000    # pick a port
  python3 dev-server.py --no-build     # serve the existing dist/ as-is
  python3 dev-server.py --open         # open a browser when ready
"""

import argparse
import mimetypes
import os
import subprocess
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
BASE = "/gaming"  # keep in sync with vite base + router basename


class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self._serve(head_only=True)

    def do_GET(self):
        self._serve(head_only=False)

    def _serve(self, head_only):
        path = unquote(urlparse(self.path).path)

        # Send the root (and a bare "/gaming") to the app mount point.
        if path == "/" or path == BASE:
            self._redirect(BASE + "/")
            return
        if not path.startswith(BASE + "/"):
            self._redirect(BASE + "/")
            return

        rel = path[len(BASE) + 1:]
        if rel == "" or rel.endswith("/"):
            rel += "index.html"

        target = (DIST / rel).resolve()
        # Guard against path traversal outside dist/.
        if target != DIST and DIST not in target.parents:
            self._send_404(head_only)
            return

        if target.is_file():
            self._send_file(target, 200, head_only)
        else:
            # No file here -> GitHub Pages serves 404.html, which redirects the
            # clean URL into index.html. Replicate that so deep links work.
            self._send_404(head_only)

    def _send_file(self, target, status, head_only):
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head_only:
            self.wfile.write(data)

    def _send_404(self, head_only):
        fallback = DIST / "404.html"
        if fallback.is_file():
            self._send_file(fallback, 404, head_only)
        else:
            self.send_error(404, "Not found (and no 404.html in dist/)")

    def _redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))


def build():
    print("Building production bundle (npm run build)…")
    npm = "npm.cmd" if os.name == "nt" else "npm"
    try:
        subprocess.run([npm, "run", "build"], cwd=ROOT, check=True)
    except FileNotFoundError:
        sys.exit("✗ npm not found. Install Node.js, or use --no-build after building manually.")
    except subprocess.CalledProcessError as e:
        sys.exit(f"✗ Build failed (exit code {e.returncode}).")


def main():
    parser = argparse.ArgumentParser(
        description="Serve the built Gaming site locally, emulating GitHub Pages."
    )
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--no-build", action="store_true", help="serve existing dist/ without rebuilding")
    parser.add_argument("--open", action="store_true", help="open the site in a browser")
    args = parser.parse_args()

    if not args.no_build:
        build()

    if not (DIST / "index.html").is_file():
        sys.exit("✗ dist/index.html not found. Run without --no-build, or `npm run build` first.")

    url = f"http://{args.host}:{args.port}{BASE}/"
    print("\n  Gaming — production build (GitHub Pages emulation)")
    print(f"  ➜  {url}")
    print("  Ctrl+C to stop.\n")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
