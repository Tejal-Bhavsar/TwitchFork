import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import tmi from "tmi.js";
import { generateAttributionSummary } from "./src/services/aiAttribution.js";

type ContributionType = "raid" | "reaction" | "clip-remix" | "co-stream" | "chat-command" | "fork";
interface Streamer { id: string; name: string; color: string; followers: number | null; isLive: boolean; category: string; streamTitle: string; demoProfile: boolean; profileImageUrl?: string; streamThumbnailUrl?: string; viewerCount?: number; }
interface AttributionEdge {
  id: string; parentChannel: string; childChannel: string; contributionType: ContributionType;
  splitPercentage: number; royaltyPoolUsd: number; summary: string; contextSnippet: string; createdAt: string;
}
interface GraphState { nodes: Streamer[]; edges: AttributionEdge[]; updatedAt: string; }

const palette = ["#a78bfa", "#22d3ee", "#f472b6", "#fbbf24", "#34d399", "#fb7185"];
const key = (name: string) => name.trim().replace(/^@/, "").toLowerCase();
const profileSeeds: Record<string, Omit<Streamer, "id" | "name" | "color"> & { displayName?: string }> = {
  original_creator: { displayName: "Original creator", followers: null, isLive: false, category: "EXAMPLE CLIP", streamTitle: "Original highlight · sample scenario", demoProfile: true },
  clip_remixer: { displayName: "Clip remixer", followers: null, isLive: false, category: "EXAMPLE REMIX", streamTitle: "Adds a reaction to the original clip · sample scenario", demoProfile: true },
  co_streamer: { displayName: "Co-streamer", followers: null, isLive: false, category: "EXAMPLE CO-STREAM", streamTitle: "Co-streams the remix · sample scenario", demoProfile: true },
  raid_guest: { displayName: "Raid guest", followers: null, isLive: false, category: "EXAMPLE RAID", streamTitle: "Joins through a sample raid", demoProfile: true },
  remix_creator: { displayName: "Remix creator", followers: null, isLive: false, category: "EXAMPLE REMIX", streamTitle: "Reuses the original clip", demoProfile: true },
  chat_attributor: { displayName: "Chat contributor", followers: null, isLive: false, category: "EXAMPLE CHAT LINK", streamTitle: "Adds a source with !fork", demoProfile: true },
};
const graph: GraphState = { nodes: [], edges: [], updatedAt: new Date().toISOString() };
const twitchStatus: { configured: boolean; lastUpdated: string | null; error: string | null } = { configured: Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET), lastUpdated: null, error: null };
let appAccessToken = "";
let appTokenExpiresAt = 0;
const app = express();
app.use(express.json({ limit: "32kb", verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf); } }));
app.use(express.static(path.join(process.cwd(), "public")));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast() {
  graph.updatedAt = new Date().toISOString();
  const payload = JSON.stringify({ type: "graph:update", graph });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(payload);
}
function ensureNode(name: string): Streamer {
  const id = key(name);
  let node = graph.nodes.find((item) => item.id === id);
  if (!node) {
    const seed = profileSeeds[id];
    node = {
      id, name: seed?.displayName || name.trim().replace(/^@/, ""), color: palette[graph.nodes.length % palette.length],
      followers: seed?.followers ?? null,
      isLive: seed?.isLive ?? false, category: seed?.category ?? "VARIETY", demoProfile: true,
      streamTitle: seed?.streamTitle ?? "Live demo stream · community fork",
    };
    graph.nodes.push(node);
  }
  return node;
}

