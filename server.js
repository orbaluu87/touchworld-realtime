// ============================================================================
// Touch World - Socket Server v9.3.0 - Silent Movement Mode
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

const VERSION = "9.3.0";

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
    move_speed: 120,
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
function broadcastTradeStatus(tradeId, status, reason = null) {
  const trade = activeTrades.get(tradeId);
  if (!trade) return;

  const initiatorSocket = getSocketIdByPlayerId(trade.initiatorId);
  const receiverSocket = getSocketIdByPlayerId(trade.receiverId);

  const payload = { tradeId, status, reason };

  if (initiatorSocket) io.to(initiatorSocket).emit("trade_status_updated", payload);
  if (receiverSocket) io.to(receiverSocket).emit("trade_status_updated", payload);
}

// Socket.IO connection handler
io.on("connection", async (socket) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    console.log("❌ No token provided");
    socket.emit("disconnect_reason", "no_token");
    socket.disconnect(true);
    return;
  }

  const user = await verifyTokenWithBase44(token);
  if (!user) {
    console.log("❌ Invalid token");
    socket.emit("disconnect_reason", "invalid_token");
    socket.disconnect(true);
    return;
  }

  // Check for duplicate connection
  for (const [sid, p] of players.entries()) {
    if (p.playerId === user.playerId && sid !== socket.id) {
      console.log(`⚠️ Duplicate login detected for ${user.username}`);
      io.to(sid).emit("disconnect_reason", "logged_in_elsewhere");
      io.sockets.sockets.get(sid)?.disconnect(true);
      players.delete(sid);
    }
  }

  players.set(socket.id, {
    socketId: socket.id,
    playerId: user.playerId,
    userId: user.userId,
    username: user.username,
    admin_level: user.admin_level,
    current_area: user.current_area || "area1",
    equipment: user.equipment || {},
    position_x: user.position_x || 600,
    position_y: user.position_y || 400,
    direction: user.direction || "front",
    is_moving: false,
    animation_frame: "idle",
    keep_away_mode: user.keep_away_mode || false,
    is_invisible: user.is_invisible || false,
  });

  console.log(`🟢 Player connected: ${user.username} (${user.playerId})`);

  // Send current players in same area
  const playersInArea = Array.from(players.values())
    .filter((p) => p.current_area === user.current_area)
    .map(safePlayerView);

  socket.emit("current_players", playersInArea);

  // Broadcast to others
  socket.broadcast.emit("player_joined", safePlayerView(players.get(socket.id)));

  // ==================== MOVE_TO (ללא לוגים!) ====================
  socket.on("move_to", (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { x, y } = data;
    if (typeof x !== "number" || typeof y !== "number") return;

    player.position_x = x;
    player.position_y = y;
    player.is_moving = true;

    // ✅ שידור לכולם באותו אזור - ללא לוג!
    const playersInArea = Array.from(players.values()).filter(
      (p) => p.current_area === player.current_area
    );

    playersInArea.forEach((p) => {
      const sid = getSocketIdByPlayerId(p.playerId);
      if (sid) {
        io.to(sid).emit("players_moved", [
          {
            id: player.playerId,
            playerId: player.playerId,
            position_x: player.position_x,
            position_y: player.position_y,
            is_moving: player.is_moving,
            direction: player.direction,
            animation_frame: "walk",
          },
        ]);
      }
    });
  });

  // ==================== PLAYER_UPDATE ====================
  socket.on("player_update", (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    if (data.equipment) player.equipment = data.equipment;
    if (data.direction) player.direction = data.direction;

    socket.broadcast.emit("player_update", {
      id: player.playerId,
      playerId: player.playerId,
      ...data,
    });
  });

  // ==================== CHAT_MESSAGE ====================
  socket.on("chat_message", (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const now = Date.now();
    const userRateKey = `${player.playerId}_chat`;
    const lastMessageTime = chatRateLimit.get(userRateKey) || 0;

    if (now - lastMessageTime < 1000) {
      socket.emit("chat_rate_limited");
      return;
    }

    chatRateLimit.set(userRateKey, now);

    const chatPayload = {
      id: player.playerId,
      playerId: player.playerId,
      username: player.username,
      admin_level: player.admin_level,
      message: data.message,
      timestamp: now,
    };

    console.log(`💬 [${player.current_area}] ${player.username}: ${data.message}`);

    // שידור לכולם באותו אזור
    const playersInArea = Array.from(players.values()).filter(
      (p) => p.current_area === player.current_area
    );

    playersInArea.forEach((p) => {
      const sid = getSocketIdByPlayerId(p.playerId);
      if (sid) io.to(sid).emit("chat_message", chatPayload);
    });
  });

  // ==================== ADMIN_SYSTEM_MESSAGE ====================
  socket.on("admin_system_message", (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    // רק מנהלים
    if (player.admin_level !== "admin" && player.admin_level !== "senior_touch") {
      return;
    }

    console.log(`📢 Admin message from ${player.username}: ${data.message}`);

    // שידור לכולם
    io.emit("chat_message", {
      id: "system",
      playerId: "system",
      username: player.username,
      admin_level: player.admin_level,
      message: data.message,
      timestamp: Date.now(),
    });
  });

  // ==================== CHANGE_AREA ====================
  socket.on("change_area", (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    const { newArea } = data;
    const oldArea = player.current_area;

    player.current_area = newArea;

    console.log(`🚪 ${player.username} moved: ${oldArea} → ${newArea}`);

    // הודעה לאזור הישן
    socket.broadcast.emit("player_area_changed", {
      playerId: player.playerId,
      oldArea,
      newArea,
    });

    // שלח רשימת שחקנים באזור החדש
    const playersInNewArea = Array.from(players.values())
      .filter((p) => p.current_area === newArea)
      .map(safePlayerView);

    socket.emit("current_players", playersInNewArea);

    // הודע לשאר באזור החדש
    socket.broadcast.emit("player_joined", safePlayerView(player));
  });

  // ==================== TRADE SYSTEM ====================
  socket.on("trade_request", (data) => {
    const initiator = players.get(socket.id);
    if (!initiator) return;

    const receiverSocketId = getSocketIdByPlayerId(data.receiver.id);
    if (!receiverSocketId) return;

    const receiver = players.get(receiverSocketId);
    if (!receiver) return;

    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const trade = {
      id: tradeId,
      initiatorId: initiator.playerId,
      receiverId: receiver.playerId,
      initiator_offer: { items: [], coins: 0, gems: 0 },
      receiver_offer: { items: [], coins: 0, gems: 0 },
      status: "pending",
    };

    activeTrades.set(tradeId, trade);

    console.log(`🔄 Trade request: ${initiator.username} → ${receiver.username}`);

    io.to(receiverSocketId).emit("trade_request_received", {
      trade_id: tradeId,
      initiator: safePlayerView(initiator),
    });
  });

  socket.on("trade_accept", (data) => {
    const { trade_id } = data;
    const trade = activeTrades.get(trade_id);
    if (!trade) return;

    trade.status = "started";
    broadcastTradeStatus(trade_id, "started");

    console.log(`✅ Trade accepted: ${trade_id}`);
  });

  socket.on("trade_cancel", (data) => {
    const { trade_id, reason } = data;
    const trade = activeTrades.get(trade_id);
    if (!trade) return;

    trade.status = "cancelled";
    broadcastTradeStatus(trade_id, "cancelled", reason);
    activeTrades.delete(trade_id);

    console.log(`❌ Trade cancelled: ${trade_id}`);
  });

  // ==================== DISCONNECT ====================
  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (!player) return;

    console.log(`❌ Player disconnected: ${player.username}`);

    socket.broadcast.emit("player_disconnected", player.playerId);
    players.delete(socket.id);
  });
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Touch World Server v${VERSION} - Port ${PORT}`);
  console.log(`🌍 https://touchworld-realtime.onrender.com`);
});
