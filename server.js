// ============================================================================
// Touch World - Socket Server v11.9.0 - TOKEN REFRESH SYSTEM
// ============================================================================

const { createServer } = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { Server } = require("socket.io");
const donutManager = require("./donutManager");
const tradeManager = require("./tradeManager");
const systemRoutes = require("./systemRoutes");

const app = express();
app.use(express.json());
app.use(helmet());

// ---------- CORS ----------
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") || "")
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
const PORT = Deno.env.get("PORT") || 10000;

// ---------- Env / Security ----------
const JWT_SECRET = Deno.env.get("JWT_SECRET");
const VERIFY_TOKEN_URL =
  Deno.env.get("VERIFY_TOKEN_URL") ||
  "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/verifyWebSocketToken";
const BASE44_SERVICE_KEY = Deno.env.get("BASE44_SERVICE_KEY");
const BASE44_API_URL =
  Deno.env.get("BASE44_API_URL") ||
  "https://base44.app/api/apps/68e269394d8f2fa24e82cd71";
const HEALTH_KEY = Deno.env.get("HEALTH_KEY") || "secret-health";

if (!JWT_SECRET || !BASE44_SERVICE_KEY || !HEALTH_KEY) {
  console.error("❌ Missing security keys");
  throw new Error("Missing security keys");
}

const VERSION = "11.9.0";

// ---------- State ----------
const players = new Map();
const chatRateLimit = new Map();

const KEEP_AWAY_RADIUS = 200;

// ---------- Helpers ----------
const now = () => Date.now();

function safePlayerView(p) {
  if (!p) return null;
  return {
    id: p.playerId,
    playerId: p.playerId,
    user_id: p.user_id,
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
    is_invisible: !!p.is_invisible,
    active_transformation_image_url: p.active_transformation_image_url,
    active_transformation_settings: p.active_transformation_settings,
    active_transformation_expires_at: p.active_transformation_expires_at,
    visual_override_data: p.visual_override_data,
    visual_override_expires_at: p.visual_override_expires_at,
    active_subscription_tier: p.active_subscription_tier || 'none',
    subscription_expires_at: p.subscription_expires_at,
  };
}

function getSocketIdByPlayerId(playerId) {
  for (const [sid, p] of players.entries()) {
    if (p.playerId === playerId) return sid;
  }
  return null;
}

function normalizePlayerShape(playerData) {
  const playerId = playerData?.id ?? playerData?.playerId;

  return {
    playerId,
    user_id: playerData?.user_id || playerId,
    username: playerData?.username ?? "Guest",
    display_name: playerData?.display_name,
    current_area: playerData?.current_area ?? "betach",
    admin_level: playerData?.admin_level ?? "user",
    equipment: {
      skin_code: playerData?.skin_code,
      equipped_hair: playerData?.equipped_hair,
      equipped_top: playerData?.equipped_top,
      equipped_pants: playerData?.equipped_pants,
      equipped_hat: playerData?.equipped_hat,
      equipped_necklace: playerData?.equipped_necklace,
      equipped_halo: playerData?.equipped_halo,
      equipped_shoes: playerData?.equipped_shoes,
      equipped_gloves: playerData?.equipped_gloves,
      equipped_face: playerData?.equipped_face,
      equipped_board: playerData?.equipped_board,
      equipped_accessory: playerData?.equipped_accessory,
      ...(playerData?.equipment || {}),
    },
    position_x: Number.isFinite(playerData?.position_x) ? playerData.position_x : 600,
    position_y: Number.isFinite(playerData?.position_y) ? playerData.position_y : 400,
    direction: playerData?.direction ?? "front",
    keep_away_mode: !!playerData?.keep_away_mode,
    is_invisible: !!playerData?.is_invisible,
    level: playerData?.level || 1,
    xp: playerData?.xp || 0,
    coins: playerData?.coins || 500,
    gems: playerData?.gems || 10,
    active_subscription_tier: playerData?.active_subscription_tier || 'none',
    subscription_expires_at: playerData?.subscription_expires_at,
    active_transformation_image_url: playerData?.active_transformation_image_url,
    active_transformation_settings: playerData?.active_transformation_settings,
    active_transformation_expires_at: playerData?.active_transformation_expires_at,
    visual_override_data: playerData?.visual_override_data,
    visual_override_expires_at: playerData?.visual_override_expires_at,
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
    if (!result?.success || !result?.player) {
      throw new Error(result?.error || "verifyWebSocketToken failed");
    }

    const normalized = normalizePlayerShape(result.player);
    if (!normalized.playerId) {
      throw new Error("normalized playerId missing");
    }

    // 🔒 Session validation
    if (result.sessionId && result.player.session_id) {
      if (result.sessionId !== result.player.session_id) {
        throw new Error("Session mismatch - possible token hijacking");
      }
    }

    console.log(`✅ Token OK: ${normalized.username} (${normalized.playerId})`);
    
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
    trades: tradeManager.getActiveTradesCount(),
    list: Array.from(players.values()).map(p => ({
      id: p.playerId,
      user: p.username,
      area: p.current_area,
      invisible: p.is_invisible,
      keepAway: p.keep_away_mode,
    })),
  });
});

