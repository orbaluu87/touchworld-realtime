// ============================================================================
// Touch World - Unified Socket Server (Node.js @ Render)
// Version 8.5.0 - Full Sync with Base44
// ============================================================================

import { createServer } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";
import fetch from "node-fetch";
import "dotenv/config";

// ---------- Configuration ----------
const app = express();
app.use(express.json());
app.use(helmet());

// CORS Settings
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

const httpServer = createServer(app);
const PORT = process.env.PORT || 10000;

// ---------- Critical Security Keys ----------
const JWT_SECRET = process.env.WSS_JWT_SECRET || process.env.JWT_SECRET;
const VERIFY_TOKEN_URL = process.env.VERIFY_TOKEN_URL || "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/verifyWebSocketToken";
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const BASE44_API_URL = process.env.BASE44_API_URL || "https://base44.app/api/apps/68e269394d8f2fa24e82cd71";
const HEALTH_KEY = process.env.HEALTH_KEY;
const SHARED_SECRET_KEY = process.env.SHARED_SECRET_KEY;

if (!JWT_SECRET || !BASE44_SERVICE_KEY || !HEALTH_KEY) {
  console.error("❌ Missing critical security keys");
  process.exit(1);
}

// ---------- Health Endpoints ----------
const VERSION = "8.5.0-unified";

app.get("/healthz", (req, res) => {
  res.status(200).json({
    ok: true,
    version: VERSION,
    ts: Date.now(),
    players: players.size,
  });
});

app.get("/health", (req, res) => {
  const key = req.headers["x-health-key"] || req.query.key;
  if (key !== HEALTH_KEY)
    return res.status(403).json({ ok: false, error: "Forbidden" });
  res.status(200).json({
    ok: true,
    version: VERSION,
    ts: Date.now(),
    players: players.size,
    trades: activeTrades.size,
  });
});

