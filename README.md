### Tele Download

Telegram bot for inspecting `yt-dlp` video formats, letting the user choose a preferred size, and either uploading the result back into Telegram or serving it as a temporary 1-hour download link when the file is too large for bot uploads.

#### Setup

1. Copy `.env.example` to `.env`
2. Set `BOT_TOKEN`
3. Install the required system dependencies: `yt-dlp`, `ffmpeg`, `ffprobe`, `python3`, `python3-secretstorage`, and Google Chrome
4. Set `CHROME_PROFILE` to the real Chrome profile directory if the logged-in account is not in the default profile
5. Set `PUBLIC_BASE_URL` to the public URL users will open for temporary downloads
6. Add allowed Telegram user IDs in `src/config/allowedUsers.ts`
7. Run `npm run dev`

#### Environment

- `PUBLIC_BASE_URL` must be a public absolute URL that points at this app's embedded HTTP server, usually through a reverse proxy
- `HTTP_PORT` controls the embedded HTTP server used for temporary download links
- `TEMP_FILE_TTL_MS` defaults to 1 hour
- `SELECTION_TTL_MS` defaults to 15 minutes
- `CHROME_PROFILE` is optional and must be the on-disk Chrome profile directory, usually `Default` or `Profile 2`

#### Production

Build and run the compiled bot directly:

```bash
npm ci
npm run build
node dist/index.js
```

For a long-running server process, use your preferred service manager such as `systemd`, `pm2`, or another supervisor around `node dist/index.js`.

The bot always runs `yt-dlp` with `--cookies-from-browser chrome`, or `--cookies-from-browser chrome:<profile>` when `CHROME_PROFILE` is set. Per the yt-dlp README, the profile portion is the documented way to target a specific Chrome profile.

Important: `CHROME_PROFILE` is not the friendly name shown in the Chrome profile switcher unless that happens to match the directory name. Common valid values are `Default` and `Profile 2`. If you set something like `Arthur`, the bot now fails at startup if `~/.config/google-chrome/Arthur/Cookies` does not exist.

Startup also fails immediately if any required system dependency is missing. On Linux servers, the app expects `yt-dlp`, `ffmpeg`, `ffprobe`, `python3`, `python3-secretstorage`, and a Chrome installation with the target profile available under `~/.config/google-chrome/`.

#### Commands

- `/start`
- `/help`
- `/supported`
- `/download <url1> <url2> ...`

You can also paste multiple links in a normal message. The bot will inspect each link, show curated format buttons, and wait for your selection before downloading.