// ---------- Broadcast Config Endpoint ----------
app.post("/broadcast-config", (req, res) => {
  const key = req.headers["x-health-key"];
  if (key !== HEALTH_KEY) return res.status(403).json({ ok: false });
  
  const { type } = req.body;
  console.log(`⚙️ Broadcasting config update: ${type}`);
  
  io.emit("config_refresh_required", { type });
  
  res.json({ ok: true, broadcasted: true });
});

// ========== SYSTEM ROUTES SETUP (POTION SYSTEM) ==========
systemRoutes.setupRoutes(app, io, players, getSocketIdByPlayerId, BASE44_SERVICE_KEY);
console.log('✅ System Routes (Potion System) initialized');

// ---------- Connection ----------
io.on("connection", async (socket) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.emit("disconnect_reason", "no_token");
    socket.disconnect(true);
    return;
  }

  const playerData = await verifyTokenWithBase44(token);
  if (!playerData) {
    socket.emit("disconnect_reason", "invalid_token");
    socket.disconnect(true);
    return;
  }

  // 🔄 Kick duplicate sessions
  for (const [sid, p] of players.entries()) {
    if (p.playerId === playerData.playerId && sid !== socket.id) {
      console.log(`⚠️ Kicking duplicate session for ${p.username} (token refresh)`);
      io.to(sid).emit("disconnect_reason", "logged_in_elsewhere");
      io.sockets.sockets.get(sid)?.disconnect();
      players.delete(sid);
    }
  }

  const player = {
    socketId: socket.id,
    playerId: playerData.playerId,
    user_id: playerData.user_id || playerData.playerId,
    username: playerData.username,
    display_name: playerData.display_name,
    admin_level: playerData.admin_level,
    current_area: playerData.current_area || "betach",
    equipment: playerData.equipment || {},
    position_x: playerData.position_x ?? 600,
    position_y: playerData.position_y ?? 400,
    direction: playerData.direction || "front",
    is_moving: false,
    animation_frame: "idle",
    destination_x: undefined,
    destination_y: undefined,
    is_invisible: playerData.is_invisible ?? false,
    keep_away_mode: playerData.keep_away_mode ?? false,
    active_subscription_tier: playerData.active_subscription_tier || 'none',
    subscription_expires_at: playerData.subscription_expires_at,
    active_transformation_image_url: playerData.active_transformation_image_url,
    active_transformation_settings: playerData.active_transformation_settings,
    active_transformation_expires_at: playerData.active_transformation_expires_at,
    visual_override_data: playerData.visual_override_data,
    visual_override_expires_at: playerData.visual_override_expires_at,
    _lastMoveLogAt: 0,
  };

  players.set(socket.id, player);
  socket.join(player.current_area);

  const areaPeers = Array.from(players.values())
    .filter(p => p.current_area === player.current_area && p.socketId !== socket.id)
    .map(safePlayerView);

  socket.emit("identify_ok", safePlayerView(player));
  socket.emit("current_players", areaPeers);
  
  const currentDonuts = donutManager.getDonutsForArea(player.current_area);
  socket.emit("donuts_sync", currentDonuts);

  socket.to(player.current_area).emit("player_joined", safePlayerView(player));

  console.log(`🟢 Connected: ${player.username} (${player.current_area})`);

  if (donutManager && typeof donutManager.setupSocketHandlers === 'function') {
      donutManager.setupSocketHandlers(socket, players);
  }

  if (tradeManager && typeof tradeManager.setupSocketHandlers === 'function') {
      tradeManager.setupSocketHandlers(socket);
  }

  if (systemRoutes && typeof systemRoutes.setupSocketHandlers === 'function') {
      systemRoutes.setupSocketHandlers(socket, players);
  }

  // 🔄 TOKEN REFRESH HANDLER
  socket.on("refresh_token", async (data = {}) => {
    const { newToken } = data;
    if (!newToken) {
      socket.emit("token_refresh_failed", { error: "no_token_provided" });
      return;
    }

    const newPlayerData = await verifyTokenWithBase44(newToken);
    if (!newPlayerData) {
      socket.emit("token_refresh_failed", { error: "invalid_token" });
      return;
    }

    if (newPlayerData.playerId !== player.playerId) {
      console.error(`⚠️ SECURITY: ${player.username} tried to refresh with different player token!`);
      socket.emit("token_refresh_failed", { error: "player_mismatch" });
      socket.disconnect(true);
      return;
    }

    Object.assign(player, {
      equipment: newPlayerData.equipment,
      active_transformation_image_url: newPlayerData.active_transformation_image_url,
      active_transformation_settings: newPlayerData.active_transformation_settings,
      active_transformation_expires_at: newPlayerData.active_transformation_expires_at,
      visual_override_data: newPlayerData.visual_override_data,
      visual_override_expires_at: newPlayerData.visual_override_expires_at,
      active_subscription_tier: newPlayerData.active_subscription_tier,
      subscription_expires_at: newPlayerData.subscription_expires_at,
    });

    console.log(`🔄 Token refreshed for ${player.username}`);
    socket.emit("token_refresh_ok", { success: true });
    
    io.to(player.current_area).emit("player_update", {
      id: player.playerId,
      playerId: player.playerId,
      socketId: player.socketId,
      equipment: player.equipment,
      active_transformation_image_url: player.active_transformation_image_url,
      active_transformation_settings: player.active_transformation_settings,
      visual_override_data: player.visual_override_data,
    });
  });

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

  socket.on("player_update", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    if (data.playerId && data.playerId !== p.playerId) {
      console.error(`⚠️ SECURITY: ${p.username} tried to update another player!`);
      return;
    }

    if (Number.isFinite(data.x)) p.position_x = data.x;
    if (Number.isFinite(data.y)) p.position_y = data.y;
    if (typeof data.direction === "string") p.direction = data.direction;
    if (typeof data.is_moving === "boolean") p.is_moving = data.is_moving;
    if (typeof data.animation_frame === "string") p.animation_frame = data.animation_frame;
    if (data.equipment && typeof data.equipment === "object") p.equipment = data.equipment;
    
    if (typeof data.is_invisible === "boolean") {
      if (p.admin_level === 'admin') {
        p.is_invisible = data.is_invisible;
      }
    }

    if (typeof data.keep_away_mode === "boolean") {
      if (p.admin_level === 'admin') {
        p.keep_away_mode = data.keep_away_mode;
        
        if (data.keep_away_mode) {
          pushAwayNearbyPlayers(p, p.current_area, io);
        }
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

  socket.on("chat_message", async (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    const msg = (data.message ?? data.text ?? "").toString().trim();
    if (!msg) return;

    // 🔒 Rate Limiting
    const key = `chat_${p.playerId}`;
    const last = chatRateLimit.get(key) || 0;
    if (now() - last < 1000) {
      socket.emit("chat_rate_limited");
      return;
    }
    chatRateLimit.set(key, now());

    // 🔒 Banned Words Check
    try {
      const bannedWordsResponse = await fetch(`${BASE44_API_URL}/entities/BannedWord`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
        },
      });

      if (bannedWordsResponse.ok) {
        const bannedWords = await bannedWordsResponse.json();
        const bannedWordsList = bannedWords.map(w => w.word.toLowerCase().trim());
        
        const messageToCheck = msg.toLowerCase().replace(/\s+/g, '').replace(/[^\u0590-\u05FFa-z0-9]/g, '');
        
        let foundBanned = false;
        for (const bannedWord of bannedWordsList) {
          const bannedWordNoSpaces = bannedWord.replace(/\s+/g, '').replace(/[^\u0590-\u05FFa-z0-9]/g, '');
          if (messageToCheck.includes(bannedWordNoSpaces)) {
            foundBanned = true;
            console.log(`🚫 BLOCKED: "${msg}" contains "${bannedWord}"`);
            break;
          }
        }
        
        if (foundBanned) return;
      }
    } catch (error) {
      console.error('❌ Error checking banned words:', error);
    }

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

  socket.on("admin_config_updated", (data = {}) => {
    const adminPlayer = players.get(socket.id);
    if (!adminPlayer) return;
    if (!["admin", "senior_touch"].includes(adminPlayer.admin_level)) return;

    console.log(`⚙️ Admin ${adminPlayer.username} updated config: ${data.type}`);
    
    io.emit("config_refresh_required", { type: data.type });
  });

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

    const currentDonuts = donutManager.getDonutsForArea(newArea);
    socket.emit("donuts_sync", currentDonuts);
  });

  socket.on("disconnect", (reason) => {
    const p = players.get(socket.id);
    if (!p) return;

    console.log(`🔴 Disconnect: ${p.username} | ${reason}`);
    
    socket.to(p.current_area).emit("player_disconnected", p.playerId);

    if (tradeManager && typeof tradeManager.handleDisconnect === 'function') {
        tradeManager.handleDisconnect(socket.id);
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
        let moveSpeed = 10;
        if (player.active_transformation_settings?.speed) {
            moveSpeed *= Number(player.active_transformation_settings.speed) || 1;
        }
        
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
  console.log(`✅ PLAYER-ONLY SYSTEM - NO BASE44 USERS!`);
  console.log(`✅ CUSTOM JWT AUTHENTICATION!`);
  console.log(`🔄 TOKEN REFRESH SYSTEM - LIVE TOKEN UPDATES!`);
  console.log(`✅ TRADE SYSTEM with EQUIPMENT REMOVAL + DB UPDATE!`);
  console.log(`✅ ADMIN MODERATION enabled!`);
  console.log(`👻 STEALTH MODE enabled!`);
  console.log(`🚫 KEEP-AWAY MODE: ${KEEP_AWAY_RADIUS}px!`);
  console.log(`💬 CHAT BUBBLE SYNC enabled!`);
  console.log(`🍩 Donut System Integration!`);
  console.log(`🧪 Potion System Integration!`);
  console.log(`🚫 Server-Side Banned Words Check!`);
  console.log(`${"★".repeat(60)}\n`);
  
  if (donutManager && typeof donutManager.initialize === 'function') {
      donutManager.initialize(io, BASE44_SERVICE_KEY, BASE44_API_URL);
  } else {
      console.error('❌ Donut Manager Initialize function NOT FOUND!');
  }

  if (tradeManager && typeof tradeManager.initialize === 'function') {
      tradeManager.initialize(io, BASE44_API_URL, BASE44_SERVICE_KEY, players, getSocketIdByPlayerId);
  } else {
      console.error('❌ Trade Manager Initialize function NOT FOUND!');
  }

  if (systemRoutes && typeof systemRoutes.initialize === 'function') {
      systemRoutes.initialize(io, BASE44_SERVICE_KEY, BASE44_API_URL);
  }
});
