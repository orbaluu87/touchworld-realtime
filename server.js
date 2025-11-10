// ============================================
// 🎮 TOUCH GAME - SOCKET.IO SERVER (Node.js)
// ============================================

import express from "express";
import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

// ============================================
// 🔒 CONFIGURATION & SECURITY
// ============================================

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.WSS_JWT_SECRET || process.env.JWT_SECRET;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || ["*"];

if (!JWT_SECRET) {
  console.error("❌ FATAL: JWT_SECRET not set!");
  process.exit(1);
}

console.log("🔐 JWT_SECRET loaded:", JWT_SECRET ? "✅" : "❌");
console.log("🌐 ALLOWED_ORIGINS:", ALLOWED_ORIGINS.join(", "));

// ============================================
// 🎮 GAME STATE MANAGEMENT
// ============================================

class GameServer {
  constructor(io) {
    this.io = io;
    this.players = new Map();
    this.userSessions = new Map();
    this.rateLimits = new Map();
    this.lastMoveUpdate = Date.now();

    this.MAX_MESSAGE_LENGTH = 30;
    this.MAX_POSITION = 10000;
    this.MIN_POSITION = -1000;

    console.log("🎮 GameServer initialized");
  }

  checkRateLimit(userId, action, maxRequests = 10, windowMs = 1000) {
    const key = `${userId}:${action}`;
    const now = Date.now();
    const limit = this.rateLimits.get(key);

    if (!limit) {
      this.rateLimits.set(key, { lastAction: now, count: 1 });
      return true;
    }

    if (now - limit.lastAction > windowMs) {
      this.rateLimits.set(key, { lastAction: now, count: 1 });
      return true;
    }

    if (limit.count >= maxRequests) return false;
    limit.count++;
    return true;
  }

  validateMessage(message) {
    if (!message || typeof message !== "string") return false;
    if (message.length > this.MAX_MESSAGE_LENGTH) return false;
    if (message.trim().length === 0) return false;
    if (/<script|javascript:|onerror=/i.test(message)) return false;
    return true;
  }

  validatePosition(x, y) {
    if (typeof x !== "number" || typeof y !== "number") return false;
    if (isNaN(x) || isNaN(y)) return false;
    if (x < this.MIN_POSITION || x > this.MAX_POSITION) return false;
    if (y < this.MIN_POSITION || y > this.MAX_POSITION) return false;
    return true;
  }

  addPlayer(socketId, playerData) {
    const { userId } = playerData;

    if (this.userSessions.has(userId)) {
      const oldSocketId = this.userSessions.get(userId);
      const oldSocket = this.io.sockets.sockets.get(oldSocketId);

      if (oldSocket && oldSocket.id !== socketId) {
        console.log(`⚠️ Disconnecting old session for user ${userId}`);
        oldSocket.emit("disconnect_reason", "logged_in_elsewhere");
        oldSocket.disconnect(true);
        this.players.delete(oldSocketId);
      }
    }

    this.players.set(socketId, playerData);
    this.userSessions.set(userId, socketId);
    console.log(`✅ Player joined: ${playerData.username} (${socketId})`);
  }

  removePlayer(socketId) {
    const player = this.players.get(socketId);
    if (player) {
      this.userSessions.delete(player.userId);
      this.players.delete(socketId);
      console.log(`👋 Player left: ${player.username}`);
    }
  }

  getPlayer(socketId) {
    return this.players.get(socketId);
  }

  getAllPlayers() {
    return Array.from(this.players.values());
  }

  updatePlayer(socketId, updates) {
    const player = this.players.get(socketId);
    if (player) Object.assign(player, updates);
  }

  queueMove(socketId, destination) {
    const player = this.getPlayer(socketId);
    if (!player) return;

    if (!this.validatePosition(destination.x, destination.y)) {
      console.warn(`❌ Invalid position from ${player.username}`);
      return;
    }

    if (!this.checkRateLimit(player.userId, "move", 30, 1000)) {
      console.warn(`⚠️ Rate limit for ${player.username} (move)`);
      return;
    }

    player.destination_x = destination.x;
    player.destination_y = destination.y;
    player.is_moving = true;

    const dx = destination.x - player.position_x;
    const dy = destination.y - player.position_y;

    player.direction =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "e"
          : "w"
        : dy > 0
        ? "s"
        : "n";
  }

