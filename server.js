// ============================================================================
// Touch World - Unified Socket Server (Node.js @ Render)
// Version 8.2.0 - Ultra Secure + Full Trades via Base44
// GitHub: https://github.com/orbaluu87/touchworld-realtime
// Deploy: https://touchworld-realtime.onrender.com/
// ============================================================================

import { createServer } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";
import fetch from "node-fetch";
import "dotenv/config";

// ---------- App & Middleware ----------
const app = express();
app.use(express.json());
app.use(helmet());

// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : "*",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// HTTP + Socket.IO
const httpServer = createServer(app);
const PORT = process.env.PORT || 10000;

// ---------- Env & Security ----------
const VERSION = "8.2.0-secure";
const VERIFY_TOKEN_URL = process.env.VERIFY_TOKEN_URL || "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/verifyWebSocketToken";
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const BASE44_API_URL = process.env.BASE44_API_URL || "https://base44.app/api/apps/68e269394d8f2fa24e82cd71";
const EXECUTE_TRADE_URL = process.env.EXECUTE_TRADE_URL || `${BASE44_API_URL}/functions/executeTrade`;
const HEALTH_KEY = process.env.HEALTH_KEY || "touch_world_health_2025";

// Limits
const MAX_CONN_PER_IP = parseInt(process.env.MAX_CONN_PER_IP || "4", 10);
const CHAT_WINDOW_MS = 2500;
const CHAT_MAX_IN_WINDOW = 5;
const TRADE_ACTION_WINDOW_MS = 2500;
const TRADE_MAX_ACTIONS_IN_WINDOW = 8;
const MAX_TRADE_ITEMS_PER_SIDE = 12;

if (!BASE44_SERVICE_KEY) {
  console.error("❌ Missing BASE44_SERVICE_KEY");
  process.exit(1);
}

// ---------- State ----------
const players = new Map();
const activeTrades = new Map();
const chatRateLimit = new Map();
const tradeRateLimit = new Map();
const ipConnections = new Map();
const playerLocks = new Map();

// ---------- Health Endpoints ----------
app.get("/healthz", (req, res) => {
  res.json({ ok: true, version: VERSION, ts: Date.now(), players: players.size });
});

app.get("/health", (req, res) => {
  const key = req.headers["x-health-key"];
  if (key !== HEALTH_KEY) return res.status(403).json({ error: "Forbidden" });
  res.json({ ok: true, version: VERSION, players: players.size, trades: activeTrades.size });
});

// ---------- Socket.IO ----------
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

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
    move_speed: 60,
    is_trading: !!p.activeTradeId,
  };
}

function getSocketIdByPlayerId(playerId) {
  for (const [sid, p] of players.entries()) {
    if (p.playerId === playerId) return sid;
  }
  return null;
}

