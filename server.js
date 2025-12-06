// ============================================================================
// Touch World - Socket Server v11.7.0 - PLAYER-ONLY SYSTEM + DONUT SYNC FIXED
// ============================================================================

const setupSystemRoutes = require("./functions/systemRoutes"); // ← NEW
const { createServer } = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { Server } = require("socket.io");
const fetch = require("node-fetch");
const donutManager = require("./donutManager");
const tradeManager = require("./tradeManager");

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
const JWT_SECRET = process.env.JWT_SECRET;
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

const VERSION = "11.7.0"; // Slow Donut Spawning Cycle

// ---------- State ----------
const players = new Map();
const chatRateLimit = new Map();
const KEEP_AWAY_RADIUS = 200;

const now = () => Date.now();

// ---------- Helpers ----------
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

// ============================================================================
// LOAD SYSTEM ROUTES (potions / transformations / system updates)
// ============================================================================
let io; // declare here so we can pass later

// ---------- Socket.IO ----------
io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Install system routes
setupSystemRoutes(app, io, players, BASE44_SERVICE_KEY, getSocketIdByPlayerId);

// ============================================================================
// MAIN SOCKET CONNECTION LOGIC
// ============================================================================

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

  // Kick duplicates
  for (const [sid, p] of players.entries()) {
    if (p.playerId === playerData.playerId && sid !== socket.id) {
      console.log(`⚠️ Kicking duplicate session for ${p.username}`);
      io.to(sid).emit("disconnect_reason", "logged_in_elsewhere");
      io.sockets.sockets.get(sid)?.disconnect(true);
      players.delete(sid);
    }
  }

  // Register new player
  const player = {
    socketId: socket.id,
    playerId: playerData.playerId,
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
    is_invisible: playerData.is_invisible ?? false,
    keep_away_mode: playerData.keep_away_mode ?? false,
    active_subscription_tier: playerData.active_subscription_tier || 'none',
    subscription_expires_at: playerData.subscription_expires_at,
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

  if (donutManager?.setupSocketHandlers) {
    donutManager.setupSocketHandlers(socket, players);
  }

  if (tradeManager?.setupSocketHandlers) {
    tradeManager.setupSocketHandlers(socket);
  }

  // -----------------------------
  // כל מאזיני הסוקט שלך ממשיכים פה
  // -----------------------------
  
  socket.on("move_to", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;

    let { x, y } = data;
    if (typeof x !== "number" || typeof y !== "number") return;

    p.destination_x = x;
    p.destination_y = y;
    p.is_moving = true;

    const dx = x - p.position_x;
    const dy = y - p.position_y;

    if (Math.abs(dx) > Math.abs(dy)) {
      p.direction = dx > 0 ? "e" : "w";
    } else {
      p.direction = dy > 0 ? "s" : "n";
    }
  });

  // כל שאר האירועים שלך כאן...
  
  socket.on("disconnect", (reason) => {
    const p = players.get(socket.id);
    if (!p) return;

    console.log(`🔴 Disconnect: ${p.username} | ${reason}`);
    
    socket.to(p.current_area).emit("player_disconnected", p.playerId);

    if (tradeManager?.handleDisconnect) {
      tradeManager.handleDisconnect(socket.id);
    }

    players.delete(socket.id);
  });
});

// ============================================================================
// GAME LOOP
// ============================================================================

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

// ============================================================================
// START SERVER
// ============================================================================

httpServer.listen(PORT, () => {
  console.log(`\n${"★".repeat(60)}`);
  console.log(`🚀 Touch World Server v${VERSION} - Port ${PORT}`);
  console.log(`👻 Stealth mode ready`);
  console.log(`🍩 Donut System loaded`);
  console.log(`💬 Chat sync enabled`);
  console.log(`${"★".repeat(60)}\n`);

  if (donutManager?.initialize) {
    donutManager.initialize(io, BASE44_SERVICE_KEY, BASE44_API_URL);
  }

  if (tradeManager?.initialize) {
    tradeManager.initialize(io, BASE44_API_URL, BASE44_SERVICE_KEY, players, getSocketIdByPlayerId);
  }
});
