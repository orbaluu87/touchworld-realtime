// ============================================================================
// Touch World - Socket Server v10.9.0 - FIXED EQUIPMENT REMOVAL IN DB
// ============================================================================

const { createServer } = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { Server } = require("socket.io");
const fetch = require("node-fetch");
require("dotenv").config();

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
  console.error("❌ Missing security keys");
  process.exit(1);
}

const VERSION = "10.9.0";

// ---------- State ----------
const players = new Map();
const activeTrades = new Map();
const chatRateLimit = new Map();

const KEEP_AWAY_RADIUS = 200;

// ---------- Helpers ----------
const now = () => Date.now();

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
    is_invisible: !!p.is_invisible,
  };
}

function getSocketIdByPlayerId(playerId) {
  for (const [sid, p] of players.entries()) {
    if (p.playerId === playerId) return sid;
  }
  return null;
}

function normalizeUserShape(userAny) {
  const pd = userAny?.player_data || userAny;
  const playerId = pd?.id ?? pd?.playerId ?? pd?.userId ?? userAny?.id ?? userAny?.playerId;

  return {
    playerId,
    userId: pd?.userId ?? playerId,
    username: pd?.username ?? "Guest",
    current_area: pd?.current_area ?? "area1",
    admin_level: pd?.admin_level ?? "user",
    jti: userAny?.jti || null,
    iat: userAny?.iat || null,
    equipment: {
      skin_code: pd?.skin_code,
      equipped_hair: pd?.equipped_hair,
      equipped_top: pd?.equipped_top,
      equipped_pants: pd?.equipped_pants,
      equipped_hat: pd?.equipped_hat,
      equipped_necklace: pd?.equipped_necklace,
      equipped_halo: pd?.equipped_halo,
      equipped_shoes: pd?.equipped_shoes,
      equipped_gloves: pd?.equipped_gloves,
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

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`HTTP ${response.status}: ${txt}`);
    }

    const result = await response.json();
    if (!result?.success) {
      throw new Error(result?.error || "verifyWebSocketToken failed");
    }

    const normalized = normalizeUserShape(result.user);
    if (!normalized.playerId) {
      throw new Error("normalized playerId missing");
    }

    const jtiShort = normalized.jti ? normalized.jti.substring(0, 8) : 'N/A';
    console.log(`✅ Token OK: ${normalized.username} (${normalized.playerId}) | JTI: ${jtiShort}...`);
    
    return normalized;
  } catch (err) {
    console.error("❌ Token Error:", err.message);
    return null;
  }
}

function calculateDistance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

function calculateSafePosition(playerX, playerY, adminX, adminY, radius) {
  const dx = playerX - adminX;
  const dy = playerY - adminY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  if (distance === 0) {
    return { x: adminX + radius + 10, y: adminY };
  }
  
  const nx = dx / distance;
  const ny = dy / distance;
  
  const safeX = adminX + nx * (radius + 20);
  const safeY = adminY + ny * (radius + 20);
  
  return { x: safeX, y: safeY };
}

function pushAwayNearbyPlayers(adminPlayer, areaId, io) {
  const playersInArea = Array.from(players.values()).filter(
    p => p.current_area === areaId && p.playerId !== adminPlayer.playerId && p.admin_level === 'user'
  );

  const movedPlayers = [];

  for (const player of playersInArea) {
    const distance = calculateDistance(
      player.position_x,
      player.position_y,
      adminPlayer.position_x,
      adminPlayer.position_y
    );

    if (distance < KEEP_AWAY_RADIUS) {
      const safePos = calculateSafePosition(
        player.position_x,
        player.position_y,
        adminPlayer.position_x,
        adminPlayer.position_y,
        KEEP_AWAY_RADIUS
      );

      player.position_x = safePos.x;
      player.position_y = safePos.y;
      player.is_moving = false;
      player.destination_x = undefined;
      player.destination_y = undefined;

      movedPlayers.push({
        id: player.playerId,
        playerId: player.playerId,
        socketId: player.socketId,
        position_x: player.position_x,
        position_y: player.position_y,
        is_moving: false,
        direction: player.direction,
        animation_frame: "idle",
      });

      console.log(`🚫 Pushed ${player.username} away from admin ${adminPlayer.username}`);
    }
  }

  if (movedPlayers.length > 0) {
    io.to(areaId).emit("players_moved", movedPlayers);
  }
}

