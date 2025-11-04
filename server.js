// ✅ TouchWorld Realtime Server v8.9.0
// 🧩 Fully Synced with Base44 + Anti-Duplicate System + Stable Disconnect Handling

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(",") || ["*"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.WSS_JWT_SECRET || process.env.JWT_SECRET;
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const BASE44_API_URL = process.env.BASE44_API_URL;
const VERIFY_TOKEN_URL = process.env.VERIFY_TOKEN_URL;
const HEALTH_KEY = process.env.HEALTH_KEY;

if (!JWT_SECRET || !BASE44_SERVICE_KEY) {
  console.error("❌ Missing critical environment variables!");
  process.exit(1);
}

app.use(express.json());
app.use(cors());

// 🩺 Health Check
app.get("/health", (req, res) => {
  const key = req.query.key || req.headers["x-health-key"];
  if (key !== HEALTH_KEY) return res.status(403).json({ status: "forbidden" });
  res.json({
    status: "ok",
    uptime: process.uptime(),
    version: "8.9.0",
    players: players.size,
  });
});

// 🎮 Maps for tracking players
const players = new Map(); // socketId -> player data
const playerIdToSocketId = new Map(); // ✅ playerId -> socketId (מניעת כפילויות)

// 🧠 אימות Token מול Base44
async function verifyToken(token) {
  try {
    const response = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ token }),
    });
    const result = await response.json();
    return result.success ? result.user : null;
  } catch (err) {
    console.error("❌ Token verification failed:", err);
    return null;
  }
}

// 🔒 Middleware לאימות Socket
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("No token"));

  const user = await verifyToken(token);
  if (!user || !user.player_data) return next(new Error("Invalid token"));

  socket.user = user.player_data;
  next();
});

// 🚀 התחברות שחקן
io.on("connection", (socket) => {
  const user = socket.user;
  
  // 🔒 בדיקה: האם השחקן כבר מחובר?
  const existingSocketId = playerIdToSocketId.get(user.id);
  if (existingSocketId && existingSocketId !== socket.id) {
    console.log(`⚠️ Duplicate connection for ${user.username}. Disconnecting old socket: ${existingSocketId}`);
    
    const oldSocket = io.sockets.sockets.get(existingSocketId);
    if (oldSocket) {
      oldSocket.emit("disconnect_reason", "logged_in_elsewhere");
      oldSocket.disconnect(true);
    }
    
    // ניקוי נתונים ישנים
    players.delete(existingSocketId);
  }

  // ✅ רישום החיבור החדש
  playerIdToSocketId.set(user.id, socket.id);
  console.log(`✅ ${user.username} connected (Socket: ${socket.id}, Player: ${user.id})`);

  // 👤 יצירת אובייקט שחקן
  const player = {
    socketId: socket.id,
    playerId: user.id,
    username: user.username,
    current_area: user.current_area || "area1",
    admin_level: user.admin_level,
    equipment: {
      skin_code: user.skin_code,
      equipped_hair: user.equipped_hair,
      equipped_top: user.equipped_top,
      equipped_pants: user.equipped_pants,
      equipped_hat: user.equipped_hat,
      equipped_necklace: user.equipped_necklace,
      equipped_halo: user.equipped_halo,
      equipped_accessory: user.equipped_accessory,
    },
    position_x: user.position_x || 600,
    position_y: user.position_y || 400,
    direction: "front",
    is_moving: false,
    animation_frame: "idle",
    move_speed: 60,
  };

  players.set(socket.id, player);
  socket.join(player.current_area);

  // שליחת מידע לשחקן החדש
  socket.emit("identify_ok", player);

  // שליחת מידע על שחקנים קיימים
  const peers = Array.from(players.values()).filter(
    (p) => p.current_area === player.current_area && p.socketId !== socket.id
  );
  socket.emit("current_players", peers);
  socket.to(player.current_area).emit("player_joined", player);

  // 🎮 תנועה
  socket.on("move_to", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.position_x = data.x;
    p.position_y = data.y;
    p.is_moving = true;
    io.in(p.current_area).emit("players_moved", [p]);
  });

  // 🧍 עדכון שחקן
  socket.on("player_update", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    Object.assign(p, data);
    socket.to(p.current_area).emit("player_update", p);
  });

  // 💬 צ׳אט
  socket.on("chat_message", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    io.in(p.current_area).emit("chat_message", {
      id: p.playerId,
      playerId: p.playerId,
      message: data.message,
      timestamp: Date.now(),
    });
  });

  // 🌍 מעבר אזור
  socket.on("change_area", (data) => {
    const p = players.get(socket.id);
    if (!p) return;

    const oldArea = p.current_area;
    socket.leave(oldArea);
    p.current_area = data.newArea;
    socket.join(p.current_area);

    const newPeers = Array.from(players.values()).filter(
      (pp) => pp.current_area === p.current_area && pp.socketId !== socket.id
    );
    socket.emit("current_players", newPeers);
    socket.to(p.current_area).emit("player_joined", p);
  });

  // ❌ התנתקות
  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    if (p) {
      playerIdToSocketId.delete(p.playerId); // ✅ ניקוי מה-Map
      players.delete(socket.id);
      socket.to(p.current_area).emit("player_disconnected", p.playerId);
      console.log(`[-] ${p.username} disconnected`);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 TouchWorld Server v8.9.0 running on port ${PORT}`);
  console.log(`🌍 https://touchworld-realtime.onrender.com`);
});