function allowAction(limitMap, socketId, windowMs, maxInWindow, muteMs = 5000) {
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

function sanitizeOffer(raw = {}) {
  return {
    items: Array.isArray(raw.items) ? raw.items.slice(0, MAX_TRADE_ITEMS_PER_SIDE) : [],
    coins: Math.max(0, parseInt(raw.coins, 10) || 0),
    gems: Math.max(0, parseInt(raw.gems, 10) || 0),
  };
}

async function verifyTokenWithBase44(token) {
  try {
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
    return result.user;
  } catch (err) {
    console.error("❌ Token Verification Failed:", err.message);
    return null;
  }
}

async function executeTradeOnBase44(trade) {
  console.log(`[Trade Execute] ${trade.id}`);
  try {
    const resp = await fetch(EXECUTE_TRADE_URL, {
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
    if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
    console.log(`✅ Trade ${trade.id} executed`);
    return { success: true, data: json };
  } catch (e) {
    console.error(`❌ Trade ${trade.id} failed:`, e.message);
    return { success: false, error: e.message };
  }
}

function broadcastTradeStatus(tradeId) {
  const trade = activeTrades.get(tradeId);
  if (!trade) return;
  const initSid = getSocketIdByPlayerId(trade.initiatorId);
  const recvSid = getSocketIdByPlayerId(trade.receiverId);
  const payload = {
    id: trade.id,
    status: trade.status,
    initiator: initSid ? safePlayerView(players.get(initSid)) : { id: trade.initiatorId },
    receiver: recvSid ? safePlayerView(players.get(recvSid)) : { id: trade.receiverId },
    initiator_offer: trade.initiator_offer,
    receiver_offer: trade.receiver_offer,
    initiator_locked: trade.initiator_locked,
    receiver_locked: trade.receiver_locked,
    both_locked: trade.both_locked,
    initiator_confirmed_final: trade.initiator_confirmed_final,
    receiver_confirmed_final: trade.receiver_confirmed_final,
  };
  if (initSid) io.to(initSid).emit("trade_status_updated", payload);
  if (recvSid) io.to(recvSid).emit("trade_status_updated", payload);
}

// ---------- Socket Events ----------
io.on("connection", (socket) => {
  const ip = socket.handshake.address;
  console.log(`[Connect] ${socket.id} from ${ip}`);

  // IP limit
  const count = ipConnections.get(ip) || 0;
  if (count >= MAX_CONN_PER_IP) {
    console.warn(`[Reject] IP ${ip} exceeded limit`);
    socket.emit("disconnect_reason", "Too many connections from this IP");
    socket.disconnect(true);
    return;
  }
  ipConnections.set(ip, count + 1);

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`[Disconnect] ${player.username}`);
      io.to(player.current_area).emit("player_disconnected", player.playerId);
      if (player.activeTradeId) {
        const trade = activeTrades.get(player.activeTradeId);
        if (trade) {
          trade.status = "cancelled";
          broadcastTradeStatus(trade.id);
          activeTrades.delete(trade.id);
        }
      }
      players.delete(socket.id);
    }
    const newCount = ipConnections.get(ip) - 1;
    if (newCount <= 0) ipConnections.delete(ip);
    else ipConnections.set(ip, newCount);
  });

  socket.on("authenticate", async (authPayload) => {
    try {
      const userData = await verifyTokenWithBase44(authPayload.token);
      if (!userData) {
        socket.emit("disconnect_reason", "Invalid token");
        socket.disconnect(true);
        return;
      }

      // Check duplicate login
      for (const [sid, p] of players.entries()) {
        if (p.playerId === userData.player_data.id && sid !== socket.id) {
          io.to(sid).emit("disconnect_reason", "logged_in_elsewhere");
          io.sockets.sockets.get(sid)?.disconnect(true);
          players.delete(sid);
        }
      }

      const player = {
        socketId: socket.id,
        playerId: userData.player_data.id,
        userId: userData.player_data.user_id || userData.player_data.id,
        username: userData.player_data.username || userData.username,
        current_area: userData.player_data.current_area || "area1",
        admin_level: userData.player_data.admin_level || "user",
        equipment: userData.player_data.equipment || {},
        position_x: userData.player_data.position_x || 690,
        position_y: userData.player_data.position_y || 385,
        direction: userData.player_data.direction || "front",
        is_moving: false,
        animation_frame: "idle",
        move_speed: 60,
      };

      players.set(socket.id, player);
      socket.join(player.current_area);

      // Send current players in area
      const areaPlayers = Array.from(players.values())
        .filter((p) => p.current_area === player.current_area)
        .map(safePlayerView);
      socket.emit("current_players", areaPlayers);

      // Notify others
      socket.to(player.current_area).emit("player_joined", safePlayerView(player));
      console.log(`✅ [Auth] ${player.username} joined ${player.current_area}`);

    } catch (error) {
      console.error("[Auth Error]", error);
      socket.emit("disconnect_reason", "Authentication failed");
      socket.disconnect(true);
    }
  });

  socket.on("move_to", (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    player.position_x = data.x;
    player.position_y = data.y;
    player.is_moving = true;
    player.direction = data.direction || player.direction;
  });

  socket.on("player_update", (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    Object.assign(player, data);
    socket.to(player.current_area).emit("player_update", safePlayerView(player));
  });

  socket.on("chat_message", (data) => {
    const player = players.get(socket.id);
    if (!player || !data.message) return;
    if (!allowAction(chatRateLimit, socket.id, CHAT_WINDOW_MS, CHAT_MAX_IN_WINDOW, 8000)) {
      socket.emit("chat_rate_limited");
      return;
    }
    const payload = {
      id: player.playerId,
      playerId: player.playerId,
      username: player.username,
      message: data.message.substring(0, 100),
      timestamp: Date.now(),
    };
    io.to(player.current_area).emit("chat_message", payload);
  });

  socket.on("change_area", async (data) => {
    const player = players.get(socket.id);
    if (!player || !data.newArea) return;
    const oldArea = player.current_area;
    player.current_area = data.newArea;
    socket.leave(oldArea);
    socket.join(data.newArea);
    socket.to(oldArea).emit("player_area_changed", { id: player.playerId, newArea: data.newArea });
    const newPlayers = Array.from(players.values())
      .filter((p) => p.current_area === data.newArea)
      .map(safePlayerView);
    socket.emit("current_players", newPlayers);
    socket.to(data.newArea).emit("player_joined", safePlayerView(player));
    console.log(`[Area Change] ${player.username}: ${oldArea} -> ${data.newArea}`);
  });

  // ---------- Trade Events ----------
  socket.on("trade_request", (data) => {
    const initiator = players.get(socket.id);
    if (!initiator || !data.receiver?.id) return;
    if (!allowAction(tradeRateLimit, socket.id, TRADE_ACTION_WINDOW_MS, TRADE_MAX_ACTIONS_IN_WINDOW)) {
      socket.emit("trade_status_updated", { status: "failed", reason: "יותר מדי בקשות החלפה" });
      return;
    }
    const receiverSid = getSocketIdByPlayerId(data.receiver.id);
    if (!receiverSid) {
      socket.emit("trade_status_updated", { status: "failed", reason: "השחקן לא מחובר" });
      return;
    }
    const receiver = players.get(receiverSid);
    if (!receiver) return;
    if (initiator.activeTradeId || receiver.activeTradeId) {
      socket.emit("trade_status_updated", { status: "failed", reason: "אחד השחקנים כבר בהחלפה" });
      return;
    }
    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const trade = {
      id: tradeId,
      status: "pending",
      initiatorId: initiator.playerId,
      receiverId: receiver.playerId,
      initiator_offer: { items: [], coins: 0, gems: 0 },
      receiver_offer: { items: [], coins: 0, gems: 0 },
      initiator_locked: false,
      receiver_locked: false,
      both_locked: false,
      initiator_confirmed_final: false,
      receiver_confirmed_final: false,
      createdAt: Date.now(),
    };
    activeTrades.set(tradeId, trade);
    io.to(receiverSid).emit("trade_request_received", {
      trade_id: tradeId,
      initiator: safePlayerView(initiator),
    });
    console.log(`[Trade Request] ${initiator.username} -> ${receiver.username}`);
  });

  socket.on("trade_accept", (data) => {
    const trade = activeTrades.get(data.trade_id);
    if (!trade) return;
    const receiver = players.get(socket.id);
    if (!receiver || receiver.playerId !== trade.receiverId) return;
    const initSid = getSocketIdByPlayerId(trade.initiatorId);
    if (!initSid) {
      activeTrades.delete(trade.id);
      socket.emit("trade_status_updated", { status: "failed", reason: "השחקן השני התנתק" });
      return;
    }
    trade.status = "active";
    const initiator = players.get(initSid);
    initiator.activeTradeId = trade.id;
    receiver.activeTradeId = trade.id;
    broadcastTradeStatus(trade.id);
    console.log(`[Trade Accept] ${trade.id}`);
  });

  socket.on("trade_update_offer", (data) => {
    const trade = activeTrades.get(data.trade_id);
    if (!trade || trade.status !== "active") return;
    const player = players.get(socket.id);
    if (!player) return;
    if (!allowAction(tradeRateLimit, socket.id, TRADE_ACTION_WINDOW_MS, TRADE_MAX_ACTIONS_IN_WINDOW)) return;
    const isInitiator = player.playerId === trade.initiatorId;
    const offerKey = isInitiator ? "initiator_offer" : "receiver_offer";
    const lockedKey = isInitiator ? "initiator_locked" : "receiver_locked";
    if (trade[lockedKey]) return;
    trade[offerKey] = sanitizeOffer(data.offer);
    trade.both_locked = false;
    trade.initiator_confirmed_final = false;
    trade.receiver_confirmed_final = false;
    broadcastTradeStatus(trade.id);
  });

  socket.on("trade_lock", (data) => {
    const trade = activeTrades.get(data.trade_id);
    if (!trade || trade.status !== "active") return;
    const player = players.get(socket.id);
    if (!player) return;
    const isInitiator = player.playerId === trade.initiatorId;
    const lockedKey = isInitiator ? "initiator_locked" : "receiver_locked";
    trade[lockedKey] = true;
    if (trade.initiator_locked && trade.receiver_locked) {
      trade.both_locked = true;
    }
    broadcastTradeStatus(trade.id);
  });

  socket.on("trade_unlock", (data) => {
    const trade = activeTrades.get(data.trade_id);
    if (!trade || trade.status !== "active") return;
    const player = players.get(socket.id);
    if (!player) return;
    const isInitiator = player.playerId === trade.initiatorId;
    const lockedKey = isInitiator ? "initiator_locked" : "receiver_locked";
    trade[lockedKey] = false;
    trade.both_locked = false;
    trade.initiator_confirmed_final = false;
    trade.receiver_confirmed_final = false;
    broadcastTradeStatus(trade.id);
  });

  socket.on("trade_confirm_final", async (data) => {
    const trade = activeTrades.get(data.trade_id);
    if (!trade || trade.status !== "active" || !trade.both_locked) return;
    const player = players.get(socket.id);
    if (!player) return;
    const isInitiator = player.playerId === trade.initiatorId;
    const confirmKey = isInitiator ? "initiator_confirmed_final" : "receiver_confirmed_final";
    trade[confirmKey] = true;
    broadcastTradeStatus(trade.id);
    
    if (trade.initiator_confirmed_final && trade.receiver_confirmed_final) {
      if (playerLocks.get(trade.initiatorId) || playerLocks.get(trade.receiverId)) {
        broadcastTradeStatus(trade.id);
        return;
      }
      playerLocks.set(trade.initiatorId, true);
      playerLocks.set(trade.receiverId, true);
      trade.status = "executing";
      broadcastTradeStatus(trade.id);
      
      const result = await executeTradeOnBase44(trade);
      
      playerLocks.delete(trade.initiatorId);
      playerLocks.delete(trade.receiverId);
      
      if (result.success) {
        trade.status = "completed";
        const initSid = getSocketIdByPlayerId(trade.initiatorId);
        const recvSid = getSocketIdByPlayerId(trade.receiverId);
        if (initSid) {
          const p = players.get(initSid);
          p.activeTradeId = null;
          io.to(initSid).emit("trade_completed_successfully", { trade_id: trade.id });
        }
        if (recvSid) {
          const p = players.get(recvSid);
          p.activeTradeId = null;
          io.to(recvSid).emit("trade_completed_successfully", { trade_id: trade.id });
        }
        activeTrades.delete(trade.id);
        console.log(`✅ [Trade Complete] ${trade.id}`);
      } else {
        trade.status = "failed";
        trade.reason = result.error || "ההחלפה נכשלה";
        broadcastTradeStatus(trade.id);
        setTimeout(() => {
          const initSid = getSocketIdByPlayerId(trade.initiatorId);
          const recvSid = getSocketIdByPlayerId(trade.receiverId);
          if (initSid) players.get(initSid).activeTradeId = null;
          if (recvSid) players.get(recvSid).activeTradeId = null;
          activeTrades.delete(trade.id);
        }, 3000);
      }
    }
  });

  socket.on("trade_cancel", (data) => {
    const trade = activeTrades.get(data.trade_id);
    if (!trade) return;
    trade.status = "cancelled";
    trade.reason = data.reason || "ההחלפה בוטלה";
    broadcastTradeStatus(trade.id);
    const initSid = getSocketIdByPlayerId(trade.initiatorId);
    const recvSid = getSocketIdByPlayerId(trade.receiverId);
    if (initSid) players.get(initSid).activeTradeId = null;
    if (recvSid) players.get(recvSid).activeTradeId = null;
    activeTrades.delete(trade.id);
    console.log(`[Trade Cancel] ${trade.id}`);
  });
});

// ---------- Movement Loop ----------
setInterval(() => {
  const updates = [];
  for (const [sid, player] of players.entries()) {
    if (player.is_moving) {
      updates.push({
        id: player.playerId,
        position_x: player.position_x,
        position_y: player.position_y,
        direction: player.direction,
        is_moving: true,
        animation_frame: "walk",
      });
    }
  }
  if (updates.length > 0) {
    io.emit("players_moved", updates);
  }
}, 50);

// ---------- Start Server ----------
httpServer.listen(PORT, () => {
  console.log(`✅ Touch World Socket Server v${VERSION} running on port ${PORT}`);
  console.log(`🌍 Health: https://touchworld-realtime.onrender.com/healthz`);
});
