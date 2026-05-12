### Tele Download

Telegram bot for inspecting `yt-dlp` video formats, letting the user choose a preferred size, and either uploading the result back into Telegram or serving it as a temporary 1-hour download link when the file is too large for bot uploads.

#### Setup

1. Copy `.env.example` to `.env`
2. Set `BOT_TOKEN`
3. Set `PUBLIC_BASE_URL` to the public URL users will open for temporary downloads
4. Add allowed Telegram user IDs in `src/config/allowedUsers.ts`
5. Run `npm run dev`

#### Environment

- `PUBLIC_BASE_URL` must be a public absolute URL that points at this app's embedded HTTP server, usually through a reverse proxy
- `HTTP_PORT` controls the embedded HTTP server used for temporary download links
- `TEMP_FILE_TTL_MS` defaults to 1 hour
- `SELECTION_TTL_MS` defaults to 15 minutes

#### Production

Build and run the compiled bot directly:

```bash
npm ci
npm run build
node dist/index.js
```

#### Docker

Build and run with Docker Compose:

```bash
cp .env.example .env
# set BOT_TOKEN and PUBLIC_BASE_URL in .env first
docker compose up --build -d
```

Stop it with:

```bash
docker compose down
```

The compose setup stores temporary downloads in a named Docker volume mounted at `/tmp/tele-download`, and exposes the embedded HTTP server on `HTTP_PORT`. In production you will usually place a reverse proxy or public domain in front of that port and point `PUBLIC_BASE_URL` at the externally reachable URL.

Inside Docker, the app uses the container's installed `ffmpeg` and `ffprobe` for compatibility, while local non-Docker runs still default to the bundled binaries in `bin/`.

#### Commands

- `/start`
- `/help`
- `/supported`
- `/download <url1> <url2> ...`

You can also paste multiple links in a normal message. The bot will inspect each link, show curated format buttons, and wait for your selection before downloading.
