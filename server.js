// ============================================================================
// Touch World - Socket Server v9.0.0 - Enhanced Logging
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

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
  methods: ["GET", "POST"],
  credentials: true,
}));

const httpServer = createServer(app);
const PORT = process.env.PORT || 10000;

const JWT_SECRET = process.env.WSS_JWT_SECRET || process.env.JWT_SECRET;
const VERIFY_TOKEN_URL = process.env.VERIFY_TOKEN_URL || "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/verifyWebSocketToken";
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const BASE44_API_URL = process.env.BASE44_API_URL || "https://base44.app/api/apps/68e269394d8f2fa24e82cd71";
const HEALTH_KEY = process.env.HEALTH_KEY;

if (!JWT_SECRET || !BASE44_SERVICE_KEY || !HEALTH_KEY) {
  console.error("❌ Missing security keys");
  process.exit(1);
}

const VERSION = "9.0.0";

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
    list: Array.from(players.values()).map(p => ({ id: p.playerId, user: p.username, area: p.current_area }))
  });
});

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins.length > 0 ? allowedOrigins : "*", methods: ["GET", "POST"] },
  transports: ["websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

const players = new Map();
const activeTrades = new Map();
const chatRateLimit = new Map();

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

async function verifyTokenWithBase44(token) {
  try {
    console.log("🔐 Verifying token...");
    const response = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${BASE44_SERVICE_KEY}` },
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

async function executeTradeOnBase44(trade) {
  console.log(`[Trade Execute] ${trade.id}`);
  try {
    const resp = await fetch(`${BASE44_API_URL}/functions/executeTrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${BASE44_SERVICE_KEY}` },
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
    initiator: initSid ? safePlayerView(players.get(initSid)) : { id: trade.initiatorId, username: "Disconnected" },
    receiver: recvSid ? safePlayerView(players.get(recvSid)) : { id: trade.receiverId, username: "Disconnected" },
    initiator_offer: trade.initiator_offer,
    receiver_offer: trade.receiver_offer,
    chatHistory: trade.chatHistory || [],
    reason: trade.reason || null,
  };
  if (initSid) io.to(initSid).emit("trade_status_updated", payload);
  if (recvSid) io.to(recvSid).emit("trade_status_updated", payload);
}

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
    x: Number.isFinite(user.player_data.position_x) ? user.player_data.position_x : 600,
    y: Number.isFinite(user.player_data.position_y) ? user.player_data.position_y : 400,
  };
  console.log("✅ Authenticated:", socket.identity.username);
  next();
});

io.on("connection", (socket) => {
  const id = socket.identity;
  console.log("\n🟢 ============ CONNECTION ============");
  console.log(`Player: ${id.username} (ID: ${id.playerId})`);
  console.log(`Socket: ${socket.id}`);
  console.log(`Area: ${id.current_area}`);
  console.log(`Total Players: ${players.size + 1}`);
  console.log("=====================================\n");

  const existing = getSocketIdByPlayerId(id.playerId);
  if (existing && existing !== socket.id) {
    console.log(`⚠️ DUPLICATE CONNECTION - Kicking old socket ${existing}`);
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
  };

  players.set(socket.id, player);
  socket.join(player.current_area);
  socket.emit("identify_ok", safePlayerView(player));

  const peers = Array.from(players.values())
    .filter((p) => p.current_area === player.current_area && p.socketId !== socket.id)
    .map(safePlayerView);

  console.log(`📋 Sending ${peers.length} players to ${player.username}`);
  peers.forEach(p => console.log(`   - ${p.username}`));
  
  socket.emit("current_players", peers);
  socket.to(player.current_area).emit("player_joined", safePlayerView(player));
  
  console.log(`📢 Announced ${player.username} to ${peers.length} players\n`);

  socket.on("move_to", (data) => {
    const p = players.get(socket.id);
    if (!p || !Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
    p.is_moving = true;
    p.position_x = data.x;
    p.position_y = data.y;
    const dx = data.x - p.position_x;
    const dy = data.y - p.position_y;
    p.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : (dy > 0 ? "s" : "n");
    p.animation_frame = "walk1";
    io.in(p.current_area).emit("players_moved", [safePlayerView(p)]);
  });

  socket.on("player_update", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (Number.isFinite(data.x)) p.position_x = data.x;
    if (Number.isFinite(data.y)) p.position_y = data.y;
    if (data.direction) p.direction = data.direction;
    if (typeof data.is_moving === "boolean") p.is_moving = data.is_moving;
    if (data.animation_frame) p.animation_frame = data.animation_frame;
    if (data.equipment) {
      p.equipment = data.equipment;
      console.log(`👕 ${p.username} updated equipment`);
    }
    socket.to(p.current_area).emit("player_update", safePlayerView(p));
  });

  socket.on("change_area", (data = {}) => {
    const p = players.get(socket.id);
    if (!p || !data.newArea || p.current_area === data.newArea) return;
    const old = p.current_area;
    console.log(`\n🚪 AREA CHANGE: ${p.username}`);
    console.log(`   From: ${old} → To: ${data.newArea}\n`);
    socket.to(old).emit("player_area_changed", { id: p.playerId });
    socket.leave(old);
    p.current_area = data.newArea;
    socket.join(p.current_area);
    const newPeers = Array.from(players.values())
      .filter((pp) => pp.current_area === p.current_area && pp.socketId !== socket.id)
      .map(safePlayerView);
    console.log(`📋 ${newPeers.length} players in new area`);
    socket.emit("current_players", newPeers);
    socket.to(p.current_area).emit("player_joined", safePlayerView(p));
  });

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
      message: msg,
      timestamp: Date.now(),
    });
    console.log(`💬 [${p.current_area}] ${p.username}: ${msg}`);
  });

  socket.on("trade_request", (data = {}) => {
    const sender = players.get(socket.id);
    const targetId = data?.receiver?.id;
    if (!sender || !targetId) return;
    const receiverSocketId = getSocketIdByPlayerId(targetId);
    if (!receiverSocketId) {
      socket.emit("trade_status_updated", { status: "cancelled", reason: "השחקן אינו מחובר." });
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
    io.to(receiverSocketId).emit("trade_request_received", { trade_id: tradeId, initiator: safePlayerView(sender) });
    console.log(`🔄 Trade request: ${sender.username} → ${targetId}`);
  });

  socket.on("trade_accept", (data = {}) => {
    const trade = activeTrades.get(data.trade_id);
    const p = players.get(socket.id);
    if (trade && p?.playerId === trade.receiverId && trade.status === "pending") {
      trade.status = "started";
      broadcastTradeStatus(trade.id);
      console.log(`✅ Trade ${trade.id} accepted`);
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
    const side = p.playerId === trade.initiatorId ? "initiator_offer" : "receiver_offer";
    if (trade[side].is_confirmed) return;
    trade[side].is_confirmed = true;
    if (trade.initiator_offer.is_confirmed && trade.receiver_offer.is_confirmed) {
      trade.status = "executing";
      broadcastTradeStatus(trade.id);
      const result = await executeTradeOnBase44(trade);
      if (result.success) {
        const initSid = getSocketIdByPlayerId(trade.initiatorId);
        const recvSid = getSocketIdByPlayerId(trade.receiverId);
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
      } else {
        trade.status = "failed";
        trade.reason = result.error;
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
    if (initSid && players.get(initSid)) delete players.get(initSid).activeTradeId;
    if (recvSid && players.get(recvSid)) delete players.get(recvSid).activeTradeId;
    activeTrades.delete(trade.id);
  });

  socket.on("disconnect", (reason) => {
    const p = players.get(socket.id);
    if (!p) return;
    console.log("\n🔴 ========== DISCONNECT ==========");
    console.log(`Player: ${p.username} (ID: ${p.playerId})`);
    console.log(`Socket: ${socket.id}`);
    console.log(`Reason: ${reason}`);
    console.log(`Remaining: ${players.size - 1}`);
    console.log("===================================\n");
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
  });
});

httpServer.listen(PORT, () => {
  console.log(`\n${"★".repeat(60)}`);
  console.log(`🚀 Touch World Server v${VERSION} - Port ${PORT}`);
  console.log(`🌍 https://touchworld-realtime.onrender.com`);
  console.log(`${"★".repeat(60)}\n`);
});
