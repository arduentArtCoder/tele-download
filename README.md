### Tele Download

Telegram bot for downloading videos from `yt-dlp` supported sources and posting them back into the requesting chat.

#### Setup

1. Copy `.env.example` to `.env`
2. Set `BOT_TOKEN`
3. Add allowed Telegram user IDs in `src/config/allowedUsers.ts`
4. Run `npm run dev`

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
# set BOT_TOKEN in .env first
docker compose up --build -d
```

Stop it with:

```bash
docker compose down
```

The compose setup stores temporary downloads in a named Docker volume mounted at `/tmp/tele-download`.
Inside Docker, the app uses the container's installed `ffmpeg` and `ffprobe` for compatibility, while local non-Docker runs still default to the bundled binaries in `bin/`.

#### Commands

- `/start`
- `/help`
- `/supported`
- `/download <url1> <url2> ...`

You can also paste multiple links in a normal message and the bot will queue them as one batch.
