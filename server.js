// Touch World Server v10.0.0 - Complete
import { createServer } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
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
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const BASE44_API_URL = "https://base44.app/api/apps/68e269394d8f2fa24e82cd71";
const HEALTH_KEY = process.env.HEALTH_KEY;

if (!JWT_SECRET || !BASE44_SERVICE_KEY || !HEALTH_KEY) {
  console.error("❌ Missing keys");
  process.exit(1);
}

const VERSION = "10.0.0";

// API: Generate Token
app.post("/api/generateWebSocketToken", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

    const token = authHeader.replace("Bearer ", "");
    const userResponse = await fetch(`${BASE44_API_URL}/entities/User`, {
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
    });

    if (!userResponse.ok) return res.status(401).json({ error: "Invalid token" });
    const userData = await userResponse.json();
    const user = userData[0];
    if (!user) return res.status(401).json({ error: "User not found" });

    const playerResponse = await fetch(`${BASE44_API_URL}/entities/Player?user_id=${user.id}`, {
      headers: { "Authorization": `Bearer ${BASE44_SERVICE_KEY}`, "Content-Type": "application/json" }
    });
    const playerData = await playerResponse.json();
    const player = playerData[0];
    if (!player) return res.status(404).json({ error: "Player not found" });

    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      jti, iat: now, nbf: now,
      playerId: player.id,
      userId: user.id,
      username: player.username || "Guest",
      admin_level: player.admin_level || "user",
      current_area: player.current_area || "area1",
      x: player.position_x || 600,
      y: player.position_y || 400,
      skin_code: player.skin_code || "blue",
      equipment: {
        equipped_hair: player.equipped_hair,
        equipped_top: player.equipped_top,
        equipped_pants: player.equipped_pants,
        equipped_hat: player.equipped_hat,
        equipped_necklace: player.equipped_necklace,
        equipped_halo: player.equipped_halo,
        equipped_accessory: player.equipped_accessory ? player.equipped_accessory.split(',').filter(Boolean) : [],
      }
    };

    const wsToken = jwt.sign(payload, JWT_SECRET, {
      expiresIn: '1h', algorithm: 'HS256', issuer: 'touch-world', audience: 'websocket-client'
    });

    res.json({ token: wsToken, success: true, expiresIn: 3600, issuedAt: now, tokenId: jti.substring(0, 8) });
  } catch (error) {
    console.error("❌ Token error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API: Chat Bubble Config
app.get("/api/getChatBubbleConfig", async (req, res) => {
  const defaultConfig = {
    bubble_duration_seconds: 7,
    default_username_color: '#FFFFFF',
    default_position: { x: 0, y: -45 },
    role_configs: [
      { role: "user", username_color: "#FFFFFF", bubble_color: "#FFFFFF", text_color: "#000000" },
      { role: "senior_touch", username_color: "#FFD700", role_icon_url: "https://img.icons8.com/emoji/48/crown-emoji.png", bubble_color: "#FFF4E6", text_color: "#B8860B" },
      { role: "admin", username_color: "#FF0000", role_icon_url: "https://img.icons8.com/emoji/48/fire.png", bubble_color: "#FFE6E6", text_color: "#8B0000" }
    ],
    shadow_settings: { x: 0, y: 0, scale: 100 }
  };

  try {
    const response = await fetch(`${BASE44_API_URL}/entities/ChatBubbleConfig?name=default_config`, {
      headers: { "Authorization": `Bearer ${BASE44_SERVICE_KEY}`, "Content-Type": "application/json" }
    });
    if (response.ok) {
      const configs = await response.json();
      if (configs?.length > 0) return res.json(configs[0]);
    }
  } catch (error) {
    console.warn("Config fetch failed:", error.message);
  }
  res.json(defaultConfig);
});

// API: Game Connection Details
app.post("/api/getGameConnectionDetails", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "Unauthorized" });

    const token = authHeader.replace("Bearer ", "");
    const userResponse = await fetch(`${BASE44_API_URL}/entities/User`, {
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
    });

    if (!userResponse.ok) return res.status(401).json({ error: "Authentication failed" });
    const userData = await userResponse.json();
    const user = userData[0];
    if (!user) return res.status(401).json({ error: "User not found" });

    const playerResponse = await fetch(`${BASE44_API_URL}/entities/Player?user_id=${user.id}`, {
      headers: { "Authorization": `Bearer ${BASE44_SERVICE_KEY}`, "Content-Type": "application/json" }
    });
    const playerData = await playerResponse.json();
    const player = playerData[0];
    if (!player) return res.status(404).json({ error: "Player not found" });

    const tokenResponse = await fetch("https://touchworld-realtime.onrender.com/api/generateWebSocketToken", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }
    });

    if (!tokenResponse.ok) return res.status(500).json({ error: "Token generation failed" });
    const tokenData = await tokenResponse.json();

    res.json({
      success: true,
      url: "https://touchworld-realtime.onrender.com",
      token: tokenData.token
    });
  } catch (error) {
    console.error("❌ Connection error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/healthz", (req, res) => res.json({ ok: true, version: VERSION, players: players.size }));
app.get("/health", (req, res) => {
  const key = req.headers["x-health-key"] || req.query.key;
  if (key !== HEALTH_KEY) return res.status(403).json({ ok: false });
  res.json({ ok: true, version: VERSION, players: players.size });
});

// Socket.IO
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins.length > 0 ? allowedOrigins : "*", methods: ["GET", "POST"] },
  transports: ["websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

const players = new Map();
const chatRateLimit = new Map();

function safePlayerView(p) {
  if (!p) return null;
  return {
    id: p.playerId, playerId: p.playerId, socketId: p.socketId,
    username: p.username, current_area: p.current_area, admin_level: p.admin_level,
    equipment: p.equipment || {}, position_x: p.position_x, position_y: p.position_y,
    direction: p.direction || "front", is_moving: !!p.is_moving,
    animation_frame: p.animation_frame || "idle", move_speed: 60
  };
}

function getSocketIdByPlayerId(playerId) {
  for (const [sid, p] of players.entries()) {
    if (p.playerId === playerId) return sid;
  }
  return null;
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
  const auth = socket.handshake.auth || {};
  if (!auth.token) return next(new Error("Auth required"));
  try {
    const decoded = jwt.verify(auth.token, JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'touch-world', audience: 'websocket-client', clockTolerance: 60
    });
    socket.identity = {
      playerId: decoded.playerId, userId: decoded.userId, username: decoded.username || "Guest",
      current_area: decoded.current_area || "area1", admin_level: decoded.admin_level || "user",
      equipment: decoded.equipment || {}, x: decoded.x || 600, y: decoded.y || 400
    };
    next();
  } catch (error) {
    console.error("Auth failed:", error.message);
    next(new Error("Invalid token"));
  }
});

