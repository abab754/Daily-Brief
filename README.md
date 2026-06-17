# Daily Briefing Builder

A Model Context Protocol (MCP) App that pulls your Google Calendar events, unread Gmail emails, and recently modified Google Drive docs into a clean morning dashboard — right inside Claude.

## Features

- **Calendar** — Today's meetings with time, location, and attendees
- **Gmail** — Unread emails needing your attention
- **Google Drive** — Recently modified docs across your workspace
- **Interactive UI** — Click any item to ask Claude for a deep-dive or summary
- **Encrypted storage** — OAuth tokens encrypted at rest with AES-256-GCM

## Get Started

The app is live at **https://daily-briefing-mcp.fly.dev**. No setup or API keys needed — just connect and go.

### Step 1: Authenticate with Google

Open this link in your browser and sign in with your Google account:

```
https://daily-briefing-mcp.fly.dev/auth/google
```

After signing in, you'll see a success page with a **session token**. Copy it — you'll need it in the next step.

### Step 2: Connect to Claude

**Claude Code:**

```bash
claude mcp add daily-briefing -s user --transport http \
  -h "Authorization: Bearer <your-session-token>" \
  https://daily-briefing-mcp.fly.dev/mcp
```

**Claude Desktop** — add this to your MCP config:

```json
{
  "mcpServers": {
    "daily-briefing": {
      "type": "http",
      "url": "https://daily-briefing-mcp.fly.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your-session-token>"
      }
    }
  }
}
```

### Step 3: Use it

Ask Claude: **"show me my daily briefing"**

That's it! You'll get a dashboard with your calendar, emails, and recent docs. Click any item to have Claude summarize or deep-dive into it.

### Things You Can Ask

Once connected, try prompts like these:

- **"Show me my daily briefing"** — get the full dashboard
- **"What meetings do I have today?"** — quick calendar overview
- **"Summarize my unread emails"** — Claude reads your inbox and gives you the highlights
- **"What's my next meeting about? Help me prepare"** — Claude pulls the event details and drafts talking points
- **"Draft a reply to that email from Sarah"** — click an email in the briefing, then ask Claude to write a response
- **"Which docs were updated this week?"** — see what your team has been working on
- **"I have 30 minutes free — what should I prioritize?"** — Claude looks at your emails and calendar to suggest what to tackle
- **"Cancel my afternoon — draft emails to let everyone know"** — Claude sees your meetings and helps you notify attendees
- **"Compare my schedule today vs yesterday"** — call the briefing multiple times to spot patterns
- **"Turn my meeting notes into action items and assign them"** — combine Drive docs with calendar context

The briefing is interactive — click any calendar event, email, or doc in the UI to have Claude dig deeper into it.

---

## Development

Everything below is for contributors who want to run or modify the app locally.

### Architecture

```
src/mcp-app.tsx    → React UI (bundled to single HTML file via Vite)
server.ts          → MCP server with tools + UI resource registration
google-api.ts      → Google Calendar/Gmail/Drive API integration
token-store.ts     → SQLite + AES-256-GCM encrypted token storage
session.ts         → HMAC-signed session tokens + CSRF protection
rate-limit.ts      → Per-IP sliding window rate limiter
main.ts            → Express server, OAuth routes, MCP endpoint
```

### Prerequisites

- Node.js 22+
- A Google Cloud project with Calendar, Gmail, and Drive APIs enabled
- OAuth 2.0 credentials (Web application type)

### Local Setup

```bash
npm install
cp .env.example .env
# Edit .env with your Google OAuth credentials
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Production | Override redirect URI for deployed environments |
| `TOKEN_ENCRYPTION_KEY` | Production | 64-char hex string for AES-256-GCM encryption |
| `SESSION_SECRET` | Production | Hex string for HMAC session signing |
| `DATABASE_PATH` | No | SQLite database path (default: `./data/tokens.db`) |

### Deploying to Fly.io

```bash
fly launch
fly volumes create data --size 1 --region sjc
fly secrets set GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..." \
  TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32) \
  SESSION_SECRET=$(openssl rand -hex 32) \
  GOOGLE_REDIRECT_URI="https://your-app.fly.dev/auth/google/callback"
fly deploy
```

### Security

- OAuth tokens encrypted at rest (AES-256-GCM with unique IVs per row)
- HMAC-SHA256 signed session tokens with 30-day expiry
- CSRF protection on OAuth flow via signed state parameter
- Rate limiting: 120 req/min on `/mcp`, 10 req/min on `/auth`
- Security headers: HSTS, X-Content-Type-Options, X-Frame-Options
- Timing-safe token comparison

## License

MIT
