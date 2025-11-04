// 🌍 TouchWorld Realtime Server v11.0.0 - Production Ready
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
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
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 10000;
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const VERIFY_TOKEN_URL = process.env.VERIFY_TOKEN_URL || "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/verifyWebSocketToken";
const UPDATE_PLAYER_URL = process.env.UPDATE_PLAYER_URL || "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/updatePlayerData";
const HEALTH_KEY = process.env.HEALTH_KEY || "secret123";

console.log("🚀 TouchWorld Server Starting...");
console.log("📍 Port:", PORT);
console.log("🔑 Service Key:", BASE44_SERVICE_KEY ? "✅ Configured" : "❌ Missing");

// מפות לניהול שחקנים
const players = new Map(); // socketId -> player data
const playerIdToSocketId = new Map(); // playerId -> socketId

// 🔐 אימות טוקן מול Base44
async function verifyToken(token) {
  console.log("🔐 [AUTH] Verifying token...");
  
  try {
    const response = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      console.error("❌ [AUTH] HTTP Error:", response.status);
      return null;
    }

    const result = await response.json();
    console.log("🔐 [AUTH] Response:", JSON.stringify(result, null, 2));

    if (result.success && result.player_data) {
      console.log("✅ [AUTH] Success:", result.player_data.username);
      return result.player_data;
    } else {
      console.error("❌ [AUTH] Failed:", result.error || "No player_data");
      return null;
    }
  } catch (err) {
    console.error("❌ [AUTH] Exception:", err.message);
    return null;
  }
}

// 💾 עדכון שחקן ב-Base44
async function updatePlayerInBase44(playerId, updates) {
  try {
    await fetch(UPDATE_PLAYER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ playerId, updates }),
    });
  } catch (err) {
    console.error("❌ [UPDATE] Error:", err.message);
  }
}

// 🛡️ Middleware - אימות לפני חיבור
io.use(async (socket, next) => {
  console.log("\n🔌 [MIDDLEWARE] New connection attempt");
  console.log("🔌 [MIDDLEWARE] Socket ID:", socket.id);
  
  const token = socket.handshake.auth?.token;
  console.log("🔌 [MIDDLEWARE] Token present:", !!token);
  
  if (!token) {
    console.error("❌ [MIDDLEWARE] No token provided");
    return next(new Error("Authentication error: No token"));
  }

  const playerData = await verifyToken(token);
  
  if (!playerData) {
    console.error("❌ [MIDDLEWARE] Token verification failed");
    return next(new Error("Authentication error: Invalid token"));
  }

  console.log("✅ [MIDDLEWARE] Auth successful for:", playerData.username);
  socket.playerData = playerData;
  next();
});

