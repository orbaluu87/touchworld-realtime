// ============================================================================
// Touch World - Socket Server v9.3.1 - Debug Movement Mode + Rooms by Area
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

// ---------- Server ----------
const httpServer = createServer(app);
const PORT = process.env.PORT || 10000;

// ---------- Env / Security ----------
const JWT_SECRET = process.env.WSS_JWT_SECRET || process.env.JWT_SECRET;
const VERIFY_TOKEN_URL =
  process.env.VERIFY_TOKEN_URL ||
  "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/verifyWebSocketToken";
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const BASE44_API_URL =
  process.env.BASE44_API_URL ||
  "https://base44.app/api/apps/68e269394d8f2fa24e82cd71";
const HEALTH_KEY = process.env.HEALTH_KEY || "secret-health";

if (!JWT_SECRET || !BASE44_SERVICE_KEY || !HEALTH_KEY) {
  console.error("❌ Missing security keys (JWT_SECRET/BASE44_SERVICE_KEY/HEALTH_KEY)");
  process.exit(1);
}

const VERSION = "9.3.1";

// ---------- State ----------
/** Map<socketId, Player> */
const players = new Map();
/** Map<tradeId, Trade> */
const activeTrades = new Map();
/** Map<string, number> */
const chatRateLimit = new Map();

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
    is_trading: !!p.activeTradeId,
  };
}

function getSocketIdByPlayerId(playerId) {
  for (const [sid, p] of players.entries()) {
    if (p.playerId === playerId) return sid;
  }
  return null;
}

/** נורמליזציה לתשובה של verifyWebSocketToken (תומך גם result.user וגם result.user.player_data) */
function normalizeUserShape(userAny) {
  // אם זה מגיע כ { player_data: {...} }
  const pd = userAny?.player_data || userAny;

  const playerId =
    pd?.id ?? pd?.playerId ?? pd?.userId ?? userAny?.id ?? userAny?.playerId;

  return {
    playerId,
    userId: pd?.userId ?? playerId,
    username: pd?.username ?? "Guest",
    current_area: pd?.current_area ?? "area1",
    admin_level: pd?.admin_level ?? "user",
    equipment: {
      skin_code: pd?.skin_code,
      equipped_hair: pd?.equipped_hair,
      equipped_top: pd?.equipped_top,
      equipped_pants: pd?.equipped_pants,
      equipped_hat: pd?.equipped_hat,
      equipped_necklace: pd?.equipped_necklace,
      equipped_halo: pd?.equipped_halo,
      equipped_accessory: pd?.equipped_accessory,
      ...(pd?.equipment || {}),
    },
    position_x: Number.isFinite(pd?.position_x) ? pd.position_x : 600,
    position_y: Number.isFinite(pd?.position_y) ? pd.position_y : 400,
    direction: pd?.direction ?? "front",
    keep_away_mode: !!pd?.keep_away_mode,
    is_invisible: !!pd?.is_invisible,
  };
}

// אימות טוקן מול Base44
async function verifyTokenWithBase44(token) {
  try {
    console.log("🔐 Verifying token with Base44…");
    const response = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`HTTP ${response.status}: ${txt}`);
    }

    const result = await response.json();
    if (!result?.success) {
      throw new Error(result?.error || "verifyWebSocketToken failed");
    }

    // תומך גם במקרה של result.user וגם result.user.player_data
    const normalized = normalizeUserShape(result.user);
    if (!normalized.playerId) {
      throw new Error("normalized playerId missing");
    }

    console.log(`✅ Token OK for ${normalized.username} (${normalized.playerId})`);
    return normalized;
  } catch (err) {
    console.error("❌ Token Error:", err.message);
    return null;
  }
}

