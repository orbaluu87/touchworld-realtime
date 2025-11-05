// ============================================================================
// Touch World - Socket Server v9.4.1 - Presence Sync + JWT Rotation
// ============================================================================

import { createServer } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
app.use(express.json());
app.use(helmet());

// ---------- CORS ----------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

const httpServer = createServer(app);
const PORT = process.env.PORT || 10000;

// ---------- Env / Security ----------
const JWT_SECRET = process.env.WSS_JWT_SECRET || process.env.JWT_SECRET;
const VERIFY_TOKEN_URL = process.env.VERIFY_TOKEN_URL;
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const BASE44_API_URL = process.env.BASE44_API_URL;
const HEALTH_KEY = process.env.HEALTH_KEY || "secret-health";
const VERSION = "9.4.1";

if (!JWT_SECRET || !BASE44_SERVICE_KEY || !HEALTH_KEY) {
  console.error("❌ Missing security keys");
  process.exit(1);
}

// ---------- State ----------
const players = new Map();
const activeTrades = new Map();
const chatRateLimit = new Map();
const areaSyncTimers = new Map();

// ---------- Helpers ----------
const now = () => Date.now();

function safePlayerView(p) {
  if (!p) return null;
  return {
    id: p.playerId,
    playerId: p.playerId,
    username: p.username,
    current_area: p.current_area,
    admin_level: p.admin_level,
    equipment: p.equipment || {},
    position_x: p.position_x,
    position_y: p.position_y,
    direction: p.direction || "front",
    is_moving: !!p.is_moving,
    animation_frame: p.animation_frame || "idle",
    move_speed: 120,
  };
}

// Presence snapshot sync
function getPlayersInArea(area) {
  return Array.from(players.values())
    .filter(p => p.current_area === area)
    .map(safePlayerView);
}

function scheduleAreaSync(area, { delayMs = 1200 } = {}) {
  if (areaSyncTimers.has(area)) return;
  const t = setTimeout(() => {
    areaSyncTimers.delete(area);
    const snapshot = getPlayersInArea(area);
    io.to(area).emit("presence_sync", snapshot);
  }, delayMs);
  areaSyncTimers.set(area, t);
}

// ---------- Verify Token ----------
async function verifyTokenWithBase44(token) {
  try {
    const res = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.success) throw new Error("Invalid token");
    return data.user?.player_data || data.user;
  } catch (e) {
    console.error("❌ Token Error:", e.message);
    return null;
  }
}

// ---------- Health ----------
app.get("/health", (req, res) => {
  const key = req.headers["x-health-key"] || req.query.key;
  if (key !== HEALTH_KEY) return res.status(403).json({ ok: false });
  res.json({
    ok: true,
    version: VERSION,
    players: players.size,
    areas: [...new Set(Array.from(players.values()).map(p => p.current_area))],
  });
});

// ---------- Socket.IO ----------
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ---------- Connection ----------
io.on("connection", async (socket) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.disconnect(true);
    return;
  }

  const user = await verifyTokenWithBase44(token);
  if (!user) {
    socket.emit("disconnect_reason", "invalid_token");
    socket.disconnect(true);
    return;
  }

  // מניעת כפילויות
  for (const [sid, p] of players.entries()) {
    if (p.playerId === user.id && sid !== socket.id) {
      io.to(sid).emit("disconnect_reason", "logged_in_elsewhere");
      io.sockets.sockets.get(sid)?.disconnect(true);
      players.delete(sid);
    }
  }

  const player = {
    socketId: socket.id,
    playerId: user.id,
    username: user.username,
    current_area: user.current_area || "area1",
    admin_level: user.admin_level || "user",
    equipment: user.equipment || {},
    position_x: user.position_x ?? 600,
    position_y: user.position_y ?? 400,
    direction: "front",
    is_moving: false,
    animation_frame: "idle",
  };

  players.set(socket.id, player);
  socket.join(player.current_area);

  const areaPeers = getPlayersInArea(player.current_area).filter(p => p.playerId !== player.playerId);
  socket.emit("identify_ok", safePlayerView(player));
  socket.emit("current_players", areaPeers);
  socket.to(player.current_area).emit("player_joined", safePlayerView(player));

  scheduleAreaSync(player.current_area, { delayMs: 400 });

  console.log(`🟢 Connected: ${player.username} (${player.current_area})`);

  // ---------- MOVE ----------
  socket.on("move_to", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    const { x, y } = data;
    if (typeof x !== "number" || typeof y !== "number") return;

    p.position_x = x;
    p.position_y = y;
    p.is_moving = true;

    io.to(p.current_area).emit("players_moved", [
      {
        id: p.playerId,
        playerId: p.playerId,
        position_x: x,
        position_y: y,
        is_moving: true,
        direction: p.direction,
      },
    ]);

    scheduleAreaSync(p.current_area);
  });

  // ---------- CHANGE AREA ----------
  socket.on("change_area", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    const newArea = data.newArea;
    if (!newArea || newArea === p.current_area) return;

    const oldArea = p.current_area;
    socket.leave(oldArea);
    p.current_area = newArea;
    socket.join(newArea);

    socket.to(oldArea).emit("player_area_changed", { id: p.playerId });
    socket.to(newArea).emit("player_joined", safePlayerView(p));

    scheduleAreaSync(oldArea, { delayMs: 200 });
    scheduleAreaSync(newArea, { delayMs: 200 });

    console.log(`🚪 ${p.username} moved: ${oldArea} → ${newArea}`);
  });

  // ---------- CHAT ----------
  socket.on("chat_message", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    const msg = (data.message ?? "").trim();
    if (!msg) return;

    io.to(p.current_area).emit("chat_message", {
      id: p.playerId,
      username: p.username,
      message: msg,
      timestamp: Date.now(),
    });
  });

  // ---------- DISCONNECT ----------
  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    if (!p) return;

    socket.to(p.current_area).emit("player_disconnected", p.playerId);
    players.delete(socket.id);

    scheduleAreaSync(p.current_area, { delayMs: 200 });
    console.log(`🔴 Disconnected: ${p.username}`);
  });
});

// ---------- Start ----------
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Touch World Server v${VERSION} started on port ${PORT}`);
  console.log("✅ Presence Sync active (anti-disappear fix)");
});
