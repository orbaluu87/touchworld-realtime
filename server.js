// ✅ TouchWorld Realtime Server v9.0.0
// ⚡ Real-Time Inventory Sync + Chat Broadcast + Full Player Update System

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
});

const PORT = process.env.PORT || 10000;
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const VERIFY_TOKEN_URL = process.env.VERIFY_TOKEN_URL;
const BASE44_UPDATE_FUNC_URL = process.env.BASE44_UPDATE_FUNC_URL; // 🔗 פונקציה שתעדכן פריטים ב-Base44
const HEALTH_KEY = process.env.HEALTH_KEY;

const players = new Map(); // socketId -> player data
const playerIdToSocketId = new Map(); // playerId -> socketId

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

// 💾 עדכון שחקן ב-Base44 (לשמירה במסד נתונים)
async function updatePlayerInBase44(playerId, updates) {
  try {
    const response = await fetch(BASE44_UPDATE_FUNC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ playerId, updates }),
    });
    return await response.json();
  } catch (err) {
    console.error("❌ Failed to update player in Base44:", err);
  }
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("No token"));
  const user = await verifyToken(token);
  if (!user || !user.player_data) return next(new Error("Invalid token"));
  socket.user = user.player_data;
  next();
});

io.on("connection", (socket) => {
  const user = socket.user;
  const playerId = user.id;

  const existingSocketId = playerIdToSocketId.get(playerId);
  if (existingSocketId && existingSocketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(existingSocketId);
    if (oldSocket) oldSocket.disconnect(true);
    players.delete(existingSocketId);
  }

  playerIdToSocketId.set(playerId, socket.id);

  const player = {
    socketId: socket.id,
    playerId: playerId,
    username: user.username,
    current_area: user.current_area || "area1",
    equipment: user.equipment || {},
    position_x: user.position_x || 600,
    position_y: user.position_y || 400,
    direction: "front",
    move_speed: 60,
  };

  players.set(socket.id, player);
  socket.join(player.current_area);
  socket.emit("identify_ok", player);

  // שליחת רשימת שחקנים קיימים
  const peers = Array.from(players.values()).filter(
    (p) => p.current_area === player.current_area && p.socketId !== socket.id
  );
  socket.emit("current_players", peers);
  socket.to(player.current_area).emit("player_joined", player);

  // 🎮 עדכון תנועה
  socket.on("move_to", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    Object.assign(p, { position_x: data.x, position_y: data.y, direction: data.direction });
    io.in(p.current_area).emit("players_moved", [p]);
  });

  // 👕 עדכון פריטים בזמן אמת
  socket.on("update_equipment", async (updates) => {
    const p = players.get(socket.id);
    if (!p) return;

    p.equipment = { ...p.equipment, ...updates };

    // שלח לכל השחקנים באזור
    io.in(p.current_area).emit("player_equipment_updated", {
      playerId: p.playerId,
      equipment: p.equipment,
    });

    // שמור ב-Base44 (אופציונלי)
    await updatePlayerInBase44(p.playerId, { equipment: p.equipment });
  });

  // 💬 שליחת הודעה בצ׳אט דרך השרת
  socket.on("chat_message", (data) => {
    const p = players.get(socket.id);
    if (!p) return;

    const message = {
      sender: p.username,
      playerId: p.playerId,
      message: data.message,
      area: p.current_area,
      timestamp: Date.now(),
    };

    io.in(p.current_area).emit("chat_message", message);
  });

  // 🌍 מעבר אזור
  socket.on("change_area", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    const oldArea = p.current_area;
    socket.leave(oldArea);
    p.current_area = data.newArea;
    socket.join(p.current_area);

    socket.to(oldArea).emit("player_left_area", p.playerId);
    socket.to(p.current_area).emit("player_joined", p);
  });

  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    if (p) {
      socket.to(p.current_area).emit("player_disconnected", p.playerId);
      players.delete(socket.id);
      playerIdToSocketId.delete(p.playerId);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 TouchWorld Realtime Server v9.0.0 running on port ${PORT}`);
  console.log(`🌍 https://touchworld-realtime.onrender.com`);
});