// ---------- 🔗 Proxy API Endpoints for Base44 Entities ----------
app.get("/api/player", async (req, res) => {
  try {
    const url = `${BASE44_API_URL}/entities/Player`;
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${BASE44_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching Player:", err);
    res.status(500).json({ error: "Failed to fetch Player data" });
  }
});

app.get("/api/gamestats", async (req, res) => {
  try {
    const url = `${BASE44_API_URL}/entities/GameStats`;
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${BASE44_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching GameStats:", err);
    res.status(500).json({ error: "Failed to fetch GameStats" });
  }
});

// ---------- Socket.IO Setup ----------
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ---------- State ----------
const players = new Map();
const activeTrades = new Map();
const chatRateLimit = new Map();

// ---------- Helpers ----------
function safePlayerView(p) {
  if (!p) return null;
  return {
    id: p.playerId,
    username: p.username,
    current_area: p.current_area,
    admin_level: p.admin_level,
    equipment: p.equipment || {},
    position_x: p.position_x,
    position_y: p.position_y,
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

// 🔒 אימות טוקן דרך Base44
async function verifyTokenWithBase44(token) {
  try {
    const response = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BASE44_SERVICE_KEY}`,
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

// 🔒 ביצוע החלפה דרך Base44
async function executeTradeOnBase44(trade) {
  console.log(`[Trade Execute] ${trade.id}`);
  const url = `${BASE44_API_URL}/functions/executeTrade`;
  const payload = {
    initiator_id: trade.initiatorId,
    receiver_id: trade.receiverId,
    initiator_offer_items: trade.initiator_offer.items || [],
    initiator_offer_coins: trade.initiator_offer.coins || 0,
    initiator_offer_gems: trade.initiator_offer.gems || 0,
    receiver_offer_items: trade.receiver_offer.items || [],
    receiver_offer_coins: trade.receiver_offer.coins || 0,
    receiver_offer_gems: trade.receiver_offer.gems || 0,
  };

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await resp.json();
    if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
    console.log(`✅ Trade ${trade.id} executed successfully`);
    return { success: true, data: json };
  } catch (e) {
    console.error(`❌ Trade ${trade.id} failed:`, e);
    return { success: false, error: e?.message || "unknown error" };
  }
}

function broadcastTradeStatus(tradeId) {
  const trade = activeTrades.get(tradeId);
  if (!trade) return;

  const initSid = getSocketIdByPlayerId(trade.initiatorId);
  const recvSid = getSocketIdByPlayerId(trade.receiverId);
  const initPlayer = initSid ? players.get(initSid) : null;
  const recvPlayer = recvSid ? players.get(recvSid) : null;

  const payload = {
    id: trade.id,
    status: trade.status,
    initiatorId: trade.initiatorId,
    receiverId: trade.receiverId,
    initiator: initPlayer
      ? safePlayerView(initPlayer)
      : { id: trade.initiatorId, username: "Disconnected" },
    receiver: recvPlayer
      ? safePlayerView(recvPlayer)
      : { id: trade.receiverId, username: "Disconnected" },
    initiator_offer: trade.initiator_offer,
    receiver_offer: trade.receiver_offer,
    chatHistory: trade.chatHistory || [],
    reason: trade.reason || null,
  };

  if (initSid) io.to(initSid).emit("trade_status_updated", payload);
  if (recvSid) io.to(recvSid).emit("trade_status_updated", payload);
}

// 🔒 Chat Anti-Spam
const CHAT_WINDOW_MS = parseInt(process.env.CHAT_WINDOW_MS) || 2500;
const CHAT_MAX_IN_WINDOW = parseInt(process.env.CHAT_MAX_IN_WINDOW) || 5;

function allowChat(socketId) {
  const now = Date.now();
  const bucket = chatRateLimit.get(socketId) || { ts: [], mutedUntil: 0 };
  
  if (now < bucket.mutedUntil) return false;

  bucket.ts = bucket.ts.filter((t) => now - t < CHAT_WINDOW_MS);
  bucket.ts.push(now);

  if (bucket.ts.length > CHAT_MAX_IN_WINDOW) {
    bucket.mutedUntil = now + 8000;
    chatRateLimit.set(socketId, bucket);
    return false;
  }

  chatRateLimit.set(socketId, bucket);
  return true;
}

// ---------- Auth Middleware ----------
io.use(async (socket, next) => {
  const auth = socket.handshake.auth || {};

  // 🔒 JWT Authentication (מאובטח)
  if (auth.token) {
    const user = await verifyTokenWithBase44(auth.token);
    if (!user || !user.player_data?.id) {
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
      x: Number.isFinite(user.player_data.position_x) ? user.player_data.position_x : 600,
      y: Number.isFinite(user.player_data.position_y) ? user.player_data.position_y : 400,
    };
  } else {
    return next(new Error("Authentication required"));
  }

  next();
});

// ---------- Connection ----------
io.on("connection", (socket) => {
  const id = socket.identity;
  console.log(`[+] ${id.username} (${id.playerId}) connected`);

  // 🔒 מניעת חיבורים כפולים
  const existing = getSocketIdByPlayerId(id.playerId);
  if (existing && existing !== socket.id) {
    const old = io.sockets.sockets.get(existing);
    if (old) {
      console.log(`[!] Kicking old socket for ${id.playerId}`);
      old.emit("disconnect_reason", "logged_in_elsewhere");
      old.disconnect(true);
    }
  }

  // רישום שחקן
  const player = {
    socketId: socket.id,
    playerId: id.playerId,
    userId: id.userId,
    username: id.username,
    current_area: id.current_area,
    admin_level: id.admin_level,
    equipment: id.equipment || {},
    position_x: id.x,
    position_y: id.y,
    direction: "front",
    is_moving: false,
    animation_frame: "idle",
    move_type: "walk",
    move_speed: 60,
  };

  players.set(socket.id, player);

  // הצטרפות לחדר
  socket.join(player.current_area);
  socket.emit("identify_ok", safePlayerView(player));

  // שליחת רשימת שחקנים
  const peers = Array.from(players.values())
    .filter((p) => p.current_area === player.current_area && p.socketId !== socket.id)
    .map(safePlayerView);

  socket.emit("current_players", peers);
  socket.to(player.current_area).emit("player_joined", safePlayerView(player));

  // ---------- תנועה ----------
  socket.on("move_to", (data) => {
    const p = players.get(socket.id);
    if (!p || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;

    p.is_moving = true;
    p.position_x = data.x;
    p.position_y = data.y;

    const dx = data.x - p.position_x;
    const dy = data.y - p.position_y;
    if (Math.abs(dx) > Math.abs(dy)) {
      p.direction = dx > 0 ? "e" : "w";
    } else {
      p.direction = dy > 0 ? "s" : "n";
    }

    p.animation_frame = "walk1";

    const moveData = [safePlayerView(p)];
    io.in(p.current_area).emit("players_moved", moveData);
  });

  socket.on("player_update", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    if (Number.isFinite(data.x)) p.position_x = data.x;
    if (Number.isFinite(data.y)) p.position_y = data.y;
    if (typeof data.direction === "string") p.direction = data.direction;
    if (typeof data.is_moving === "boolean") p.is_moving = data.is_moving;
    if (typeof data.animation_frame === "string")
      p.animation_frame = data.animation_frame;
    if (typeof data.move_type === "string") p.move_type = data.move_type;

    if (data.equipment && typeof data.equipment === "object") {
      p.equipment = data.equipment;
    }

    socket.to(p.current_area).emit("player_update", safePlayerView(p));
  });

  // ---------- שינוי אזור ----------
  socket.on("change_area", (data = {}) => {
    const p = players.get(socket.id);
    if (!p || !data.newArea) return;

    const old = p.current_area;
    if (old === data.newArea) return;

    socket.to(old).emit("player_area_changed", { id: p.playerId });
    socket.leave(old);

    p.current_area = data.newArea;
    socket.join(p.current_area);

    const newPeers = Array.from(players.values())
      .filter((pp) => pp.current_area === p.current_area && pp.socketId !== socket.id)
      .map(safePlayerView);

    socket.emit("current_players", newPeers);
    socket.to(p.current_area).emit("player_joined", safePlayerView(p));
    console.log(`[~] ${p.username} moved ${old} -> ${p.current_area}`);
  });

  // ---------- צ'אט ----------
  socket.on("chat_message", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    const msg = (data.message ?? data.text ?? "").toString().trim();
    if (!msg) return;

    if (!allowChat(socket.id)) {
      socket.emit("chat_rate_limited", { until: Date.now() + 8000 });
      return;
    }

    const payload = {
      id: p.playerId,
      playerId: p.playerId,
      message: msg,
      text: msg,
      timestamp: Date.now(),
    };

    io.in(p.current_area).emit("chat_message", payload);
    console.log(`[chat] ${p.username}: ${msg}`);
  });

  // ---------- מערכת החלפות ----------
  socket.on("trade_request", (data = {}) => {
    const sender = players.get(socket.id);
    const targetId = data?.receiver?.id;
    if (!sender || !targetId) return;

    const receiverSocketId = getSocketIdByPlayerId(targetId);
    if (!receiverSocketId) {
      socket.emit("trade_status_updated", {
        status: "cancelled",
        reason: "השחקן אינו מחובר.",
      });
      return;
    }

    const tradeId = `${sender.playerId}_${targetId}_${Date.now()}`;
    activeTrades.set(tradeId, {
      id: tradeId,
      initiatorId: sender.playerId,
      receiverId: targetId,
      initiator_offer: { items: [], coins: 0, gems: 0, is_confirmed: false },
      receiver_offer: { items: [], coins: 0, gems: 0, is_confirmed: false },
      chatHistory: [],
      status: "pending",
    });

    sender.activeTradeId = tradeId;
    const receiver = players.get(receiverSocketId);
    if (receiver) receiver.activeTradeId = tradeId;

    io.to(receiverSocketId).emit("trade_request_received", {
      trade_id: tradeId,
      initiator: safePlayerView(sender),
    });

    console.log(`[Trade] Request from ${sender.username} to ${targetId}`);
  });

  socket.on("trade_accept", (data = {}) => {
    const trade = activeTrades.get(data.trade_id);
    const p = players.get(socket.id);
    if (trade && p?.playerId === trade.receiverId && trade.status === "pending") {
      trade.status = "started";
      broadcastTradeStatus(trade.id);
      console.log(`[Trade] ${trade.id} accepted, status: started`);
    }
  });

  socket.on("trade_update", (data = {}) => {
    const trade = activeTrades.get(data.trade_id);
    const p = players.get(socket.id);
    if (!trade || !p || trade.status !== "started") return;

    const isInitiator = p.playerId === trade.initiatorId;
    const side = isInitiator ? "initiator_offer" : "receiver_offer";

    trade.initiator_offer.is_confirmed = false;
    trade.receiver_offer.is_confirmed = false;

    const offer = data.offer || {};
    trade[side] = {
      items: Array.isArray(offer.items) ? offer.items : [],
      coins: Math.max(0, parseInt(offer.coins, 10) || 0),
      gems: Math.max(0, parseInt(offer.gems, 10) || 0),
      is_confirmed: false,
    };

    broadcastTradeStatus(trade.id);
  });

  socket.on("trade_confirm", async (data = {}) => {
    const trade = activeTrades.get(data.trade_id);
    const p = players.get(socket.id);
    if (!trade || !p || trade.status !== "started") return;

    const isInitiator = p.playerId === trade.initiatorId;
    const side = isInitiator ? "initiator_offer" : "receiver_offer";

    if (trade[side].is_confirmed) return;
    trade[side].is_confirmed = true;

    if (
      trade.initiator_offer.is_confirmed &&
      trade.receiver_offer.is_confirmed
    ) {
      trade.status = "executing";
      broadcastTradeStatus(trade.id);

      const result = await executeTradeOnBase44(trade);

      const initSid = getSocketIdByPlayerId(trade.initiatorId);
      const recvSid = getSocketIdByPlayerId(trade.receiverId);

      if (result.success) {
        if (initSid) {
          io.to(initSid).emit("trade_completed_successfully");
          const initPlayer = players.get(initSid);
          if (initPlayer) delete initPlayer.activeTradeId;
        }
        if (recvSid) {
          io.to(recvSid).emit("trade_completed_successfully");
          const recvPlayer = players.get(recvSid);
          if (recvPlayer) delete recvPlayer.activeTradeId;
        }
        console.log(`✅ [Trade] ${trade.id} completed`);
      } else {
        trade.status = "failed";
        trade.reason = result.error || "ההחלפה נכשלה.";
        broadcastTradeStatus(trade.id);
      }

      activeTrades.delete(trade.id);
    } else {
      broadcastTradeStatus(trade.id);
    }
  });

  socket.on("trade_cancel", (data = {}) => {
    const trade = activeTrades.get(data.trade_id);
    if (!trade) return;

    trade.status = "cancelled";
    trade.reason = data.reason || "ההחלפה בוטלה";
    broadcastTradeStatus(trade.id);

    const initSid = getSocketIdByPlayerId(trade.initiatorId);
    const recvSid = getSocketIdByPlayerId(trade.receiverId);

    if (initSid) {
      const initPlayer = players.get(initSid);
      if (initPlayer) delete initPlayer.activeTradeId;
    }
    if (recvSid) {
      const recvPlayer = players.get(recvSid);
      if (recvPlayer) delete recvPlayer.activeTradeId;
    }

    activeTrades.delete(trade.id);
    console.log(`[Trade] ${trade.id} cancelled`);
  });

  socket.on("trade_chat_message", (data = {}) => {
    const trade = activeTrades.get(data.trade_id);
    const sender = players.get(socket.id);
    const text = (data.message || "").toString().trim().slice(0, 100);
    if (!trade || !sender || !text || trade.status !== "started") return;

    trade.chatHistory.push({
      senderId: sender.playerId,
      senderName: sender.username,
      message: text,
      timestamp: new Date().toISOString(),
    });

    const initSid = getSocketIdByPlayerId(trade.initiatorId);
    const recvSid = getSocketIdByPlayerId(trade.receiverId);

    const chatPayload = {
      tradeId: trade.id,
      senderId: sender.playerId,
      senderName: sender.username,
      message: text,
      timestamp: new Date().toISOString(),
    };

    if (initSid) io.to(initSid).emit("new_trade_message", chatPayload);
    if (recvSid) io.to(recvSid).emit("new_trade_message", chatPayload);
  });

  // ---------- התנתקות ----------
  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    if (!p) return;

    socket.to(p.current_area).emit("player_disconnected", p.playerId);

    for (const [tid, t] of activeTrades.entries()) {
      if (t.initiatorId === p.playerId || t.receiverId === p.playerId) {
        t.status = "cancelled";
        t.reason = "המשתתף השני התנתק.";
        broadcastTradeStatus(tid);
        activeTrades.delete(tid);
      }
    }

    players.delete(socket.id);
    console.log(`[-] ${p.username} disconnected`);
  });
});

// ---------- Start ----------
httpServer.listen(PORT, () => {
  console.log(`🚀 Touch World Socket Server v${VERSION} on :${PORT}`);
  console.log(`🌍 https://touchworld-realtime.onrender.com`);
});
