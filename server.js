// ==========================================
// ⚙️ Touch World Secure Server v8.4.1
// Includes: JWT auth + Collision detection
// ==========================================

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ["websocket", "polling"]
});

// ===== Environment Variables =====
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET not configured!");
  process.exit(1);
}
console.log("✅ JWT_SECRET loaded");

// ===== Data Storage =====
const connectedPlayers = new Map();
const areaMaps = new Map(); // שומר collision maps לפי אזור

// ===== Collision Functions =====
function isPointInPolygon(x, y, polygon) {
  if (!polygon || !Array.isArray(polygon) || polygon.length < 3) return false;

  const BASE_WIDTH = 1380;
  const BASE_HEIGHT = 770;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = (polygon[i].x / 100) * BASE_WIDTH;
    const yi = (polygon[i].y / 100) * BASE_HEIGHT;
    const xj = (polygon[j].x / 100) * BASE_WIDTH;
    const yj = (polygon[j].y / 100) * BASE_HEIGHT;

    const intersect =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

function isPositionBlocked(x, y, areaId) {
  const collisionMap = areaMaps.get(areaId);
  if (!collisionMap || !Array.isArray(collisionMap)) return false;

  for (const polygon of collisionMap) {
    if (isPointInPolygon(x, y, polygon.points)) {
      return true;
    }
  }
  return false;
}

// ===== Game Loop =====
const MOVE_SPEED = 200;
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

function gameLoop() {
  const movingPlayers = [];

  for (const [socketId, player] of connectedPlayers) {
    if (!player.is_moving || player.destination_x === undefined) continue;

    const dx = player.destination_x - player.position_x;
    const dy = player.destination_y - player.position_y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 5) {
      player.position_x = player.destination_x;
      player.position_y = player.destination_y;
      player.is_moving = false;
      player.destination_x = undefined;
      player.destination_y = undefined;
      player.animation_frame = "idle";
    } else {
      const moveDistance = (MOVE_SPEED * TICK_INTERVAL) / 1000;
      const ratio = moveDistance / distance;
      const newX = player.position_x + dx * ratio;
      const newY = player.position_y + dy * ratio;

      if (isPositionBlocked(newX, newY, player.current_area)) {
        console.log(`🚫 ${player.username} blocked by collision`);
        player.is_moving = false;
        player.destination_x = undefined;
        player.destination_y = undefined;
        player.animation_frame = "idle";
      } else {
        player.position_x = newX;
        player.position_y = newY;

        if (Math.abs(dx) > Math.abs(dy)) {
          player.direction = dx > 0 ? "e" : "w";
        } else {
          player.direction = dy > 0 ? "s" : "n";
        }

        player.animation_frame = "walk";
      }
    }

    movingPlayers.push({
      id: player.playerId,
      position_x: player.position_x,
      position_y: player.position_y,
      direction: player.direction,
      is_moving: player.is_moving,
      animation_frame: player.animation_frame
    });
  }

  if (movingPlayers.length > 0) {
    io.emit("players_moved", movingPlayers);
  }
}

setInterval(gameLoop, TICK_INTERVAL);
console.log(`✅ Game loop started (${TICK_RATE} FPS)`);

// ===== Health Check =====
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    version: "8.4.1-COLLISION",
    connectedPlayers: connectedPlayers.size,
    loadedAreas: areaMaps.size
  });
});