// פונקציה חדשה: מזהה אילו פריטים מההצעה לבושים על השחקן
async function getEquippedItemsFromOffer(playerId, offerItems) {
  if (!offerItems || offerItems.length === 0) return [];

  try {
    // שליפת פרטי הפריטים מהדאטאבייס
    const itemsResponse = await fetch(`${BASE44_API_URL}/entities/Item/list`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
    });

    if (!itemsResponse.ok) return [];
    
    const allItems = await itemsResponse.json();
    const itemsMap = new Map(allItems.map(item => [item.id, item]));

    // מציאת השחקן
    const socketId = getSocketIdByPlayerId(playerId);
    if (!socketId) return [];
    
    const player = players.get(socketId);
    if (!player) return [];

    const equippedItems = [];

    // בדיקה לכל פריט בהצעה
    for (const inventoryItemId of offerItems) {
      // שליפת פרטי הפריט מה-inventory
      const invResponse = await fetch(`${BASE44_API_URL}/entities/PlayerInventory/${inventoryItemId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
        },
      });

      if (!invResponse.ok) continue;
      
      const invItem = await invResponse.json();
      const itemDetails = itemsMap.get(invItem.item_id);
      
      if (!itemDetails) continue;

      // בדיקה אם הפריט לבוש על השחקן
      const itemCode = itemDetails.item_code;
      const itemType = itemDetails.type;

      let isEquipped = false;
      let equipmentSlot = null;

      switch (itemType) {
        case 'hair':
          if (player.equipment.equipped_hair === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_hair';
          }
          break;
        case 'top':
          if (player.equipment.equipped_top === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_top';
          }
          break;
        case 'pants':
          if (player.equipment.equipped_pants === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_pants';
          }
          break;
        case 'hat':
          if (player.equipment.equipped_hat === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_hat';
          }
          break;
        case 'necklace':
          if (player.equipment.equipped_necklace === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_necklace';
          }
          break;
        case 'halo':
          if (player.equipment.equipped_halo === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_halo';
          }
          break;
        case 'shoes':
          if (player.equipment.equipped_shoes === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_shoes';
          }
          break;
        case 'accessory':
          if (player.equipment.equipped_accessory === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_accessory';
          }
          break;
      }

      if (isEquipped) {
        equippedItems.push({
          inventoryItemId,
          itemCode,
          itemType,
          equipmentSlot,
        });
      }
    }

    return equippedItems;
  } catch (error) {
    console.error("Error checking equipped items:", error);
    return [];
  }
}

// פונקציה חדשה: מסירה פריטים לבושים מהשחקן בזיכרון ובדאטאבייס
async function removeEquippedItems(playerId, equippedItems) {
  const socketId = getSocketIdByPlayerId(playerId);
  if (!socketId) return;

  const player = players.get(socketId);
  if (!player) return;

  const updates = {};
  
  for (const item of equippedItems) {
    if (item.equipmentSlot && player.equipment[item.equipmentSlot]) {
      console.log(`🔧 Removing ${item.equipmentSlot} (${item.itemCode}) from ${player.username}`);
      player.equipment[item.equipmentSlot] = null;
      updates[item.equipmentSlot] = null;
    }
  }

  // 🔥 עדכון הדאטאבייס - חשוב מאוד!
  if (Object.keys(updates).length > 0) {
    try {
      await fetch(`${BASE44_API_URL}/entities/Player/${playerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
        },
        body: JSON.stringify(updates),
      });
      console.log(`💾 Updated DB for ${player.username}:`, updates);
    } catch (error) {
      console.error(`❌ Failed to update DB for ${player.username}:`, error);
    }
  }
}

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

