// ============================================================================
// Touch World - Socket Server v8.2.2 (Render-Ready, Secure Edition)
// ============================================================================

import { createServer } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";
import fetch from "node-fetch";
import crypto from "crypto";
import "dotenv/config";

// ---------- Express Setup ----------
const app = express();
app.use(express.json());
app.use(helmet());

// ---------- CORS ----------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : "*",
  methods: ["GET", "POST"],
  credentials: true,
}));

// ---------- Server Setup ----------
const httpServer = createServer(app);
const PORT = process.env.PORT; // ✅ Render יוצר פורט לבד
const VERSION = "8.2.2";

// ---------- Environment Variables ----------
const {
  JWT_SECRET,
  VERIFY_TOKEN_URL,
  BASE44_SERVICE_KEY,
  BASE44_API_URL,
  VERIFY_OWNERSHIP_URL,
  EXECUTE_TRADE_URL,
  HEALTH_KEY,
} = process.env;

const MAX_CONN_PER_IP = parseInt(process.env.MAX_CONN_PER_IP || "4", 10);
const MAX_NEW_CONNS_PER_MIN = parseInt(process.env.MAX_NEW_CONNS_PER_MIN || "20", 10);
const CHAT_WINDOW_MS = 2500;
const CHAT_MAX_IN_WINDOW = 5;
const MAX_TRADE_ITEMS_PER_SIDE = parseInt(process.env.MAX_TRADE_ITEMS_PER_SIDE || "12", 10);
const MAX_TRADE_COINS_PER_SIDE = parseInt(process.env.MAX_TRADE_COINS_PER_SIDE || "1000000", 10);
const MAX_TRADE_GEMS_PER_SIDE = parseInt(process.env.MAX_TRADE_GEMS_PER_SIDE || "100000", 10);
const TRADE_ACTION_WINDOW_MS = 2500;
const TRADE_MAX_ACTIONS_IN_WINDOW = 8;

if (!BASE44_SERVICE_KEY || !HEALTH_KEY || !JWT_SECRET) {
  console.error("❌ Missing environment variables. Check your Render settings.");
  process.exit(1);
}

// ---------- State ----------
const players = new Map();
const activeTrades = new Map();
const chatRateLimit = new Map();
const tradeRateLimit = new Map();
const ipConnections = new Map();
const connectionLog = [];
const playerLocks = new Map();

// ---------- Helpers ----------
function safePlayerView(p) {
  if (!p) return null;
  return {
    id: p.playerId,
    username: p.username,
    current_area: p.current_area,
    equipment: p.equipment || {},
    position_x: Math.round(p.position_x || 0),
    position_y: Math.round(p.position_y || 0),
    direction: p.direction || "front",
    is_moving: !!p.is_moving,
    animation_frame: p.animation_frame || "idle",
    move_speed: p.move_speed ?? 60,
    is_trading: !!p.activeTradeId,
  };
}

function getSocketIdByPlayerId(playerId) {
  for (const [sid, p] of players.entries()) {
    if (p.playerId === playerId) return sid;
  }
  return null;
}

function allowAction(limitMap, socketId, windowMs, maxInWindow, muteMs = 8000) {
  const now = Date.now();
  const bucket = limitMap.get(socketId) || { ts: [], mutedUntil: 0 };
  if (now < bucket.mutedUntil) return false;
  bucket.ts = bucket.ts.filter((t) => now - t < windowMs);
  bucket.ts.push(now);
  if (bucket.ts.length > maxInWindow) {
    bucket.mutedUntil = now + muteMs;
    limitMap.set(socketId, bucket);
    return false;
  }
  limitMap.set(socketId, bucket);
  return true;
}

const allowChat = (sid) => allowAction(chatRateLimit, sid, CHAT_WINDOW_MS, CHAT_MAX_IN_WINDOW, 8000);
const allowTradeAction = (sid) => allowAction(tradeRateLimit, sid, TRADE_ACTION_WINDOW_MS, TRADE_MAX_ACTIONS_IN_WINDOW, 5000);

function sanitizeOffer(raw = {}) {
  return {
    items: Array.isArray(raw.items) ? raw.items.filter((v) => typeof v === "string" || Number.isFinite(v)).slice(0, MAX_TRADE_ITEMS_PER_SIDE) : [],
    coins: Math.max(0, Math.min(parseInt(raw.coins, 10) || 0, MAX_TRADE_COINS_PER_SIDE)),
    gems: Math.max(0, Math.min(parseInt(raw.gems, 10) || 0, MAX_TRADE_GEMS_PER_SIDE)),
  };
}