// 🎮 חיבור שחקן
io.on("connection", (socket) => {
  const playerData = socket.playerData;
  const playerId = playerData.id;

  console.log("\n✅✅✅ PLAYER CONNECTED ✅✅✅");
  console.log("👤 Username:", playerData.username);
  console.log("🆔 Player ID:", playerId);
  console.log("🔌 Socket ID:", socket.id);
  console.log("🗺️  Area:", playerData.current_area);

  // נתק חיבור קודם (למנוע כפילויות)
  const existingSocketId = playerIdToSocketId.get(playerId);
  if (existingSocketId && existingSocketId !== socket.id) {
    console.log("🔄 [DUPLICATE] Disconnecting old connection:", existingSocketId);
    const oldSocket = io.sockets.sockets.get(existingSocketId);
    if (oldSocket) {
      oldSocket.emit("disconnect_reason", "logged_in_elsewhere");
      oldSocket.disconnect(true);
    }
    players.delete(existingSocketId);
  }

  playerIdToSocketId.set(playerId, socket.id);

  // יצירת אובייקט השחקן
  const player = {
    socketId: socket.id,
    playerId: playerId,
    username: playerData.username,
    admin_level: playerData.admin_level || 'user',
    current_area: playerData.current_area || "area1",
    equipment: playerData.equipment || {},
    position_x: playerData.position_x || 690,
    position_y: playerData.position_y || 385,
    direction: "front",
    move_speed: 60,
    is_trading: false
  };

  players.set(socket.id, player);
  socket.join(player.current_area);

  // שלח אישור זיהוי
  console.log("📤 [EMIT] identify_ok");
  socket.emit("identify_ok", player);

  // שלח רשימת שחקנים קיימים באזור
  const peers = Array.from(players.values()).filter(
    (p) => p.current_area === player.current_area && p.socketId !== socket.id
  );
  console.log("📤 [EMIT] current_players. Count:", peers.length);
  socket.emit("current_players", peers);

  // הודע לאחרים על שחקן חדש
  console.log("📢 [BROADCAST] player_joined to area:", player.current_area);
  socket.to(player.current_area).emit("player_joined", player);

  // 🚶 תנועה
  socket.on("move_to", (data) => {
    const p = players.get(socket.id);
    if (!p) return;

    Object.assign(p, {
      position_x: data.x,
      position_y: data.y,
      direction: data.direction,
      is_moving: true
    });

    io.in(p.current_area).emit("players_moved", [p]);
  });

  // 👕 עדכון ציוד
  socket.on("update_equipment", async (updates) => {
    const p = players.get(socket.id);
    if (!p) return;

    console.log("👕 [EQUIPMENT] Update for:", p.username);
    p.equipment = { ...p.equipment, ...updates };

    io.in(p.current_area).emit("player_equipment_updated", {
      playerId: p.playerId,
      equipment: p.equipment,
    });

    await updatePlayerInBase44(p.playerId, { equipment: p.equipment });
  });

  // 💬 צ'אט
  socket.on("chat_message", (data) => {
    const p = players.get(socket.id);
    if (!p) return;

    console.log("💬 [CHAT]", p.username + ":", data.message);

    io.in(p.current_area).emit("chat_message", {
      id: p.playerId,
      playerId: p.playerId,
      username: p.username,
      admin_level: p.admin_level,
      message: data.message,
      timestamp: Date.now(),
    });
  });

  // 🗺️ שינוי אזור
  socket.on("change_area", async (data) => {
    const p = players.get(socket.id);
    if (!p) return;

    const oldArea = p.current_area;
    const newArea = data.newArea;

    console.log("🗺️ [AREA_CHANGE]", p.username, ":", oldArea, "→", newArea);

    socket.leave(oldArea);
    socket.to(oldArea).emit("player_disconnected", p.playerId);

    socket.join(newArea);
    p.current_area = newArea;

    const peersInNewArea = Array.from(players.values()).filter(
      (pl) => pl.current_area === newArea && pl.socketId !== socket.id
    );

    socket.emit("current_players", peersInNewArea);
    socket.to(newArea).emit("player_joined", p);

    await updatePlayerInBase44(p.playerId, { current_area: newArea });
  });

  // 🔁 עדכון כללי של שחקן
  socket.on("player_update", (data) => {
    const p = players.get(socket.id);
    if (!p) return;

    Object.assign(p, data);
    io.in(p.current_area).emit("player_update", { id: p.playerId, ...data });
  });

  // 🔌 התנתקות
  socket.on("disconnect", (reason) => {
    const p = players.get(socket.id);
    if (!p) return;

    console.log("\n❌ [DISCONNECT]", p.username);
    console.log("❌ [DISCONNECT] Reason:", reason);

    players.delete(socket.id);
    playerIdToSocketId.delete(p.playerId);

    io.in(p.current_area).emit("player_disconnected", p.playerId);
    console.log("✅ [DISCONNECT] Cleanup complete\n");
  });
});

// 💚 Health Check
app.get("/health", (req, res) => {
  const key = req.query.key;
  if (key !== HEALTH_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  
  res.json({
    status: "OK",
    uptime: process.uptime(),
    connectedPlayers: players.size,
    timestamp: new Date().toISOString(),
    version: "11.0.0"
  });
});

app.get("/", (req, res) => {
  res.send("🎮 TouchWorld Realtime Server v11.0.0 - Running ✅");
});

httpServer.listen(PORT, () => {
  console.log("\n✅✅✅ SERVER STARTED SUCCESSFULLY ✅✅✅");
  console.log(`🌍 Listening on port ${PORT}`);
  console.log(`🔗 Health: http://localhost:${PORT}/health?key=${HEALTH_KEY}`);
  console.log("⚡ Ready for connections!\n");
});