function broadcastTradeUpdate(tradeId, io) {
  const trade = activeTrades.get(tradeId);
  if (!trade) return;
  
  const initSid = getSocketIdByPlayerId(trade.initiatorId);
  const recvSid = getSocketIdByPlayerId(trade.receiverId);
  
  const initiatorPlayer = players.get(initSid);
  const receiverPlayer = players.get(recvSid);
  
  const payload = {
    id: tradeId,
    status: trade.status,
    initiator: {
      id: trade.initiatorId,
      username: initiatorPlayer?.username || "Unknown",
      ready: trade.initiator_ready || false,
      equipment: initiatorPlayer?.equipment || {},
    },
    receiver: {
      id: trade.receiverId,
      username: receiverPlayer?.username || "Unknown",
      ready: trade.receiver_ready || false,
      equipment: receiverPlayer?.equipment || {},
    },
    initiator_offer: trade.initiator_offer,
    receiver_offer: trade.receiver_offer,
  };
  
  if (initSid) {
    console.log(`📤 Sending to initiator ${initiatorPlayer?.username}`);
    io.to(initSid).emit("trade_status_updated", payload);
  }
  if (recvSid) {
    console.log(`📤 Sending to receiver ${receiverPlayer?.username}`);
    io.to(recvSid).emit("trade_status_updated", payload);
  }
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
      invisible: p.is_invisible,
      keepAway: p.keep_away_mode,
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
      console.log(`⚠️ Kicking duplicate session for ${p.username}`);
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
    destination_x: undefined,
    destination_y: undefined,
    is_invisible: user.is_invisible ?? false,
    keep_away_mode: user.keep_away_mode ?? false,
    activeTradeId: null,
    _lastMoveLogAt: 0,
    _tokenJTI: user.jti,
    _tokenIAT: user.iat,
  };

  players.set(socket.id, player);
  socket.join(player.current_area);

  const areaPeers = Array.from(players.values())
    .filter(p => p.current_area === player.current_area && p.socketId !== socket.id)
    .map(safePlayerView);

  socket.emit("identify_ok", safePlayerView(player));
  socket.emit("current_players", areaPeers);
  socket.to(player.current_area).emit("player_joined", safePlayerView(player));

  console.log(`🟢 Connected: ${player.username} (${player.current_area})`);

  // ========== MOVE_TO ==========
  socket.on("move_to", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    let { x, y } = data;
    if (typeof x !== "number" || typeof y !== "number") return;

    if (p.admin_level === 'user') {
      const adminsInArea = Array.from(players.values()).filter(
        admin => admin.current_area === p.current_area && 
                admin.admin_level === 'admin' && 
                admin.keep_away_mode === true
      );

      for (const admin of adminsInArea) {
        const distanceToAdmin = calculateDistance(x, y, admin.position_x, admin.position_y);
        
        if (distanceToAdmin < KEEP_AWAY_RADIUS) {
          socket.emit("keep_away_blocked", {
            message: `לא ניתן להתקרב למנהל ${admin.username}`,
            admin_username: admin.username
          });
          return;
        }
      }
    }

    p.destination_x = x;
    p.destination_y = y;
    p.is_moving = true;

    const dx = x - p.position_x;
    const dy = y - p.position_y;
    if (Math.abs(dx) > Math.abs(dy)) {
      p.direction = dx > 0 ? "e" : "w";
    } else if (Math.abs(dy) > 0) {
      p.direction = dy > 0 ? "s" : "n";
    }
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
    
    if (typeof data.is_invisible === "boolean") {
      p.is_invisible = data.is_invisible;
    }

    if (typeof data.keep_away_mode === "boolean") {
      p.keep_away_mode = data.keep_away_mode;
      
      if (data.keep_away_mode && p.admin_level === 'admin') {
        pushAwayNearbyPlayers(p, p.current_area, io);
      }
    }

    io.to(p.current_area).emit("player_update", {
      id: p.playerId,
      playerId: p.playerId,
      socketId: p.socketId,
      equipment: p.equipment,
      is_invisible: p.is_invisible,
    });
  });

  // ========== ADMIN_KICK_PLAYER ==========
  socket.on("admin_kick_player", (data = {}) => {
    const admin = players.get(socket.id);
    if (!admin || admin.admin_level !== 'admin') return;

    const targetPlayerId = data.target_player_id;
    if (!targetPlayerId) return;

    const targetSocketId = getSocketIdByPlayerId(targetPlayerId);
    if (!targetSocketId) return;

    const targetPlayer = players.get(targetSocketId);
    if (!targetPlayer) return;

    console.log(`👢 Admin ${admin.username} kicked ${targetPlayer.username}`);
    io.to(targetSocketId).emit("kicked_by_admin");
    
    setTimeout(() => {
      io.sockets.sockets.get(targetSocketId)?.disconnect(true);
      players.delete(targetSocketId);
    }, 1000);
  });

  // ========== CHAT_MESSAGE ==========
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
  });

  // ========== ADMIN_SYSTEM_MESSAGE ==========
  socket.on("admin_system_message", (messageData = {}) => {
    const adminPlayer = players.get(socket.id);
    if (!adminPlayer) return;
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
    } else {
      io.emit("chat_message", payload);
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

    socket.to(oldArea).emit("player_area_changed", { id: p.playerId, playerId: p.playerId });

    const peers = Array.from(players.values())
      .filter(pp => pp.current_area === newArea && pp.socketId !== socket.id)
      .map(safePlayerView);

    socket.emit("current_players", peers);
    socket.to(newArea).emit("player_joined", safePlayerView(p));
  });

  // ========== TRADE REQUEST ==========
  socket.on("trade_request", (data = {}) => {
    const initiator = players.get(socket.id);
    if (!initiator) return;

    const receiverId = data?.receiver?.id;
    if (!receiverId) return;

    const recvSid = getSocketIdByPlayerId(receiverId);
    if (!recvSid) return;

    const receiver = players.get(recvSid);
    if (!receiver) return;

    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    const trade = {
      id: tradeId,
      initiatorId: initiator.playerId,
      receiverId: receiver.playerId,
      initiator_offer: { items: [], coins: 0, gems: 0 },
      receiver_offer: { items: [], coins: 0, gems: 0 },
      initiator_ready: false,
      receiver_ready: false,
      status: "pending",
    };
    
    activeTrades.set(tradeId, trade);
    initiator.activeTradeId = tradeId;
    receiver.activeTradeId = tradeId;

    console.log(`🔄 Trade Request: ${initiator.username} → ${receiver.username} (${tradeId})`);

    io.to(recvSid).emit("trade_request_received", {
      trade_id: tradeId,
      initiator: {
        id: initiator.playerId,
        username: initiator.username,
        equipment: initiator.equipment,
      },
    });
  });

  // ========== TRADE ACCEPT ==========
  socket.on("trade_accept", (data = {}) => {
    const trade = activeTrades.get(data.trade_id);
    if (!trade) return;

    trade.status = "started";
    console.log(`✅ Trade Accepted: ${data.trade_id}`);
    broadcastTradeUpdate(data.trade_id, io);
  });

  // ========== TRADE OFFER UPDATE ==========
  socket.on("trade_offer_update", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    const trade = activeTrades.get(data.trade_id);
    if (!trade) return;

    if (trade.initiatorId === p.playerId) {
      trade.initiator_offer = {
        items: data.offer?.items || [],
        coins: data.offer?.coins || 0,
        gems: data.offer?.gems || 0,
      };
      trade.initiator_ready = false;
      console.log(`🔄 ${p.username} updated offer: ${trade.initiator_offer.items.length} items, ${trade.initiator_offer.coins} coins`);
    } else if (trade.receiverId === p.playerId) {
      trade.receiver_offer = {
        items: data.offer?.items || [],
        coins: data.offer?.coins || 0,
        gems: data.offer?.gems || 0,
      };
      trade.receiver_ready = false;
      console.log(`🔄 ${p.username} updated offer: ${trade.receiver_offer.items.length} items, ${trade.receiver_offer.coins} coins`);
    }

    broadcastTradeUpdate(data.trade_id, io);
  });

  // ========== TRADE READY UPDATE ==========
  socket.on("trade_ready_update", async (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    const trade = activeTrades.get(data.trade_id);
    if (!trade) return;

    if (trade.initiatorId === p.playerId) {
      trade.initiator_ready = data.ready;
      console.log(`${data.ready ? '✅' : '❌'} ${p.username} ready: ${data.ready}`);
    } else if (trade.receiverId === p.playerId) {
      trade.receiver_ready = data.ready;
      console.log(`${data.ready ? '✅' : '❌'} ${p.username} ready: ${data.ready}`);
    }

    broadcastTradeUpdate(data.trade_id, io);

    if (trade.initiator_ready && trade.receiver_ready) {
      console.log(`🎉 Executing trade ${data.trade_id}...`);
      
      trade.status = "executing";
      broadcastTradeUpdate(data.trade_id, io);

      // בדיקה אילו פריטים לבושים
      const [initiatorEquipped, receiverEquipped] = await Promise.all([
        getEquippedItemsFromOffer(trade.initiatorId, trade.initiator_offer.items),
        getEquippedItemsFromOffer(trade.receiverId, trade.receiver_offer.items),
      ]);

      console.log(`👕 Initiator equipped items:`, initiatorEquipped.length);
      console.log(`👕 Receiver equipped items:`, receiverEquipped.length);

      executeTradeOnBase44(trade).then(async (result) => {
        if (result.success) {
          console.log(`✅ Trade Completed: ${data.trade_id}`);
          
          const initSid = getSocketIdByPlayerId(trade.initiatorId);
          const recvSid = getSocketIdByPlayerId(trade.receiverId);
          
          // 🔥 הסרת פריטים לבושים משני השחקנים - גם בזיכרון וגם בDB
          await Promise.all([
            removeEquippedItems(trade.initiatorId, initiatorEquipped),
            removeEquippedItems(trade.receiverId, receiverEquipped),
          ]);

          const initiatorPlayer = players.get(initSid);
          const receiverPlayer = players.get(recvSid);
          
          if (initSid) {
            if (initiatorPlayer) {
              initiatorPlayer.activeTradeId = null;
              
              // שליחת עדכון על הפריטים שהוסרו
              if (initiatorEquipped.length > 0) {
                io.to(initSid).emit("items_unequipped", {
                  items: initiatorEquipped.map(i => i.equipmentSlot),
                  equipment: initiatorPlayer.equipment,
                });
              }
            }
            io.to(initSid).emit("trade_completed_successfully", { trade_id: data.trade_id });
          }
          
          if (recvSid) {
            if (receiverPlayer) {
              receiverPlayer.activeTradeId = null;
              
              // שליחת עדכון על הפריטים שהוסרו
              if (receiverEquipped.length > 0) {
                io.to(recvSid).emit("items_unequipped", {
                  items: receiverEquipped.map(i => i.equipmentSlot),
                  equipment: receiverPlayer.equipment,
                });
              }
            }
            io.to(recvSid).emit("trade_completed_successfully", { trade_id: data.trade_id });
          }

          // 🔥 שידור לכל השחקנים באזור על העדכון
          if (initiatorPlayer && initiatorEquipped.length > 0) {
            io.to(initiatorPlayer.current_area).emit("player_update", {
              id: initiatorPlayer.playerId,
              playerId: initiatorPlayer.playerId,
              socketId: initSid,
              equipment: initiatorPlayer.equipment,
            });
          }

          if (receiverPlayer && receiverEquipped.length > 0) {
            io.to(receiverPlayer.current_area).emit("player_update", {
              id: receiverPlayer.playerId,
              playerId: receiverPlayer.playerId,
              socketId: recvSid,
              equipment: receiverPlayer.equipment,
            });
          }
          
          activeTrades.delete(data.trade_id);
        } else {
          console.error(`❌ Trade Failed: ${data.trade_id} - ${result.error}`);
          
          trade.status = "failed";
          const initSid = getSocketIdByPlayerId(trade.initiatorId);
          const recvSid = getSocketIdByPlayerId(trade.receiverId);
          
          const errorPayload = {
            id: data.trade_id,
            status: "failed",
            reason: result.error
          };
          
          if (initSid) {
            const initPlayer = players.get(initSid);
            if (initPlayer) initPlayer.activeTradeId = null;
            io.to(initSid).emit("trade_status_updated", errorPayload);
          }
          
          if (recvSid) {
            const recvPlayer = players.get(recvSid);
            if (recvPlayer) recvPlayer.activeTradeId = null;
            io.to(recvSid).emit("trade_status_updated", errorPayload);
          }
          
          activeTrades.delete(data.trade_id);
        }
      });
    }
  });

  // ========== TRADE CANCEL ==========
  socket.on("trade_cancel", (data = {}) => {
    const trade = activeTrades.get(data.trade_id);
    if (!trade) return;

    const p = players.get(socket.id);
    console.log(`❌ Trade Cancelled: ${data.trade_id} by ${p?.username || 'unknown'}`);

    const initSid = getSocketIdByPlayerId(trade.initiatorId);
    const recvSid = getSocketIdByPlayerId(trade.receiverId);
    
    if (initSid) {
      const initPlayer = players.get(initSid);
      if (initPlayer) initPlayer.activeTradeId = null;
      io.to(initSid).emit("trade_status_updated", {
        id: data.trade_id,
        status: "cancelled",
        reason: data.reason || "cancelled"
      });
    }
    
    if (recvSid) {
      const recvPlayer = players.get(recvSid);
      if (recvPlayer) recvPlayer.activeTradeId = null;
      io.to(recvSid).emit("trade_status_updated", {
        id: data.trade_id,
        status: "cancelled",
        reason: data.reason || "cancelled"
      });
    }
    
    activeTrades.delete(data.trade_id);
  });

  // ========== DISCONNECT ==========
  socket.on("disconnect", (reason) => {
    const p = players.get(socket.id);
    if (!p) return;

    console.log(`🔴 Disconnect: ${p.username} | ${reason}`);
    
    socket.to(p.current_area).emit("player_disconnected", p.playerId);

    if (p.activeTradeId) {
      const trade = activeTrades.get(p.activeTradeId);
      if (trade) {
        const otherPlayerId = trade.initiatorId === p.playerId ? trade.receiverId : trade.initiatorId;
        const otherSid = getSocketIdByPlayerId(otherPlayerId);
        
        if (otherSid) {
          const otherPlayer = players.get(otherSid);
          if (otherPlayer) otherPlayer.activeTradeId = null;
          
          io.to(otherSid).emit("trade_status_updated", {
            id: p.activeTradeId,
            status: "cancelled",
            reason: "participant_disconnected"
          });
        }
        
        activeTrades.delete(p.activeTradeId);
      }
    }

    players.delete(socket.id);
  });
});