  processMovement() {
    const now = Date.now();
    const deltaTime = (now - this.lastMoveUpdate) / 1000;
    this.lastMoveUpdate = now;

    const SPEED = 200;
    const updates = [];

    for (const [socketId, player] of this.players.entries()) {
      if (!player.is_moving || !player.destination_x) continue;

      const dx = player.destination_x - player.position_x;
      const dy = player.destination_y - player.position_y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 5) {
        player.position_x = player.destination_x;
        player.position_y = player.destination_y;
        player.is_moving = false;
        player.animation_frame = "idle";
      } else {
        const moveDistance = Math.min(SPEED * deltaTime, distance);
        const ratio = moveDistance / distance;
        player.position_x += dx * ratio;
        player.position_y += dy * ratio;
        player.animation_frame = "walk1";
      }

      updates.push({
        id: player.playerId,
        playerId: player.playerId,
        socketId,
        position_x: Math.round(player.position_x),
        position_y: Math.round(player.position_y),
        direction: player.direction,
        is_moving: player.is_moving,
        animation_frame: player.animation_frame,
      });
    }

    if (updates.length > 0) this.io.emit("players_moved", updates);
  }

  startMovementLoop() {
    setInterval(() => this.processMovement(), 50);
  }

  broadcastChatMessage(socketId, message) {
    const player = this.getPlayer(socketId);
    if (!player) return;

    if (!this.validateMessage(message)) {
      this.io.to(socketId).emit("chat_error", "הודעה לא חוקית");
      return;
    }

    if (!this.checkRateLimit(player.userId, "chat", 5, 10000)) {
      this.io.to(socketId).emit("chat_error", "אתה שולח הודעות מהר מדי");
      return;
    }

    const chatData = {
      id: player.playerId,
      playerId: player.playerId,
      username: player.username,
      message,
      timestamp: Date.now(),
    };

    this.io.emit("chat_message", chatData);
  }

  updatePlayerEquipment(socketId, equipment) {
    const player = this.getPlayer(socketId);
    if (!player) return;

    if (!this.checkRateLimit(player.userId, "equipment", 5, 5000)) return;

    player.equipment = equipment;
    this.io.emit("player_update", {
      id: player.playerId,
      playerId: player.playerId,
      equipment,
    });
  }

  changePlayerArea(socketId, newAreaId) {
    const player = this.getPlayer(socketId);
    if (!player || !newAreaId) return;

    const oldArea = player.current_area;
    player.current_area = newAreaId;

    this.io.emit("player_area_changed", {
      id: player.playerId,
      playerId: player.playerId,
      from: oldArea,
      to: newAreaId,
    });
  }
}

// ============================================
// 🚀 EXPRESS + SOCKET.IO SETUP
// ============================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const gameServer = new GameServer(io);

// ============================================
// 🔐 AUTH MIDDLEWARE
// ============================================

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error("Authentication token missing"));

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.userId = decoded.userId;
    socket.playerId = decoded.playerId;
    socket.username = decoded.username;
    next();
  } catch (err) {
    return next(new Error("Invalid token"));
  }
});

// ============================================
// 📡 SOCKET.IO EVENTS
// ============================================

io.on("connection", (socket) => {
  const playerData = {
    socketId: socket.id,
    userId: socket.userId,
    playerId: socket.playerId,
    username: socket.username,
    current_area: "area1",
    position_x: 960,
    position_y: 540,
    direction: "s",
    is_moving: false,
    animation_frame: "idle",
    equipment: {},
  };

  gameServer.addPlayer(socket.id, playerData);

  socket.emit("current_players", gameServer.getAllPlayers());
  socket.broadcast.emit("player_joined", playerData);

  socket.on("move_to", (data) => gameServer.queueMove(socket.id, data));
  socket.on("chat_message", (msg) => gameServer.broadcastChatMessage(socket.id, msg));
  socket.on("player_update", (data) => {
    if (data.equipment) gameServer.updatePlayerEquipment(socket.id, data.equipment);
  });
  socket.on("area_change", (areaId) => gameServer.changePlayerArea(socket.id, areaId));

  socket.on("disconnect", (reason) => {
    gameServer.removePlayer(socket.id);
    io.emit("player_disconnected", playerData.playerId);
    console.log(`🔌 Disconnected: ${socket.username || socket.id} (${reason})`);
  });
});

// ============================================
// 🩺 HEALTH CHECK
// ============================================

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    players: gameServer.players.size,
    timestamp: Date.now(),
  });
});

// ============================================
// 🏁 START SERVER
// ============================================

gameServer.startMovementLoop();
server.listen(PORT, () => {
  console.log(`🚀 Touch Game Server running on port ${PORT}`);
});
