### Tele Download

Telegram bot for downloading videos from `yt-dlp` supported sources and posting them back into the requesting chat.

#### Setup

1. Copy `.env.example` to `.env`
2. Set `BOT_TOKEN`
3. Add allowed Telegram user IDs in `src/config/allowedUsers.ts`
4. Run `npm run dev`

#### Commands

- `/start`
- `/help`
- `/supported`
- `/download <url1> <url2> ...`

You can also paste multiple links in a normal message and the bot will queue them as one batch.