// ===== Socket.IO Connection =====
io.on("connection", (socket) => {
  console.log("🟡 New connection:", socket.id);

  socket.on("identify", (data) => {
    try {
      if (!data || !data.token) {
        socket.emit("disconnect_reason", "No authentication token");
        socket.disconnect(true);
        return;
      }

      let decoded;
      try {
        decoded = jwt.verify(data.token, JWT_SECRET);
        console.log(`✅ Token verified for user: ${decoded.username}`);
      } catch (err) {
        console.error(`❌ JWT verification failed: ${err.message}`);
        socket.emit("disconnect_reason", "Invalid token");
        socket.disconnect(true);
        return;
      }

      // 🚧 אם נשלח Collision Map בעת ההתחברות
      if (data.collisionMap) {
        try {
          const parsed =
            typeof data.collisionMap === "string"
              ? JSON.parse(data.collisionMap)
              : data.collisionMap;

          areaMaps.set(data.areaId || "area1", parsed);
          console.log(`✅ Collision map loaded for ${data.areaId || "area1"}`);
        } catch (e) {
          console.error("❌ Failed to parse collision map:", e.message);
        }
      }

      // שחקן חדש
      const player = {
        socketId: socket.id,
        playerId: decoded.playerId,
        userId: decoded.userId,
        username: decoded.username,
        admin_level: decoded.admin_level || "user",
        current_area: data.areaId || "area1",
        position_x: 690,
        position_y: 385,
        direction: "s",
        is_moving: false,
        animation_frame: "idle",
        equipment: {},
        destination_x: undefined,
        destination_y: undefined,
        lastUpdate: Date.now()
      };

      connectedPlayers.set(socket.id, player);
      console.log(`✅ Player ${player.username} connected (${connectedPlayers.size} total)`);

      socket.emit("identify_ok", {
        playerId: player.playerId,
        username: player.username
      });

      // שלח שחקנים אחרים
      const others = Array.from(connectedPlayers.values())
        .filter((p) => p.socketId !== socket.id)
        .map((p) => ({
          id: p.playerId,
          username: p.username,
          admin_level: p.admin_level,
          current_area: p.current_area,
          equipment: p.equipment,
          position_x: p.position_x,
          position_y: p.position_y,
          direction: p.direction,
          is_moving: p.is_moving
        }));

      socket.emit("current_players", others);

      socket.broadcast.emit("player_joined", {
        id: player.playerId,
        username: player.username,
        admin_level: player.admin_level,
        current_area: player.current_area,
        equipment: player.equipment,
        position_x: player.position_x,
        position_y: player.position_y,
        direction: player.direction,
        is_moving: player.is_moving
      });
    } catch (err) {
      console.error("❌ Identify error:", err.message);
      socket.emit("disconnect_reason", "Authentication failed");
      socket.disconnect(true);
    }
  });

  // ===== תנועה =====
  socket.on("move_to", (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    if (isPositionBlocked(data.x, data.y, player.current_area)) {
      console.log(`🚫 ${player.username} tried to move into blocked area`);
      return;
    }

    player.destination_x = data.x;
    player.destination_y = data.y;
    player.is_moving = true;
    console.log(`📍 ${player.username} moving to (${data.x}, ${data.y})`);
  });

  // ===== עדכון Collision Map =====
  socket.on("update_collision_map", (data) => {
    if (data.areaId && data.collisionMap) {
      try {
        const parsed =
          typeof data.collisionMap === "string"
            ? JSON.parse(data.collisionMap)
            : data.collisionMap;
        areaMaps.set(data.areaId, parsed);
        console.log(`✅ Collision map updated for area: ${data.areaId}`);
      } catch (err) {
        console.error("❌ Failed to update collision map:", err.message);
      }
    }
  });

  // ===== צ׳אט =====
  socket.on("chat_message", (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    io.emit("chat_message", {
      id: player.playerId,
      username: player.username,
      message: data.message,
      timestamp: Date.now()
    });
  });

  // ===== עדכון פריטים =====
  socket.on("player_update", (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    if (data.equipment) {
      player.equipment = data.equipment;
      io.emit("player_update", {
        id: player.playerId,
        equipment: player.equipment
      });
    }
  });

  // ===== החלפת אזור =====
  socket.on("change_area", (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    player.current_area = data.newArea;
    player.position_x = 690;
    player.position_y = 385;
    player.is_moving = false;

    io.emit("player_area_changed", {
      id: player.playerId,
      current_area: data.newArea
    });
  });

  // ===== ניתוק =====
  socket.on("disconnect", () => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      console.log(`❌ ${player.username} disconnected`);
      connectedPlayers.delete(socket.id);
      io.emit("player_disconnected", player.playerId);
    }
  });
});

// ===== Server Start =====
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`✅ Touch World Server v8.4.1 running on port ${PORT}`);
  console.log(`🎮 Collision system enabled | Tickrate ${TICK_RATE} FPS`);
});
