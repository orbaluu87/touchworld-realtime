import express from 'npm:express@4.18.2';
import { createServer } from 'node:http';
import { Server } from 'npm:socket.io@4.6.1';
import jwt from 'npm:jsonwebtoken@9.0.2';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

const JWT_SECRET = Deno.env.get('JWT_SECRET');

if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET not configured!');
  Deno.exit(1);
}

console.log('✅ Touch World Server v10.0.0 - Collision Fixed!');

const connectedPlayers = new Map();

// 🎮 Game Loop Configuration
const MOVE_SPEED = 600;
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

// 🚫 בדיקת Collision בשרת!
function checkCollision(x, y, collisionRects) {
  if (!Array.isArray(collisionRects) || collisionRects.length === 0) {
    return false;
  }

  for (const rect of collisionRects) {
    if (!rect || typeof rect.x !== 'number') continue;

    const left = rect.x;
    const top = rect.y;
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;

    if (x >= left && x <= right && y >= top && y <= bottom) {
      return true;
    }
  }

  return false;
}

// 🎯 Game Loop - מחשב תנועות עם collision!
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
      const ratio = Math.min(moveDistance / distance, 1);

      const newX = player.position_x + (dx * ratio);
      const newY = player.position_y + (dy * ratio);

      if (player.collisionMap && checkCollision(newX, newY, player.collisionMap)) {
        console.log(`🚫 ${player.username} blocked by collision at (${Math.round(newX)}, ${Math.round(newY)})`);
        
        player.is_moving = false;
        player.destination_x = undefined;
        player.destination_y = undefined;
        player.animation_frame = 'idle';

        movingPlayers.push({
          id: player.playerId,
          position_x: Math.round(player.position_x),
          position_y: Math.round(player.position_y),
          direction: player.direction,
          is_moving: false,
          animation_frame: 'idle'
        });

        continue;
      }

      player.position_x = newX;
      player.position_y = newY;

      if (Math.abs(dx) > Math.abs(dy)) {
        player.direction = dx > 0 ? 'e' : 'w';
      } else {
        player.direction = dy > 0 ? 's' : 'n';
      }

      player.animation_frame = 'walk';
    }

    movingPlayers.push({
      id: player.playerId,
      position_x: Math.round(player.position_x),
      position_y: Math.round(player.position_y),
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
console.log(`✅ Game loop started with collision detection`);

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '10.0.0',
    connectedPlayers: connectedPlayers.size,
    collisionEnabled: true
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Touch World Real-Time Server',
    version: '10.0.0 - Collision Fixed',
    status: 'running'
  });
});

io.on('connection', (socket) => {
  console.log(`🟡 New connection: ${socket.id}`);

  socket.on('identify', async (data) => {
    try {
      if (!data || !data.token) {
        console.error(`❌ ${socket.id}: No token provided`);
        socket.emit('disconnect_reason', 'No authentication token');
        socket.disconnect(true);
        return;
      }

      let decoded;
      try {
        decoded = jwt.verify(data.token, JWT_SECRET);
      } catch (jwtError) {
        console.error(`❌ ${socket.id}: JWT verification failed`);
        socket.emit('disconnect_reason', 'Invalid token');
        socket.disconnect(true);
        return;
      }

      const collisionMap = data.collisionMap || [];
      console.log(`📍 ${decoded.username} collision map: ${collisionMap.length} rects`);

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
        destination_y: undefined,
        collisionMap: collisionMap,
        lastUpdate: Date.now()
      };

      connectedPlayers.set(socket.id, playerData);

      console.log(`✅ ${decoded.username} connected with collision (Total: ${connectedPlayers.size})`);

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
          is_moving: p.is_moving,
          animation_frame: p.animation_frame
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
        is_moving: playerData.is_moving,
        animation_frame: playerData.animation_frame
      });

    } catch (error) {
      console.error(`❌ Identify error:`, error);
      socket.disconnect(true);
    }
  });

  socket.on('move_to', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    const { x, y } = data;

    if (player.collisionMap && checkCollision(x, y, player.collisionMap)) {
      console.log(`🚫 ${player.username} tried to move to blocked area (${x}, ${y})`);
      socket.emit('move_rejected', { x, y });
      return;
    }

    player.destination_x = x;
    player.destination_y = y;
    player.is_moving = true;

    const dx = x - player.position_x;
    const dy = y - player.position_y;

    if (Math.abs(dx) > Math.abs(dy)) {
      player.direction = dx > 0 ? 'e' : 'w';
    } else {
      player.direction = dy > 0 ? 's' : 'n';
    }

    player.lastUpdate = Date.now();
  });

  socket.on('player_update', (updateData) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    if (updateData.equipment) {
      player.equipment = updateData.equipment;
      
      socket.broadcast.emit('player_update', {
        id: player.playerId,
        equipment: player.equipment
      });
    }
  });

  socket.on('chat_message', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    if (!data.message || typeof data.message !== 'string') return;

    const messageText = data.message.trim();
    if (messageText.length === 0 || messageText.length > 100) return;

    const chatData = {
      id: player.playerId,
      playerId: player.playerId,
      username: player.username,
      message: messageText,
      timestamp: Date.now()
    };

    io.emit('chat_message', chatData);
  });

  socket.on('change_area', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    player.current_area = data.newArea;
    player.position_x = 690;
    player.position_y = 385;
    player.is_moving = false;
    player.destination_x = undefined;
    player.destination_y = undefined;

    if (data.collisionMap) {
      player.collisionMap = data.collisionMap;
      console.log(`📍 ${player.username} changed area, collision map: ${player.collisionMap.length} rects`);
    }

    socket.broadcast.emit('player_area_changed', {
      id: player.playerId,
      newArea: data.newArea
    });
  });

  socket.on('disconnect', () => {
    const player = connectedPlayers.get(socket.id);
    
    if (player) {
      console.log(`👋 ${player.username} disconnected (Remaining: ${connectedPlayers.size - 1})`);
      
      connectedPlayers.delete(socket.id);
      
      socket.broadcast.emit('player_disconnected', player.playerId);
    }
  });
});

const PORT = Deno.env.get('PORT') || 3001;

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔒 Collision detection: ENABLED`);
});

export default httpServer;