// ========== GAME LOOP ==========
setInterval(() => {
  const updatesByArea = new Map();

  for (const [sid, player] of players) {
    if (player.is_moving && player.destination_x !== undefined && player.destination_y !== undefined) {
      const dx = player.destination_x - player.position_x;
      const dy = player.destination_y - player.position_y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 5) {
        player.position_x = player.destination_x;
        player.position_y = player.destination_y;
        player.is_moving = false;
        player.destination_x = undefined;
        player.destination_y = undefined;
      } else {
        const moveSpeed = 10;
        player.position_x += (dx / distance) * moveSpeed;
        player.position_y += (dy / distance) * moveSpeed;
      }

      if (player.admin_level === 'user') {
        const adminsInArea = Array.from(players.values()).filter(
          admin => admin.current_area === player.current_area && 
                  admin.admin_level === 'admin' && 
                  admin.keep_away_mode === true
        );

        for (const admin of adminsInArea) {
          const distanceToAdmin = calculateDistance(
            player.position_x,
            player.position_y,
            admin.position_x,
            admin.position_y
          );

          if (distanceToAdmin < KEEP_AWAY_RADIUS) {
            const safePos = calculateSafePosition(
              player.position_x,
              player.position_y,
              admin.position_x,
              admin.position_y,
              KEEP_AWAY_RADIUS
            );

            player.position_x = safePos.x;
            player.position_y = safePos.y;
            player.is_moving = false;
            player.destination_x = undefined;
            player.destination_y = undefined;
          }
        }
      }

      const update = {
        id: player.playerId,
        playerId: player.playerId,
        socketId: sid,
        position_x: player.position_x,
        position_y: player.position_y,
        direction: player.direction,
        is_moving: player.is_moving,
        animation_frame: player.is_moving ? "walk" : "idle",
        is_invisible: player.is_invisible,
      };

      if (!updatesByArea.has(player.current_area)) {
        updatesByArea.set(player.current_area, []);
      }
      updatesByArea.get(player.current_area).push(update);
    }
  }

  for (const [areaId, updates] of updatesByArea) {
    io.to(areaId).emit("players_moved", updates);
  }
}, 50);

// ---------- Start ----------
httpServer.listen(PORT, () => {
  console.log(`\n${"★".repeat(60)}`);
  console.log(`🚀 Touch World Server v${VERSION} - Port ${PORT}`);
  console.log(`✅ TRADE SYSTEM with EQUIPMENT REMOVAL + DB UPDATE!`);
  console.log(`✅ ADMIN MODERATION enabled!`);
  console.log(`👻 STEALTH MODE enabled!`);
  console.log(`🚫 KEEP-AWAY MODE: ${KEEP_AWAY_RADIUS}px!`);
  console.log(`⚡ Move Speed: 10 pixels/tick`);
  console.log(`🎮 Game Loop: 20 FPS (50ms)`);
  console.log(`${"★".repeat(60)}\n`);
});
