// ============================================================================
// 🌍 Touch World Secure Server v12.1
// Socket.IO + Base44 + Client-Side Zones + Optimized Performance
// ============================================================================

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

// 🧩 טעינת משתני סביבה
dotenv.config();

// ⚙️ הגדרות כלליות
const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(",") || "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000
});

// 🔒 משתני סביבה
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 10000;

if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET not configured in .env file!");
  process.exit(1);
}

console.log("✅ Touch World Server v12.1 - Client-Side Collision + Zone Blocking");
console.log(`🔑 JWT: ${JWT_SECRET.substring(0, 10)}...`);

const connectedPlayers = new Map();

// 🌐 Health Check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "12.1",
    players: connectedPlayers.size,
    uptime: process.uptime()
  });
});

// 🌐 Root Endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Touch World Server",
    version: "12.1 - Client-Side Collision + Zone Blocking",
    players: connectedPlayers.size
  });
});

// 🔌 Socket.IO Events
io.on("connection", (socket) => {
  console.log(`🟢 Connected: ${socket.id}`);

  // 🪪 זיהוי שחקן
  socket.on("identify", (data) => {
    try {
      if (!data?.token) {
        socket.emit("disconnect_reason", "No token");
        return socket.disconnect(true);
      }

      let decoded;
      try {
        decoded = jwt.verify(data.token, JWT_SECRET);
      } catch (jwtError) {
        console.error(`❌ Invalid JWT: ${jwtError.message}`);
        socket.emit("disconnect_reason", "Invalid token");
        return socket.disconnect(true);
      }

      const { userId, playerId, username, admin_level } = decoded;
      const areaId = data.areaId || "area1";

      // נתק משתמשים כפולים
      for (const [sid, p] of connectedPlayers) {
        if (p.userId === userId) {
          const oldSocket = io.sockets.sockets.get(sid);
          if (oldSocket) {
            oldSocket.emit("disconnect_reason", "logged_in_elsewhere");
            oldSocket.disconnect(true);
          }
          connectedPlayers.delete(sid);
        }
      }

      const playerData = {
        socketId: socket.id,
        userId,
        playerId,
        username,
        admin_level: admin_level || "user",
        current_area: areaId,
        position_x: 690,
        position_y: 385,
        direction: "s",
        equipment: {},
        is_trading: false
      };

      connectedPlayers.set(socket.id, playerData);
      socket.join(areaId);

      console.log(`✅ ${username} joined ${areaId} (${connectedPlayers.size} players)`);

      // שלח אישור וזימון רשימת שחקנים באזור
      socket.emit("identify_ok", { playerId });
      const playersInArea = Array.from(connectedPlayers.values())
        .filter(p => p.current_area === areaId)
        .map(p => ({
          id: p.playerId,
          username: p.username,
          admin_level: p.admin_level,
          x: p.position_x,
          y: p.position_y,
          direction: p.direction,
          equipment: p.equipment
        }));
      socket.emit("current_players", playersInArea);

      socket.to(areaId).emit("player_joined", {
        id: playerId,
        username,
        admin_level,
        x: playerData.position_x,
        y: playerData.position_y,
        direction: playerData.direction
      });

    } catch (err) {
      console.error("❌ Identify error:", err);
      socket.disconnect(true);
    }
  });

  // 📍 עדכון מיקום - רק כשיש שינוי משמעותי או סיום תנועה
  socket.on("position_update", (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    // ⚠️ לא שולחים לשרת כל תנועה קטנה, רק מיקום סופי מהקליינט
    player.position_x = data.x;
    player.position_y = data.y;
    player.direction = data.direction || player.direction;

    // משדרים לאחרים באזור בלבד
    socket.to(player.current_area).emit("player_position", {
      id: player.playerId,
      x: player.position_x,
      y: player.position_y,
      direction: player.direction
    });
  });

  // 💬 צ'אט
  socket.on("chat_message", (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player || !data?.message) return;

    const msg = data.message.trim();
    if (msg.length === 0) return;

    io.to(player.current_area).emit("chat_message", {
      id: player.playerId,
      username: player.username,
      message: msg,
      timestamp: Date.now()
    });
  });

  // 🚪 מעבר בין אזורים
  socket.on("change_area", (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    const { newArea } = data;
    if (!newArea) return;

    socket.leave(player.current_area);
    socket.join(newArea);

    console.log(`🚪 ${player.username} moved from ${player.current_area} → ${newArea}`);
    player.current_area = newArea;

    socket.emit("area_changed", { newArea });

    const playersInNewArea = Array.from(connectedPlayers.values())
      .filter(p => p.current_area === newArea)
      .map(p => ({
        id: p.playerId,
        username: p.username,
        x: p.position_x,
        y: p.position_y,
        direction: p.direction
      }));

    socket.emit("current_players", playersInNewArea);
    socket.to(newArea).emit("player_joined", {
      id: player.playerId,
      username: player.username,
      x: player.position_x,
      y: player.position_y,
      direction: player.direction
    });
  });

  // 👕 עדכון ציוד
  socket.on("player_update", (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player || !data?.equipment) return;

    player.equipment = data.equipment;
    io.to(player.current_area).emit("player_update", {
      id: player.playerId,
      equipment: player.equipment
    });
  });

  // ❌ ניתוק
  socket.on("disconnect", (reason) => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      io.to(player.current_area).emit("player_disconnected", player.playerId);
      connectedPlayers.delete(socket.id);
      console.log(`🔴 ${player.username} disconnected (${reason}). Online: ${connectedPlayers.size}`);
    }
  });
});

// 🚀 Start Server
httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Touch World Server is running on port ${PORT}`);
});
