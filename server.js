import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('❌ No JWT_SECRET');
  process.exit(1);
}

const connectedPlayers = new Map();
const areaMaps = new Map();

// 🚫 בדיקת collision - פשוט מלבנים!
function isBlocked(x, y, areaId) {
  const rects = areaMaps.get(areaId);
  if (!Array.isArray(rects) || rects.length === 0) return false;

  for (const rect of rects) {
    if (!rect || typeof rect.x !== 'number') continue;

    const left = rect.x;
    const top = rect.y;
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;

    if (x >= left && x <= right && y >= top && y <= bottom) {
      return true; // חסום!
    }
  }

  return false;
}

// 🎮 Game Loop
const MOVE_SPEED = 600;
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

function gameLoop() {
  const movingPlayers = [];

  for (const [socketId, player] of connectedPlayers) {
    if (!player.is_moving || player.destination_x === undefined) continue;

    const dx = player.destination_x - player.position_x;
    const dy = player.destination_y - player.position_y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 10) {
      player.position_x = player.destination_x;
      player.position_y = player.destination_y;
      player.is_moving = false;
      player.destination_x = undefined;
      player.destination_y = undefined;
      player.animation_frame = 'idle';
    } else {
      const moveDistance = (MOVE_SPEED * TICK_INTERVAL) / 1000;
      const ratio = moveDistance / distance;

      const newX = player.position_x + (dx * ratio);
      const newY = player.position_y + (dy * ratio);

      if (isBlocked(newX, newY, player.current_area)) {
        player.is_moving = false;
        player.destination_x = undefined;
        player.destination_y = undefined;
        player.animation_frame = 'idle';
      } else {
        player.position_x = newX;
        player.position_y = newY;

        if (Math.abs(dx) > Math.abs(dy)) {
          player.direction = dx > 0 ? 'e' : 'w';
        } else {
          player.direction = dy > 0 ? 's' : 'n';
        }

        player.animation_frame = 'walk';
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
    io.emit('players_moved', movingPlayers);
  }
}

setInterval(gameLoop, TICK_INTERVAL);

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '9.0.0',
    players: connectedPlayers.size
  });
});

io.on('connection', (socket) => {
  socket.on('identify', async (data) => {
    try {
      if (!data || !data.token) {
        socket.disconnect(true);
        return;
      }

      let decoded;
      try {
        decoded = jwt.verify(data.token, JWT_SECRET);
      } catch (err) {
        socket.disconnect(true);
        return;
      }

      // 🗺️ שמירת collision
      if (data.collisionMap && Array.isArray(data.collisionMap)) {
        const areaId = data.areaId || 'area1';
        areaMaps.set(areaId, data.collisionMap);
        console.log(`✅ Collision: ${areaId} = ${data.collisionMap.length} rects`);
      }

      const playerData = {
        socketId: socket.id,
        playerId: decoded.playerId,
        userId: decoded.userId,
        username: decoded.username,
        admin_level: decoded.admin_level || 'user',
        current_area: data.areaId || 'area1',
        position_x: 690,
        position_y: 385,
        direction: 's',
        is_moving: false,
        animation_frame: 'idle',
        equipment: {},
        destination_x: undefined,
        destination_y: undefined
      };

      connectedPlayers.set(socket.id, playerData);
      console.log(`✅ ${decoded.username} joined`);

      socket.emit('identify_ok', { 
        playerId: playerData.playerId, 
        username: playerData.username 
      });

      const otherPlayers = Array.from(connectedPlayers.values())
        .filter(p => p.socketId !== socket.id)
        .map(p => ({
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
      
      socket.emit('current_players', otherPlayers);

      socket.broadcast.emit('player_joined', {
        id: playerData.playerId,
        username: playerData.username,
        admin_level: playerData.admin_level,
        current_area: playerData.current_area,
        equipment: playerData.equipment,
        position_x: playerData.position_x,
        position_y: playerData.position_y,
        direction: playerData.direction,
        is_moving: playerData.is_moving
      });

    } catch (error) {
      socket.disconnect(true);
    }
  });

  socket.on('move_to', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    // 🚫 בדיקה אם היעד חסום
    if (isBlocked(data.x, data.y, player.current_area)) {
      return;
    }

    player.destination_x = data.x;
    player.destination_y = data.y;
    player.is_moving = true;
  });

  socket.on('chat_message', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    io.emit('chat_message', {
      id: player.playerId,
      username: player.username,
      message: data.message,
      timestamp: Date.now()
    });
  });

  socket.on('change_area', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    player.current_area = data.newArea;

    if (data.collisionMap && Array.isArray(data.collisionMap)) {
      areaMaps.set(data.newArea, data.collisionMap);
    }

    io.emit('player_area_changed', {
      id: player.playerId,
      current_area: data.newArea
    });
  });

  socket.on('disconnect', () => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      connectedPlayers.delete(socket.id);
      io.emit('player_disconnected', player.playerId);
    }
  });
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Touch World v9.0.0 - port ${PORT}`);
});