async function getTwitchAppToken(): Promise<string> {
  if (appAccessToken && Date.now() < appTokenExpiresAt - 60_000) return appAccessToken;
  const body = new URLSearchParams({ client_id: process.env.TWITCH_CLIENT_ID!, client_secret: process.env.TWITCH_CLIENT_SECRET!, grant_type: "client_credentials" });
  const response = await fetch("https://id.twitch.tv/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error(`Twitch token request failed (${response.status}). Check the Client ID and Secret.`);
  const payload = await response.json() as { access_token: string; expires_in: number };
  appAccessToken = payload.access_token;
  appTokenExpiresAt = Date.now() + payload.expires_in * 1000;
  return appAccessToken;
}

async function twitchGet<T>(url: URL): Promise<T> {
  const token = await getTwitchAppToken();
  const response = await fetch(url, { headers: { "Client-Id": process.env.TWITCH_CLIENT_ID!, Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Twitch API request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

async function refreshTwitchProfiles(): Promise<void> {
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET || graph.nodes.length === 0) return;
  try {
    const usersUrl = new URL("https://api.twitch.tv/helix/users");
    for (const node of graph.nodes.slice(0, 100)) usersUrl.searchParams.append("login", node.id);
    const users = await twitchGet<{ data: Array<{ id: string; login: string; display_name: string; profile_image_url: string }> }>(usersUrl);
    const userByLogin = new Map(users.data.map(user => [user.login.toLowerCase(), user]));
    const streamsUrl = new URL("https://api.twitch.tv/helix/streams");
    for (const user of users.data) streamsUrl.searchParams.append("user_id", user.id);
    const streams = await twitchGet<{ data: Array<{ user_id: string; game_name: string; title: string; viewer_count: number; thumbnail_url: string }> }>(streamsUrl);
    const streamByUser = new Map(streams.data.map(stream => [stream.user_id, stream]));
    for (const node of graph.nodes) {
      const user = userByLogin.get(node.id);
      if (!user) continue;
      const stream = streamByUser.get(user.id);
      node.name = user.display_name;
      node.demoProfile = false;
      node.profileImageUrl = user.profile_image_url;
      node.isLive = Boolean(stream);
      node.category = stream?.game_name || "OFFLINE";
      node.streamTitle = stream?.title || "Not currently live";
      node.viewerCount = stream?.viewer_count;
      node.streamThumbnailUrl = stream?.thumbnail_url.replace("{width}", "640").replace("{height}", "360");
      // Helix Get Users does not return follower counts; don't fabricate one.
      node.followers = null;
    }
    twitchStatus.lastUpdated = new Date().toISOString();
    twitchStatus.error = null;
    broadcast();
  } catch (error) {
    twitchStatus.error = error instanceof Error ? error.message : "Twitch API request failed.";
    console.error(twitchStatus.error);
  }
}
async function addFork(input: { parentChannel: string; childChannel: string; contributionType: ContributionType; splitPercentage: number; context?: string; royaltyPoolUsd?: number }) {
  const parentChannel = input.parentChannel.trim().replace(/^@/, "");
  const childChannel = input.childChannel.trim().replace(/^@/, "");
  const parentId = key(parentChannel);
  const childId = key(childChannel);
  if (!parentId || !childId || parentId === childId) throw new Error("Parent and child must be different channel names.");
  const splitPercentage = Number(input.splitPercentage);
  if (!Number.isFinite(splitPercentage) || splitPercentage < 0 || splitPercentage > 100) throw new Error("splitPercentage must be between 0 and 100.");
  const parentNode = ensureNode(parentChannel);
  const childNode = ensureNode(childChannel);
  const edge: AttributionEdge = {
    id: crypto.randomUUID(), parentChannel: parentId, childChannel: childId,
    contributionType: input.contributionType, splitPercentage,
    royaltyPoolUsd: input.royaltyPoolUsd ?? 1240,
    summary: await generateAttributionSummary(parentNode.name, childNode.name, input.context || "", splitPercentage),
    contextSnippet: input.context || "",
    createdAt: new Date().toISOString(),
  };
  graph.edges.unshift(edge);
  broadcast();
  return edge;
}

app.get("/api/health", (_req, res) => res.json({ ok: true, integrations: { twitchApi: twitchStatus, twitchChat: Boolean(process.env.TWITCH_BOT_USERNAME && process.env.TWITCH_OAUTH_TOKEN && process.env.TWITCH_CHANNEL), openai: Boolean(process.env.OPENAI_API_KEY) } }));
app.get("/api/graph", (_req, res) => res.json(graph));
app.post("/api/simulate-fork", async (req, res) => {
  const { parentChannel, childChannel, contributionType = "fork", splitPercentage = 20, context = "" } = req.body ?? {};
  if (typeof parentChannel !== "string" || typeof childChannel !== "string") return res.status(400).json({ error: "parentChannel and childChannel are required strings." });
  const types: ContributionType[] = ["raid", "reaction", "clip-remix", "co-stream", "chat-command", "fork"];
  if (!types.includes(contributionType)) return res.status(400).json({ error: "Unsupported contributionType." });
  try {
    const edge = await addFork({ parentChannel, childChannel, contributionType, splitPercentage, context: String(context) });
    return res.status(201).json({ edge, graph });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Could not create fork." });
  }
});

async function seedDemoGraph() {
  const scenarios: Array<{ parentChannel: string; childChannel: string; contributionType: ContributionType; splitPercentage: number; context: string }> = [
    { parentChannel: "original_creator", childChannel: "clip_remixer", contributionType: "clip-remix", splitPercentage: 15, context: "Example only: the clip remixer reuses the original creator's highlight. The suggested 15% source credit goes to the original creator." },
    { parentChannel: "clip_remixer", childChannel: "co_streamer", contributionType: "co-stream", splitPercentage: 10, context: "Example only: the co-streamer shares the clip remixer's content. The suggested 10% source credit goes to the clip remixer." },
  ];
  for (const scenario of scenarios) {
    ensureNode(scenario.parentChannel); ensureNode(scenario.childChannel);
    graph.edges.push({ id: crypto.randomUUID(), parentChannel: key(scenario.parentChannel), childChannel: key(scenario.childChannel), contributionType: scenario.contributionType, splitPercentage: scenario.splitPercentage, royaltyPoolUsd: 1240, summary: scenario.context, contextSnippet: scenario.context, createdAt: new Date().toISOString() });
  }
  graph.updatedAt = new Date().toISOString();
}

// Twitch EventSub webhook template for channel.raid notifications.
app.post("/webhooks/eventsub", async (req, res) => {
  const secret = process.env.TWITCH_EVENTSUB_SECRET;
  const messageId = req.header("Twitch-Eventsub-Message-Id");
  const timestamp = req.header("Twitch-Eventsub-Message-Timestamp");
  const signature = req.header("Twitch-Eventsub-Message-Signature");
  const messageType = req.header("Twitch-Eventsub-Message-Type");
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody;
  if (secret && messageId && timestamp && signature && rawBody) {
    const expected = `sha256=${crypto.createHmac("sha256", secret).update(messageId + timestamp + rawBody.toString("utf8")).digest("hex")}`;
    const a = Buffer.from(signature); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(403);
  } else if (process.env.NODE_ENV === "production") {
    return res.status(503).send("Configure TWITCH_EVENTSUB_SECRET before enabling EventSub in production.");
  }
  if (messageType === "webhook_callback_verification") return res.type("text/plain").send(req.body.challenge);
  if (messageType === "notification" && req.body.subscription?.type === "channel.raid") {
    const event = req.body.event as { from_broadcaster_user_login?: string; to_broadcaster_user_login?: string };
    if (event?.from_broadcaster_user_login && event?.to_broadcaster_user_login) {
      try { await addFork({ parentChannel: event.from_broadcaster_user_login, childChannel: event.to_broadcaster_user_login, contributionType: "raid", splitPercentage: 10, context: "Twitch EventSub raid" }); }
      catch (error) { console.error("EventSub raid handling failed:", error); }
    }
  }
  return res.sendStatus(204);
});

// Optional tmi.js chat integration. In chat, type: !fork parent_channel
if (process.env.TWITCH_BOT_USERNAME && process.env.TWITCH_OAUTH_TOKEN && process.env.TWITCH_CHANNEL) {
  const chat = new tmi.Client({ options: { debug: false }, identity: { username: process.env.TWITCH_BOT_USERNAME, password: process.env.TWITCH_OAUTH_TOKEN }, channels: [process.env.TWITCH_CHANNEL] });
  chat.connect().then(() => console.log(`Connected to Twitch chat: ${process.env.TWITCH_CHANNEL}`)).catch((error: unknown) => console.error("Twitch chat connection failed:", error));
  chat.on("message", async (_channel, tags, message, self) => {
    if (self) return;
    const match = message.match(/^!fork\s+([a-zA-Z0-9_]{1,25})\s*$/i);
    if (!match) return;
    try {
      await addFork({ parentChannel: match[1], childChannel: tags.username || process.env.TWITCH_CHANNEL!, contributionType: "chat-command", splitPercentage: 20, context: message });
    } catch (error) { console.error("Chat fork command failed:", error); }
  });
}

void seedDemoGraph();
void refreshTwitchProfiles();
setInterval(() => void refreshTwitchProfiles(), 60_000).unref();
wss.on("connection", (socket) => socket.send(JSON.stringify({ type: "graph:update", graph })));
const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`TwitchFork dashboard ready at http://localhost:${port}`));
