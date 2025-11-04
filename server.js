// 🌍 TouchWorld Realtime Server v10.2.0
// ✅ verifyWebSocketToken (Base44) + Debug לוגים מפורטים לשגיאות 500
// ✅ מניעת כפילויות חיבור, צ'אט, תנועה, עדכון ציוד ושמירה ל-Base44

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
    origin: (process.env.ALLOWED_ORIGINS?.split(",") || ["*"]).map(s => s.trim()),
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 10000;
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const VERIFY_TOKEN_URL = "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/verifyWebSocketToken"; // ✅ הנכון
const UPDATE_PLAYER_URL = "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/updatePlayerData";
const HEALTH_KEY = process.env.HEALTH_KEY || "secret123";
const DEBUG_BASE44 = process.env.DEBUG_BASE44 === "1";

console.log("🚀 TouchWorld Server Starting...");
console.log("🔑 Base44 Service Key:", BASE44_SERVICE_KEY ? "✅ Found" : "❌ Missing");
console.log("🌐 Allowed Origins:", process.env.ALLOWED_ORIGINS || "*");
console.log("🩺 Health Key set:", HEALTH_KEY ? "✅" : "❌");

if (!BASE44_SERVICE_KEY) {
  console.error("❌ Missing BASE44_SERVICE_KEY — אי אפשר לאמת טוקנים מול Base44.");
}

const players = new Map();           // socket.id -> player data
const playerIdToSocketId = new Map(); // playerId   -> socket.id

// 🔐 אימות טוקן מול Base44 עם דיבאג מלא
async function verifyToken(token) {
  console.log("🔐 Verifying token via Base44...");
  try {
    const response = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ token }),
    });

    const rawText = await response.text(); // קוראים כטקסט כדי ללכוד גם error bodies
    if (!response.ok) {
      console.error(`❌ verifyWebSocketToken HTTP ${response.status}`);
      if (DEBUG_BASE44) {
        console.error("🧾 Base44 error body:", rawText);
      }
      return null;
    }

    let json;
    try {
      json = JSON.parse(rawText);
    } catch (e) {
      console.error("❌ Failed to parse Base44 JSON:", e.message);
      if (DEBUG_BASE44) console.error("🧾 Raw response was:", rawText);
      return null;
    }

    if (json.success && (json.user || json.player_data)) {
      const pdata = json.user?.player_data || json.player_data;
      console.log(`✅ Auth success: ${pdata?.username || "unknown_user"}`);
      return pdata;
    }

    console.error("❌ Auth failed (success=false or missing player data).");
    if (DEBUG_BASE44) console.error("🧾 Full JSON:", JSON.stringify(json));
    return null;
  } catch (err) {
    console.error("❌ Auth error (network/exception):", err.message);
    return null;
  }
}

// 🔄 עדכון שחקן ב-Base44
async function updatePlayerInBase44(playerId, updates) {
  try {
    const response = await fetch(UPDATE_PLAYER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ playerId, updates }),
    });
    if (!response.ok) {
      const t = await response.text();
      console.error(`❌ Update player failed HTTP ${response.status}: ${t}`);
      return;
    }
    console.log(`✅ Player ${playerId} updated successfully.`);
  } catch (err) {
    console.error("❌ Update error:", err.message);
  }
}

// 🧠 Middleware אימות חיבור
io.use(async (socket, next) => {
  console.log(`🔌 New connection attempt: ${socket.id}`);
  const token = socket.handshake.auth?.token;

  if (!token) {
    console.error("❌ No token provided.");
    return next(new Error("No token"));
  }

  if (!BASE44_SERVICE_KEY) {
    console.error("❌ BASE44_SERVICE_KEY is missing; cannot verify token.");
    return next(new Error("Server misconfigured"));
  }

  const playerData = await verifyToken(token);
  if (!playerData) {
    console.error("❌ Invalid token (verification failed).");
    return next(new Error("Invalid token"));
  }

  socket.playerData = playerData;
  next();
});

