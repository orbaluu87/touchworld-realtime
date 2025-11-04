// TouchWorld Realtime Server v10.0.0
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
});

const PORT = process.env.PORT || 10000;
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const VERIFY_TOKEN_URL = "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/verifyUserToken";
const UPDATE_PLAYER_URL = "https://base44.app/api/apps/68e269394d8f2fa24e82cd71/functions/updatePlayerData";
const HEALTH_KEY = process.env.HEALTH_KEY || "secret123";

console.log("🚀 TouchWorld Server Starting...");
console.log("🔑 Service Key:", BASE44_SERVICE_KEY ? "✅" : "❌");

const players = new Map();
const playerIdToSocketId = new Map();

async function verifyToken(token) {
  console.log("🔐 Verifying token...");
  try {
    const response = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ token }),
    });

    const result = await response.json();
    if (result.success && result.player_data) {
      console.log("✅ Auth success:", result.player_data.username);
      return result.player_data;
    }
    console.error("❌ Auth failed");
    return null;
  } catch (err) {
    console.error("❌ Auth error:", err.message);
    return null;
  }
}

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
    console.error("❌ Update error:", err.message);
  }
}

io.use(async (socket, next) => {
  console.log("🔌 New connection attempt:", socket.id);
  const token = socket.handshake.auth?.token;
  
  if (!token) {
    console.error("❌ No token");
    return next(new Error("No token"));
  }

  const playerData = await verifyToken(token);
  if (!playerData) {
    console.error("❌ Invalid token");
    return next(new Error("Invalid token"));
  }

  socket.playerData = playerData;
  next();
});

io.on("connection", (socket) => {
  const playerData = socket.playerData;
  const playerId = playerData.id;

  console.log("\n✅✅✅ PLAYER CONNECTED ✅✅✅");
  console.log("👤", playerData.username);
  console.log("🆔", playerId);
  console.log("🔌", socket.id);

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
    username: playerData.username,
    current_area: playerData.current_area || "area1",
    equipment: playerData.equipment || {},
    position_x: playerData.position_x || 690,
    position_y: playerData.position_y || 385,
    direction: "front",
    move_speed: 60,
  };

  players.set(socket.id, player);
  socket.join(player.current_area);

  socket.emit("identify_ok", player);

  const peers = Array.from(players.values()).filter(
    (p) => p.current_area === player.current_area && p.socketId !== socket.id
  );
  
  socket.emit("current_players", peers);
  socket.to(player.current_area).emit("player_joined", player);

  socket.on("move_to", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    Object.assign(p, { position_x: data.x, position_y: data.y, direction: data.direction });
    io.in(p.current_area).emit("players_moved", [p]);
  });

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

  socket.on("chat_message", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    console.log("💬", p.username + ":", data.message);
    io.in(p.current_area).emit("chat_message", {
      sender: p.username,
      playerId: p.playerId,
      message: data.message,
      area: p.current_area,
      timestamp: Date.now(),
    });
  });

  socket.on("change_area", async (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    const oldArea = p.current_area;
    const newArea = data.newArea;
    console.log("🗺️", p.username, ":", oldArea, "→", newArea);
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
  });

  socket.on("disconnect", (reason) => {
    const p = players.get(socket.id);
    if (!p) return;
    console.log("❌ Disconnect:", p.username, "-", reason);
    players.delete(socket.id);
    playerIdToSocketId.delete(p.playerId);
    io.in(p.current_area).emit("player_disconnected", p.playerId);
  });
});

app.get("/health", (req, res) => {
  if (req.query.key !== HEALTH_KEY) return res.status(401).send("Unauthorized");
  res.json({
    status: "OK",
    connectedPlayers: players.size,
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (req, res) => {
  res.send("TouchWorld Server v10.0.0 ✅");
});

httpServer.listen(PORT, () => {
  console.log("\n✅ SERVER RUNNING ON PORT", PORT);
  console.log("⚡ Ready!\n");
});
