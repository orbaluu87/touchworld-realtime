// ============================================================================
// Touch World - Socket Server v9.2.0 - Movement + Admin Messages
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

// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// Server setup
const httpServer = createServer(app);
const PORT = process.env.PORT || 10000;

// Security keys
const JWT_SECRET = process.env.WSS_JWT_SECRET || process.env.JWT_SECRET;
const VERIFY_TOKEN_URL =
  process.env.VERIFY_TOKEN_URL ||
  "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/verifyWebSocketToken";
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const BASE44_API_URL =
  process.env.BASE44_API_URL ||
  "https://base44.app/api/apps/68e269394d8f2fa24e82cd71";
const HEALTH_KEY = process.env.HEALTH_KEY;

if (!JWT_SECRET || !BASE44_SERVICE_KEY || !HEALTH_KEY) {
  console.error("❌ Missing security keys");
  process.exit(1);
}

const VERSION = "9.2.0";

// Health checks
app.get("/healthz", (req, res) => {
  res.status(200).json({ ok: true, version: VERSION, players: players.size });
});

app.get("/health", (req, res) => {
  const key = req.headers["x-health-key"] || req.query.key;
  if (key !== HEALTH_KEY) return res.status(403).json({ ok: false });
  res.json({
    ok: true,
    version: VERSION,
    players: players.size,
    trades: activeTrades.size,
    list: Array.from(players.values()).map((p) => ({
      id: p.playerId,
      user: p.username,
      area: p.current_area,
    })),
  });
});

// Socket.IO setup
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Player maps
const players = new Map();
const activeTrades = new Map();
const chatRateLimit = new Map();

// ===================== MOVEMENT CONSTANTS =====================
const MOVE_SPEED = 120; // pixels per second
const GAME_TICK_RATE = 60; // updates per second
const GAME_TICK_INTERVAL = 1000 / GAME_TICK_RATE;

// Utility: Safe player view
function safePlayerView(p) {
  if (!p) return null;
  return {
    id: p.playerId,
    playerId: p.playerId,
    socketId: p.socketId,
    username: p.username,
    current_area: p.current_area,
    admin_level: p.admin_level,
    equipment: p.equipment || {},
    position_x: p.position_x,
    position_y: p.position_y,
    direction: p.direction || "front",
    is_moving: !!p.is_moving,
    animation_frame: p.animation_frame || "idle",
    move_speed: MOVE_SPEED,
    is_trading: !!p.activeTradeId,
  };
}

// Utility: Find socket by player ID
function getSocketIdByPlayerId(playerId) {
  for (const [sid, p] of players.entries()) {
    if (p.playerId === playerId) return sid;
  }
  return null;
}

// Verify token with Base44
async function verifyTokenWithBase44(token) {
  try {
    console.log("🔐 Verifying token...");
    const response = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    console.log("✅ Token OK:", result.user?.username);
    return result.user;
  } catch (err) {
    console.error("❌ Token Error:", err.message);
    return null;
  }
}