// 🎮 חיבור Socket
io.on("connection", (socket) => {
  const playerData = socket.playerData;
  const playerId = playerData.id;

  console.log(`\n✅ PLAYER CONNECTED: ${playerData.username} (${socket.id})`);

  // מניעת כפילויות
  const existingSocketId = playerIdToSocketId.get(playerId);
  if (existingSocketId && existingSocketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(existingSocketId);
    if (oldSocket) {
      oldSocket.emit("disconnect_reason", "logged_in_elsewhere");
      oldSocket.disconnect(true);
      players.delete(existingSocketId);
    }
  }
  playerIdToSocketId.set(playerId, socket.id);

  // יצירת אובייקט שחקן
  const player = {
    socketId: socket.id,
    playerId,
    username: playerData.username,
    current_area: playerData.current_area || "area1",
    equipment: playerData.equipment || {},
    position_x: playerData.position_x ?? 690,
    position_y: playerData.position_y ?? 385,
    direction: "front",
    move_speed: 60,
  };

  players.set(socket.id, player);
  socket.join(player.current_area);

  // זיהוי ללקוח
  socket.emit("identify_ok", player);

  // רשימת שחקנים באזור
  const peers = Array.from(players.values()).filter(
    (p) => p.current_area === player.current_area && p.socketId !== socket.id
  );
  socket.emit("current_players", peers);
  socket.to(player.current_area).emit("player_joined", player);

  // תנועה
  socket.on("move_to", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.position_x = data.x;
    p.position_y = data.y;
    p.direction = data.direction || p.direction;
    io.in(p.current_area).emit("players_moved", [p]);
  });

  // עדכון ציוד + שידור
  socket.on("update_equipment", async (updates) => {
    const p = players.get(socket.id);
    if (!p) return;
    p.equipment = { ...p.equipment, ...updates };
    io.in(p.current_area).emit("player_equipment_updated", {
      playerId: p.playerId,
      equipment: p.equipment,
    });
    await updatePlayerInBase44(p.playerId, { equipment: p.equipment });
  });

  // צ'אט
  socket.on("chat_message", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    const msg = {
      sender: p.username,
      playerId: p.playerId,
      message: data.message,
      area: p.current_area,
      timestamp: Date.now(),
    };
    console.log(`💬 [${p.current_area}] ${p.username}: ${data.message}`);
    io.in(p.current_area).emit("chat_message", msg);
  });

  // מעבר אזור
  socket.on("change_area", async (data) => {
    const p = players.get(socket.id);
    if (!p) return;

    const oldArea = p.current_area;
    const newArea = data.newArea;
    if (!newArea || newArea === oldArea) return;

    socket.leave(oldArea);
    socket.join(newArea);
    socket.to(oldArea).emit("player_disconnected", p.playerId);

    p.current_area = newArea;

    const peersInNewArea = Array.from(players.values()).filter(
      (pl) => pl.current_area === newArea && pl.socketId !== socket.id
    );
    socket.emit("current_players", peersInNewArea);
    socket.to(newArea).emit("player_joined", p);

    await updatePlayerInBase44(p.playerId, { current_area: newArea });
    console.log(`🗺️ ${p.username} moved ${oldArea} → ${newArea}`);
  });

  // ניתוק
  socket.on("disconnect", (reason) => {
    const p = players.get(socket.id);
    if (!p) return;
    players.delete(socket.id);
    playerIdToSocketId.delete(p.playerId);
    io.in(p.current_area).emit("player_disconnected", p.playerId);
    console.log(`❌ ${p.username} disconnected (${reason})`);
  });
});

// 🩺 Health
app.get("/health", (req, res) => {
  if (req.query.key !== HEALTH_KEY) return res.status(401).send("Unauthorized");
  res.json({
    status: "OK",
    version: "10.2.0",
    connectedPlayers: players.size,
    timestamp: new Date().toISOString(),
  });
});

// 🏠 Root
app.get("/", (req, res) => {
  res.send("✅ TouchWorld Realtime Server v10.2.0 is running.");
});

// 🚀 Start
httpServer.listen(PORT, () => {
  console.log(`\n✅ SERVER RUNNING ON PORT ${PORT}`);
  console.log("⚡ Waiting for Base44 connections...\n");
});