// Trade exec via Base44
async function executeTradeOnBase44(trade) {
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
    if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
    return { success: true, data: json };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function broadcastTradeStatus(tradeId, status, reason = null) {
  const trade = activeTrades.get(tradeId);
  if (!trade) return;
  const initSid = getSocketIdByPlayerId(trade.initiatorId);
  const recvSid = getSocketIdByPlayerId(trade.receiverId);
  const payload = { tradeId, status, reason };
  if (initSid) io.to(initSid).emit("trade_status_updated", payload);
  if (recvSid) io.to(recvSid).emit("trade_status_updated", payload);
}

// ---------- Health ----------
app.get("/healthz", (_req, res) => {
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
    list: Array.from(players.values()).map(p => ({
      id: p.playerId,
      user: p.username,
      area: p.current_area,
    })),
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
  // Auth
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.emit("disconnect_reason", "no_token");
    socket.disconnect(true);
    return;
  }

  const user = await verifyTokenWithBase44(token);
  if (!user) {
    socket.emit("disconnect_reason", "invalid_token");
    socket.disconnect(true);
    return;
  }

  // Kick duplicate
  for (const [sid, p] of players.entries()) {
    if (p.playerId === user.playerId && sid !== socket.id) {
      io.to(sid).emit("disconnect_reason", "logged_in_elsewhere");
      io.sockets.sockets.get(sid)?.disconnect(true);
      players.delete(sid);
    }
  }

  // Register player
  const player = {
    socketId: socket.id,
    playerId: user.playerId,
    userId: user.userId,
    username: user.username,
    admin_level: user.admin_level,
    current_area: user.current_area || "area1",
    equipment: user.equipment || {},
    position_x: user.position_x ?? 600,
    position_y: user.position_y ?? 400,
    direction: user.direction || "front",
    is_moving: false,
    animation_frame: "idle",
    _lastMoveLogAt: 0, // throttled movement log
  };

  players.set(socket.id, player);

  // Join area room
  socket.join(player.current_area);

  // Send current players in area
  const areaPeers = Array.from(players.values())
    .filter(p => p.current_area === player.current_area && p.socketId !== socket.id)
    .map(safePlayerView);

  socket.emit("identify_ok", safePlayerView(player));
  socket.emit("current_players", areaPeers);

  // Notify others in same area
  socket.to(player.current_area).emit("player_joined", safePlayerView(player));

  // ========== MOVE_TO (throttled debug logs, room broadcast) ==========
  socket.on("move_to", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    const { x, y } = data;
    if (typeof x !== "number" || typeof y !== "number") return;

    // שמור קודמים לצורך חישוב כיוון
    const prevX = p.position_x;
    const prevY = p.position_y;

    p.position_x = x;
    p.position_y = y;
    p.is_moving = true;

    // כיוון (על סמך delta מהעבר)
    const dx = x - prevX;
    const dy = y - prevY;
    if (Math.abs(dx) > Math.abs(dy)) {
      p.direction = dx > 0 ? "e" : "w";
    } else if (Math.abs(dy) > 0) {
      p.direction = dy > 0 ? "s" : "n";
    }

    // לוג פעם ב-3 שניות לכל שחקן
    const t = now();
    if (!p._lastMoveLogAt || t - p._lastMoveLogAt > 3000) {
      console.log(`🚶 ${p.username} → (${Math.round(x)}, ${Math.round(y)}) | ${p.current_area}`);
      p._lastMoveLogAt = t;
    }

    // שדר רק לחדר האזור
    io.to(p.current_area).emit("players_moved", [
      {
        id: p.playerId,
        playerId: p.playerId,
        position_x: p.position_x,
        position_y: p.position_y,
        is_moving: p.is_moving,
        direction: p.direction,
        animation_frame: "walk",
      },
    ]);
  });

  // ========== PLAYER_UPDATE ==========
  socket.on("player_update", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    if (Number.isFinite(data.x)) p.position_x = data.x;
    if (Number.isFinite(data.y)) p.position_y = data.y;
    if (typeof data.direction === "string") p.direction = data.direction;
    if (typeof data.is_moving === "boolean") p.is_moving = data.is_moving;
    if (typeof data.animation_frame === "string") p.animation_frame = data.animation_frame;
    if (data.equipment && typeof data.equipment === "object") p.equipment = data.equipment;

    socket.to(p.current_area).emit("player_update", safePlayerView(p));
  });

  // ========== CHAT_MESSAGE (rate limit) ==========
  socket.on("chat_message", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    const msg = (data.message ?? data.text ?? "").toString().trim();
    if (!msg) return;

    const key = `chat_${p.playerId}`;
    const last = chatRateLimit.get(key) || 0;
    if (now() - last < 1000) {
      socket.emit("chat_rate_limited");
      return;
    }
    chatRateLimit.set(key, now());

    const payload = {
      id: p.playerId,
      playerId: p.playerId,
      username: p.username,
      admin_level: p.admin_level,
      message: msg,
      timestamp: Date.now(),
    };

    io.to(p.current_area).emit("chat_message", payload);
    console.log(`💬 [${p.current_area}] ${p.username}: ${msg}`);
  });

  // ========== ADMIN_SYSTEM_MESSAGE (current/all) ==========
  socket.on("admin_system_message", (messageData = {}) => {
    const adminPlayer = players.get(socket.id);
    if (!adminPlayer) return;

    // הרשאת ניהול בסיסית
    if (!["admin", "senior_touch"].includes(adminPlayer.admin_level)) return;

    const payload = {
      id: "system",
      username: messageData.sender_name || adminPlayer.username,
      admin_level: adminPlayer.admin_level,
      message: String(messageData.message || "").slice(0, 300),
      timestamp: Date.now(),
    };

    const target = messageData.target_area || "all";
    if (target === "current") {
      io.to(adminPlayer.current_area).emit("chat_message", payload);
      console.log(`📢 [SYSTEM current:${adminPlayer.current_area}] ${payload.message}`);
    } else {
      io.emit("chat_message", payload);
      console.log(`📢 [SYSTEM all] ${payload.message}`);
    }
  });

  // ========== CHANGE_AREA ==========
  socket.on("change_area", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    const newArea = data.newArea;
    if (!newArea || newArea === p.current_area) return;

    const oldArea = p.current_area;

    socket.leave(oldArea);
    p.current_area = newArea;
    socket.join(newArea);

    console.log(`🚪 ${p.username} moved: ${oldArea} → ${newArea}`);

    // ידע את הישן שיצא
    socket.to(oldArea).emit("player_area_changed", { id: p.playerId });

    // שלח רשימת שחקנים באזור החדש
    const peers = Array.from(players.values())
      .filter(pp => pp.current_area === newArea && pp.socketId !== socket.id)
      .map(safePlayerView);

    socket.emit("current_players", peers);

    // הודע לאחרים באזור החדש
    socket.to(newArea).emit("player_joined", safePlayerView(p));
  });

  // ========== TRADE (מקוצר) ==========
  socket.on("trade_request", (data = {}) => {
    const initiator = players.get(socket.id);
    if (!initiator) return;

    const recvSid = getSocketIdByPlayerId(data?.receiver?.id);
    if (!recvSid) return;

    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const trade = {
      id: tradeId,
      initiatorId: initiator.playerId,
      receiverId: players.get(recvSid)?.playerId,
      initiator_offer: { items: [], coins: 0, gems: 0 },
      receiver_offer: { items: [], coins: 0, gems: 0 },
      status: "pending",
    };
    activeTrades.set(tradeId, trade);

    io.to(recvSid).emit("trade_request_received", {
      trade_id: tradeId,
      initiator: safePlayerView(initiator),
    });
  });

  socket.on("trade_accept", ({ trade_id } = {}) => {
    const trade = activeTrades.get(trade_id);
    if (!trade) return;
    trade.status = "started";
    broadcastTradeStatus(trade_id, "started");
  });

  socket.on("trade_cancel", ({ trade_id, reason } = {}) => {
    const trade = activeTrades.get(trade_id);
    if (!trade) return;
    trade.status = "cancelled";
    broadcastTradeStatus(trade_id, "cancelled", reason || "cancelled");
    activeTrades.delete(trade_id);
  });

  // ========== DISCONNECT ==========
  socket.on("disconnect", (reason) => {
    const p = players.get(socket.id);
    if (!p) return;

    console.log(`🔴 Disconnect: ${p.username} (${p.playerId}) | reason=${reason}`);
    socket.to(p.current_area).emit("player_disconnected", p.playerId);

    // נקה טריידים פתוחים עם השחקן
    for (const [tid, t] of activeTrades.entries()) {
      if (t.initiatorId === p.playerId || t.receiverId === p.playerId) {
        t.status = "cancelled";
        broadcastTradeStatus(tid, "cancelled", "participant_disconnected");
        activeTrades.delete(tid);
      }
    }

    players.delete(socket.id);
  });
});

// ---------- Start ----------
httpServer.listen(PORT, () => {
  console.log(`\n${"★".repeat(60)}`);
  console.log(`🚀 Touch World Server v${VERSION} - Port ${PORT}`);
  console.log(`🌍 https://touchworld-realtime.onrender.com`);
  console.log(`${"★".repeat(60)}\n`);
});
