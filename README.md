# TwitchFork

**TwitchFork is a creator content lineage and attribution prototype.** It visualizes how a piece of stream content can travel from its original creator to creators who remix, react to, co-stream, or otherwise reuse it. Each connection records a proposed credit percentage so creators and viewers can see where content came from and how attribution might be shared.

> **Prototype notice:** TwitchFork's graph links, split percentages, and royalty calculations are examples. TwitchFork does not calculate or send Twitch payouts. The graph is stored in memory and resets when the server restarts.

## What it does

- **Creator lineage graph:** An interactive browser dashboard draws creators as nodes and content relationships as directional links. Link colors distinguish raids, clip remixes, and co-streams; moving dots show link direction.
- **Creator inspector:** Selecting a creator shows who inspired them, who reused their content, link context, and illustrative credit calculations.
- **Demo controls:** Add example raid, clip-remix, and `!fork` relationships to the graph. These are local demo actions; they do not start a real Twitch raid or send a chat message.
- **Live graph updates:** An Express API and WebSocket connection broadcast graph changes to open dashboards.
- **Optional Twitch profile data:** With Twitch app credentials, the server can look up matching creator profiles and current stream details through Twitch Helix. The built-in sample lineage remains example data; Twitch does not tell TwitchFork that a creator remixed another creator's content.
- **Optional Twitch chat listener:** A configured `tmi.js` bot can listen for `!fork parent_channel` in one channel and add an attribution link.
- **Optional EventSub raid handler:** The server includes an EventSub webhook endpoint that can turn `channel.raid` notifications into graph links after you register the subscription with Twitch.
- **Optional AI context summary:** When `OPENAI_API_KEY` is configured, the server asks OpenAI for a short lineage caption. Without it, TwitchFork uses a local fallback sentence.

## Dashboard guide

1. **A circle is a creator.** Select it to inspect that creator.
2. **An arrow points from the source to the creator reusing the content.** The percentage on the arrow is the suggested credit to the source.
3. **The right-hand panel** summarizes incoming and outgoing relationships and shows sample credit math based on a `$1,240` example pool per link.
4. **Demo controls** add sample graph links so you can demonstrate what a relationship could look like.

For example, if the original creator's clip is remixed, the graph points from the original creator to the clip remixer. A proposed `15%` link on a `$1,240` example pool displays `$186` of illustrative source credit. This is not a payment or an official Twitch split.

## Requirements

- Node.js 20 or newer
- npm
- Optional: Twitch Developer application credentials, Twitch chat bot credentials, and/or an OpenAI API key for their respective integrations

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The demo graph works without Twitch or OpenAI credentials. Edit `.env` to enable optional integrations, then restart the server. Keep all secrets in `.env`; never put them in browser JavaScript or commit them to Git.

To stop the server, press `Control+C` in the terminal. For a production-style local run, use `npm start` instead of `npm run dev`.

## Environment variables

Copy `.env.example` to `.env`. Every integration is optional.

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; defaults to `3000`. |
| `TWITCH_CLIENT_ID` | Twitch app client ID for Helix profile and stream lookups. |
| `TWITCH_CLIENT_SECRET` | Twitch app secret; server-side only. |
| `TWITCH_BOT_USERNAME` | Username for the optional chat bot. |
| `TWITCH_OAUTH_TOKEN` | OAuth token for the optional chat bot; keep it private. |
| `TWITCH_CHANNEL` | Channel the bot joins and listens to. |
| `TWITCH_EVENTSUB_SECRET` | Secret used to verify EventSub webhook signatures. |
| `OPENAI_API_KEY` | Enables AI-generated one-sentence attribution captions. |
| `OPENAI_MODEL` | OpenAI model for captions; defaults to `gpt-4o-mini`. |

### Twitch integrations and their limits

- **Helix profile lookup** uses Twitch's app access token flow and reads public user/stream fields for graph nodes whose channel names match Twitch logins. The Twitch Users endpoint does not provide follower counts, so those are shown as unavailable. A valid API setup does not make the demo lineage edges real.
- **Chat listener** is enabled only when all three chat variables are set. The bot listens for `!fork parent_channel`; it records the chatter as the child and uses a prototype split value.
- **EventSub** is available at `POST /webhooks/eventsub`. You must make the server reachable over HTTPS and create the `channel.raid` subscription with Twitch. The handler validates signatures when `TWITCH_EVENTSUB_SECRET` is set and requires that secret when `NODE_ENV=production`.
- **OpenAI** is called only when a new attribution link is created and an API key is present. If the call fails or the key is absent, a local caption is used instead.

## HTTP API and WebSocket

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Reports server and optional integration configuration/status. |
| `GET` | `/api/graph` | Returns the current in-memory creators and attribution links. |
| `POST` | `/api/simulate-fork` | Adds a link to the graph and broadcasts the update. This is a prototype/demo endpoint, not a Twitch action. |
| `POST` | `/webhooks/eventsub` | Receives EventSub webhook verification and raid notifications. |
| WebSocket | `/ws` | Sends `graph:update` messages when the graph changes. |

Example `POST /api/simulate-fork` JSON body:

```json
{
  "parentChannel": "original_creator",
  "childChannel": "clip_remixer",
  "contributionType": "clip-remix",
  "splitPercentage": 15,
  "context": "The clip remixer reuses the original creator's highlight."
}
```

Supported `contributionType` values are `raid`, `reaction`, `clip-remix`, `co-stream`, `chat-command`, and `fork`. `splitPercentage` must be a number from `0` to `100`.

## Project structure

```text
.
├── public/
│   ├── index.html          # Single-page dashboard structure
│   ├── styles.css          # Twitch-inspired dark UI styling
│   └── app.js              # SVG graph, inspector, WebSocket, demo controls
├── src/
│   └── services/
│       └── aiAttribution.ts # OpenAI summary helper and offline fallback
├── server.ts               # Express API, WebSocket, Twitch integrations, seed graph
├── .env.example            # Safe environment-variable template
├── .gitignore              # Excludes local environment secrets
├── package.json
└── tsconfig.json
```

## Scripts

```bash
npm run dev        # Run with automatic server restart during development
npm start          # Start the server
npm run typecheck  # Run the TypeScript compiler without emitting files
```

## GitHub and secret handling

`.gitignore` excludes `.env` and other `.env*` files while allowing `.env.example`. Before pushing, you can confirm the local secrets file is ignored:

```bash
git check-ignore .env
```

If `.env` was already added to Git's index, ignoring it is not enough. Remove it from the index while keeping your local copy:

```bash
git rm --cached .env
```

If a secret was pushed to a remote repository, revoke or rotate it in the relevant service; deleting the file in a later commit does not remove it from Git history.

## How Codex was used

Codex was used as a development assistant to scaffold and refine TwitchFork: organize the Node.js/TypeScript and Express application, implement the in-memory graph and WebSocket updates, add optional Twitch and OpenAI integration points, build the browser dashboard, and iterate on the interface so the content-lineage story and example credit are easier to understand. Codex also helped document the setup, API, prototype limitations, and secret-handling steps. The Twitch and OpenAI integrations require the project's own credentials and configuration; the demo graph and example credit figures are not live Twitch data or payouts.