io.on("connection", (socket) => {
  const id = socket.identity;
  const existing = getSocketIdByPlayerId(id.playerId);
  if (existing && existing !== socket.id) {
    const old = io.sockets.sockets.get(existing);
    if (old) {
      old.emit("disconnect_reason", "logged_in_elsewhere");
      old.disconnect(true);
      players.delete(existing);
    }
  }

  const player = {
    socketId: socket.id, playerId: id.playerId, username: id.username,
    current_area: id.current_area, admin_level: id.admin_level, equipment: id.equipment,
    position_x: id.x, position_y: id.y, direction: "front", is_moving: false, animation_frame: "idle"
  };

  players.set(socket.id, player);
  socket.join(player.current_area);
  socket.emit("identify_ok", safePlayerView(player));

  const peers = Array.from(players.values())
    .filter((p) => p.current_area === player.current_area && p.socketId !== socket.id)
    .map(safePlayerView);
  socket.emit("current_players", peers);
  socket.to(player.current_area).emit("player_joined", safePlayerView(player));

  socket.on("move_to", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.destination_x = data.x;
    p.destination_y = data.y;
    p.is_moving = true;
    const dx = data.x - p.position_x;
    const dy = data.y - p.position_y;
    p.direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : (dy > 0 ? "s" : "n");
  });

  socket.on("player_update", (data) => {
    const p = players.get(socket.id);
    if (!p || !data.equipment) return;
    p.equipment = data.equipment;
    socket.to(p.current_area).emit("player_update", { id: p.playerId, playerId: p.playerId, equipment: data.equipment });
  });

  socket.on("change_area", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    const oldArea = p.current_area;
    p.current_area = data.newArea;
    p.position_x = 600;
    p.position_y = 400;
    socket.leave(oldArea);
    socket.join(p.current_area);
    socket.to(oldArea).emit("player_area_changed", { id: p.playerId, playerId: p.playerId, newArea: data.newArea });
  });

  socket.on("admin_system_message", (messageData) => {
    const p = players.get(socket.id);
    if (!p || (p.admin_level !== "admin" && p.admin_level !== "senior_touch")) return;
    const systemMessage = {
      id: "system", playerId: "system", username: messageData.sender_name,
      admin_level: messageData.sender_level, message: messageData.message, timestamp: messageData.timestamp || Date.now()
    };
    if (messageData.target_area === "current") {
      for (const [sid, player] of players) {
        if (player.current_area === p.current_area) io.to(sid).emit("chat_message", systemMessage);
      }
    } else {
      io.emit("chat_message", systemMessage);
    }
  });

  socket.on("chat_message", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return;
    const msg = (data.message ?? data.text ?? "").toString().trim();
    if (!msg || !allowChat(socket.id)) {
      socket.emit("chat_rate_limited", { until: Date.now() + 8000 });
      return;
    }
    io.in(p.current_area).emit("chat_message", {
      id: p.playerId, playerId: p.playerId, username: p.username,
      admin_level: p.admin_level, message: msg, timestamp: Date.now()
    });
  });

  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    if (!p) return;
    socket.to(p.current_area).emit("player_disconnected", p.playerId);
    players.delete(socket.id);
  });
});

setInterval(() => {
  const updates = [];
  for (const [sid, player] of players) {
    if (player.is_moving && player.destination_x !== undefined) {
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
        player.position_x += (dx / distance) * 3;
        player.position_y += (dy / distance) * 3;
      }
      updates.push({
        id: player.playerId, playerId: player.playerId, socketId: sid,
        position_x: player.position_x, position_y: player.position_y,
        direction: player.direction, is_moving: player.is_moving,
        animation_frame: player.is_moving ? "walk1" : "idle"
      });
    }
  }
  if (updates.length > 0) io.emit("players_moved", updates);
}, 50);

httpServer.listen(PORT, () => {
  console.log(`\n★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★`);
  console.log(`🚀 Touch World Server v${VERSION} - Port ${PORT}`);
  console.log(`🌍 https://touchworld-realtime.onrender.com`);
  console.log(`★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★★\n`);
});