// Trade execution via Base44
async function executeTradeOnBase44(trade) {
  console.log(`[Trade Execute] ${trade.id}`);
  try {
    const resp = await fetch(`${BASE44_API_URL}/functions/executeTrade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        initiator_id: trade.initiatorId,
        receiver_id: trade.receiverId,
        initiator_offer_items: trade.initiator_offer.items || [],
        initiator_offer_coins: trade.initiator_offer.coins || 0,
        initiator_offer_gems: trade.initiator_offer.gems || 0,
        receiver_offer_items: trade.receiver_offer.items || [],
        receiver_offer_coins: trade.receiver_offer.coins || 0,
        receiver_offer_gems: trade.receiver_offer.gems || 0,
      }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json?.error);
    console.log(`✅ Trade OK`);
    return { success: true, data: json };
  } catch (e) {
    console.error(`❌ Trade Failed:`, e.message);
    return { success: false, error: e.message };
  }
}

// Broadcast trade status
function broadcastTradeStatus(tradeId) {
  const trade = activeTrades.get(tradeId);
  if (!trade) return;
  const initSid = getSocketIdByPlayerId(trade.initiatorId);
  const recvSid = getSocketIdByPlayerId(trade.receiverId);
  const payload = {
    id: trade.id,
    status: trade.status,
    initiatorId: trade.initiatorId,
    receiverId: trade.receiverId,
    initiator: initSid
      ? safePlayerView(players.get(initSid))
      : { id: trade.initiatorId, username: "Disconnected" },
    receiver: recvSid
      ? safePlayerView(players.get(recvSid))
      : { id: trade.receiverId, username: "Disconnected" },
    initiator_offer: trade.initiator_offer,
    receiver_offer: trade.receiver_offer,
    chatHistory: trade.chatHistory || [],
    reason: trade.reason || null,
  };
  if (initSid) io.to(initSid).emit("trade_status_updated", payload);
  if (recvSid) io.to(recvSid).emit("trade_status_updated", payload);
}

// Chat rate limit
function allowChat(socketId) {
  const now = Date.now();
  const bucket = chatRateLimit.get(socketId) || { ts: [], mutedUntil: 0 };
  if (now < bucket.mutedUntil) return false;
  bucket.ts = bucket.ts.filter((t) => now - t < 2500);
  bucket.ts.push(now);
  if (bucket.ts.length > 5) {
    bucket.mutedUntil = now + 8000;
    chatRateLimit.set(socketId, bucket);
    return false;
  }
  chatRateLimit.set(socketId, bucket);
  return true;
}

// ===================== MOVEMENT LOGIC =====================
function updatePlayerPosition(player, deltaSeconds) {
  if (!player.is_moving || !player.destination_x || !player.destination_y) {
    player.is_moving = false;
    player.animation_frame = "idle";
    return;
  }

  const dx = player.destination_x - player.position_x;
  const dy = player.destination_y - player.position_y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 2) {
    player.position_x = player.destination_x;
    player.position_y = player.destination_y;
    player.is_moving = false;
    player.animation_frame = "idle";
    player.destination_x = null;
    player.destination_y = null;
    return;
  }

  const moveDistance = MOVE_SPEED * deltaSeconds;
  const ratio = Math.min(moveDistance / distance, 1);

  player.position_x += dx * ratio;
  player.position_y += dy * ratio;

  // Update direction
  if (Math.abs(dx) > Math.abs(dy)) {
    player.direction = dx > 0 ? "e" : "w";
  } else {
    player.direction = dy > 0 ? "s" : "n";
  }

  player.animation_frame = "walk";
}

// ===================== GAME LOOP =====================
let lastTickTime = Date.now();

setInterval(() => {
  const now = Date.now();
  const deltaMs = now - lastTickTime;
  const deltaSeconds = deltaMs / 1000;
  lastTickTime = now;

  // Group players by area
  const areaUpdates = new Map();

  for (const [socketId, player] of players.entries()) {
    if (player.is_moving) {
      updatePlayerPosition(player, deltaSeconds);

      if (!areaUpdates.has(player.current_area)) {
        areaUpdates.set(player.current_area, []);
      }

      areaUpdates.get(player.current_area).push({
        playerId: player.playerId,
        position_x: player.position_x,
        position_y: player.position_y,
        direction: player.direction,
        is_moving: player.is_moving,
        animation_frame: player.animation_frame,
      });
    }
  }

  // Broadcast updates per area
  for (const [areaId, updates] of areaUpdates.entries()) {
    if (updates.length > 0) {
      io.in(areaId).emit("players_moved", updates);
    }
  }
}, GAME_TICK_INTERVAL);

// ===================== SOCKET AUTH =====================
io.use(async (socket, next) => {
  console.log("🔐 Auth attempt, socket:", socket.id);
  const auth = socket.handshake.auth || {};
  if (!auth.token) {
    console.error("❌ No token");
    return next(new Error("Auth required"));
  }
  const user = await verifyTokenWithBase44(auth.token);
  if (!user || !user.player_data?.id) {
    console.error("❌ Invalid token");
    return next(new Error("Invalid token"));
  }
  socket.identity = {
    playerId: user.player_data.id,
    userId: user.player_data.id,
    username: user.player_data.username || "Guest",
    current_area: user.player_data.current_area || "area1",
    admin_level: user.player_data.admin_level || "user",
    equipment: {
      skin_code: user.player_data.skin_code,
      equipped_hair: user.player_data.equipped_hair,
      equipped_top: user.player_data.equipped_top,
      equipped_pants: user.player_data.equipped_pants,
      equipped_hat: user.player_data.equipped_hat,
      equipped_necklace: user.player_data.equipped_necklace,
      equipped_halo: user.player_data.equipped_halo,
      equipped_accessory: user.player_data.equipped_accessory,
    },
    x: Number.isFinite(user.player_data.position_x)
      ? user.player_data.position_x
      : 600,
    y: Number.isFinite(user.player_data.position_y)
      ? user.player_data.position_y
      : 400,
  };
  console.log("✅ Authenticated:", socket.identity.username);
  next();
});

// ===================== SOCKET EVENTS =====================
io.on("connection", (socket) => {
  const id = socket.identity;

  console.log(`🟢 Player connected: ${id.username} (${id.playerId})`);

  const existing = getSocketIdByPlayerId(id.playerId);
  if (existing && existing !== socket.id) {
    console.log(`⚠️ Duplicate connection - kicking old socket ${existing}`);
    const old = io.sockets.sockets.get(existing);
    if (old) {
      old.emit("disconnect_reason", "logged_in_elsewhere");
      old.disconnect(true);
      players.delete(existing);
    }
  }

  const player = {
    socketId: socket.id,
    playerId: id.playerId,
    username: id.username,
    current_area: id.current_area,
    admin_level: id.admin_level,
    equipment: id.equipment || {},
    position_x: id.x,
    position_y: id.y,
    direction: "front",
    is_moving: false,
    animation_frame: "idle",
    destination_x: null,
    destination_y: null,
  };

  players.set(socket.id, player);
  socket.join(player.current_area);
  socket.emit("identify_ok", safePlayerView(player));

  const peers = Array.from(players.values())
    .filter((p) => p.current_area === player.current_area && p.socketId !== socket.id)
    .map(safePlayerView);

  socket.emit("current_players", peers);
  socket.to(player.current_area).emit("player_joined", safePlayerView(player));

  // 🚶 תנועת שחקן
  socket.on("move_to", (data) => {
    const p = players.get(socket.id);
    if (!p) return;

    const { x, y } = data;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    p.destination_x = Math.max(0, Math.min(1380, x));
    p.destination_y = Math.max(0, Math.min(770, y));
    p.is_moving = true;

    console.log(`🚶 ${p.username} moving to (${p.destination_x}, ${p.destination_y})`);
  });

  // 👕 עדכון ציוד
  socket.on("player_update", (data) => {
    const p = players.get(socket.id);
    if (!p || !data.equipment) return;

    p.equipment = data.equipment;
    socket.to(p.current_area).emit("player_update", {
      playerId: p.playerId,
      equipment: p.equipment,
    });

    console.log(`👕 ${p.username} updated equipment`);
  });

  // 🗺️ שינוי אזור
  socket.on("change_area", (data) => {
    const p = players.get(socket.id);
    if (!p || !data.newArea) return;

    const oldArea = p.current_area;
    p.current_area = data.newArea;
    p.is_moving = false;
    p.destination_x = null;
    p.destination_y = null;

    socket.leave(oldArea);
    socket.join(data.newArea);

    socket.to(oldArea).emit("player_disconnected", p.playerId);
    socket.to(data.newArea).emit("player_joined", safePlayerView(p));

    const peers = Array.from(players.values())
      .filter((other) => other.current_area === data.newArea && other.socketId !== socket.id)
      .map(safePlayerView);

    socket.emit("current_players", peers);

    console.log(`🗺️ ${p.username} moved from ${oldArea} to ${data.newArea}`);
  });

  // 💬 הודעות מערכת ממנהלים
  socket.on("admin_system_message", (messageData) => {
    const p = players.get(socket.id);
    if (!p) return;

    if (p.admin_level !== "admin" && p.admin_level !== "senior_touch") {
      console.log(`⚠️ Non-admin tried to send system message: ${p.username}`);
      return;
    }

    console.log(`📢 Admin message from ${messageData.sender_name} (${messageData.target_area})`);

    const systemMessage = {
      id: "system",
      playerId: "system",
      username: messageData.sender_name,
      admin_level: messageData.sender_level,
      message: messageData.message,
      timestamp: messageData.timestamp || Date.now(),
    };

    if (messageData.target_area === "current") {
      const targetArea = p.current_area;
      for (const [sid, player] of players) {
        if (player.current_area === targetArea) {
          io.to(sid).emit("chat_message", systemMessage);
        }
      }
      console.log(`✅ Sent system message to area: ${targetArea}`);
    } else {
      io.emit("chat_message", systemMessage);
      console.log(`✅ Sent system message to all players`);
    }
  });

  // 💬 צ׳אט רגיל
  socket.on("chat_message", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const msg = (data.message ?? data.text ?? "").toString().trim();
    if (!msg) return;
    if (!allowChat(socket.id)) {
      socket.emit("chat_rate_limited", { until: Date.now() + 8000 });
      return;
    }
    io.in(p.current_area).emit("chat_message", {
      id: p.playerId,
      playerId: p.playerId,
      username: p.username,
      admin_level: p.admin_level,
      message: msg,
      timestamp: Date.now(),
    });
    console.log(`💬 [${p.current_area}] ${p.username}: ${msg}`);
  });

  // ניתוק שחקן
  socket.on("disconnect", (reason) => {
    const p = players.get(socket.id);
    if (!p) return;
    console.log(`🔴 ${p.username} (${p.playerId}) disconnected: ${reason}`);
    socket.to(p.current_area).emit("player_disconnected", p.playerId);
    players.delete(socket.id);
  });
});

// ===================== SERVER START =====================
httpServer.listen(PORT, () => {
  console.log(`\n${"★".repeat(60)}`);
  console.log(`🚀 Touch World Server v${VERSION} - Port ${PORT}`);
  console.log(`🌍 https://touchworld-realtime.onrender.com`);
  console.log(`⚡ Game loop running at ${GAME_TICK_RATE} ticks/sec`);
  console.log(`${"★".repeat(60)}\n`);
});