const generateTradeId = () => `trade_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

// ---------- Health ----------
app.get("/health", (req, res) => {
  const key = req.query.key;
  if (key !== HEALTH_KEY) return res.status(403).json({ error: "Forbidden" });
  res.json({
    status: "OK",
    version: VERSION,
    uptime: process.uptime(),
    players: players.size,
    trades: activeTrades.size,
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "✅ Touch World Socket Server",
    version: VERSION,
    status: "running",
  });
});

// ---------- Socket.IO ----------
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket"],
  pingTimeout: 30000,
  pingInterval: 15000,
});

// ----------------------------
// 🔌 Player Connection Handler
// ----------------------------
io.on("connection", async (socket) => {
  const ip = socket.handshake.headers["x-forwarded-for"]?.split(",")[0] || socket.handshake.address;
  console.log(`🔌 New connection from ${ip} (${socket.id})`);

  // Anti-Flood by IP
  const conn = ipConnections.get(ip) || 0;
  if (conn >= MAX_CONN_PER_IP) {
    console.log(`❌ Too many connections from ${ip}`);
    socket.disconnect(true);
    return;
  }
  ipConnections.set(ip, conn + 1);

  // Rate limit per minute
  const now = Date.now();
  connectionLog.push({ ip, time: now });
  const recent = connectionLog.filter((e) => e.ip === ip && now - e.time < 60000);
  if (recent.length > MAX_NEW_CONNS_PER_MIN) {
    console.log(`❌ Rate limit exceeded for ${ip}`);
    socket.disconnect(true);
    ipConnections.set(ip, Math.max(0, (ipConnections.get(ip) || 0) - 1));
    return;
  }

  // Auth
  const token = socket.handshake.auth?.token;
  if (!token) {
    console.log(`❌ No token ${socket.id}`);
    socket.disconnect(true);
    ipConnections.set(ip, Math.max(0, (ipConnections.get(ip) || 0) - 1));
    return;
  }

  let playerData;
  try {
    const verifyRes = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-key": BASE44_SERVICE_KEY,
      },
      body: JSON.stringify({ token }),
    });

    if (!verifyRes.ok) throw new Error("Token verify failed");
    const verifyData = await verifyRes.json();
    if (!verifyData.success || !verifyData.player) throw new Error("Invalid token data");
    playerData = verifyData.player;
  } catch (err) {
    console.error(`❌ Verify error: ${err.message}`);
    socket.disconnect(true);
    ipConnections.set(ip, Math.max(0, (ipConnections.get(ip) || 0) - 1));
    return;
  }

  // Prevent duplicate session
  for (const [sid, pl] of players.entries()) {
    if (pl.playerId === playerData.id) {
      console.log(`⚠️ Duplicate session for ${playerData.username}`);
      const existing = io.sockets.sockets.get(sid);
      if (existing) existing.disconnect(true);
      players.delete(sid);
      break;
    }
  }

  // Store player state
  const playerState = {
    playerId: playerData.id,
    userId: playerData.user_id,
    username: playerData.username,
    admin_level: playerData.admin_level || "user",
    current_area: playerData.current_area || "area1",
    equipment: playerData.equipment || {},
    position_x: playerData.position_x || 960,
    position_y: playerData.position_y || 540,
    direction: playerData.direction || "front",
    is_moving: false,
    animation_frame: "idle",
    move_speed: 60,
    activeTradeId: null,
  };
  players.set(socket.id, playerState);
  socket.join(playerState.current_area);

  console.log(`✅ ${playerState.username} connected (${socket.id})`);

  // Send initial players
  const playersInArea = Array.from(players.values())
    .filter((p) => p.current_area === playerState.current_area)
    .map(safePlayerView);
  socket.emit("current_players", playersInArea);
  socket.to(playerState.current_area).emit("player_joined", safePlayerView(playerState));

  // --------------------------------
  // Chat + Movement + Trade Handlers
  // --------------------------------
  socket.on("chat_message", (data) => {
    const player = players.get(socket.id);
    if (!player || !allowChat(socket.id)) return socket.emit("chat_rate_limited");
    const message = (data.message || "").trim().slice(0, 200);
    if (!message) return;
    const chatData = { id: player.playerId, username: player.username, message, timestamp: Date.now() };
    socket.to(player.current_area).emit("chat_message", chatData);
    socket.emit("chat_message", chatData);
  });

  socket.on("move_to", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    const x = Math.max(0, Math.min(1380, parseFloat(data.x) || 0));
    const y = Math.max(0, Math.min(770, parseFloat(data.y) || 0));
    p.is_moving = true;
    p.destination_x = x;
    p.destination_y = y;
    const dx = x - p.position_x;
    const dy = y - p.position_y;
    p.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n";
  });

  // Disconnect
  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`👋 ${player.username} disconnected`);
      socket.to(player.current_area).emit("player_disconnected", player.playerId);
      players.delete(socket.id);
    }
    ipConnections.set(ip, Math.max(0, (ipConnections.get(ip) || 0) - 1));
    chatRateLimit.delete(socket.id);
    tradeRateLimit.delete(socket.id);
  });
});

// ---------- Game Loop ----------
setInterval(() => {
  const SPEED = 60;
  const updates = [];
  for (const [socketId, p] of players.entries()) {
    if (!p.is_moving || p.destination_x === undefined) continue;
    const dx = p.destination_x - p.position_x;
    const dy = p.destination_y - p.position_y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 5) {
      p.position_x = p.destination_x;
      p.position_y = p.destination_y;
      p.is_moving = false;
      p.animation_frame = "idle";
      delete p.destination_x;
      delete p.destination_y;
    } else {
      const step = Math.min(SPEED / 60, dist);
      p.position_x += (dx / dist) * step;
      p.position_y += (dy / dist) * step;
      p.animation_frame = Math.random() > 0.5 ? "walk1" : "walk2";
    }
    updates.push({
      id: p.playerId,
      position_x: Math.round(p.position_x),
      position_y: Math.round(p.position_y),
      direction: p.direction,
      is_moving: p.is_moving,
      animation_frame: p.animation_frame,
    });
  }
  if (updates.length > 0) io.emit("players_moved", updates);
}, 1000 / 60);

// ---------- Start Server ----------
httpServer.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════╗
  ║   Touch World Socket Server v${VERSION}   ║
  ║   Port: ${PORT}                          ║
  ║   Status: RUNNING                      ║
  ╚════════════════════════════════════════╝
  `);
});
