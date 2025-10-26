import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"], credentials: true },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 10000;

if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET missing!');
  process.exit(1);
}

console.log('✅ Touch World Server v12.0 - COLLISION WORKING');

const connectedPlayers = new Map();
const MOVE_SPEED = 600;
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

// 🚫 Collision Check
function checkCollision(x, y, collisionRects) {
  if (!Array.isArray(collisionRects) || collisionRects.length === 0) return false;
  
  for (const rect of collisionRects) {
    if (!rect || typeof rect.x !== 'number') continue;
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      console.log(`🚫 BLOCKED: (${Math.round(x)},${Math.round(y)}) in rect (${rect.x},${rect.y},${rect.width}x${rect.height})`);
      return true;
    }
  }
  return false;
}

// 🎮 Game Loop
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
      
      // 🚫 CHECK COLLISION!
      if (player.collisionMap && checkCollision(newX, newY, player.collisionMap)) {
        console.log(`🚫 ${player.username} blocked at (${Math.round(newX)},${Math.round(newY)})`);
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '12.0', players: connectedPlayers.size });
});

app.get('/', (req, res) => {
  res.json({ message: 'Touch World Server', version: '12.0 - Collision', players: connectedPlayers.size });
});

io.on('connection', (socket) => {
  console.log(`🟡 CONNECTION: ${socket.id}`);
  
  socket.on('identify', async (data) => {
    try {
      if (!data || !data.token) {
        console.error(`❌ No token`);
        socket.disconnect(true);
        return;
      }
      
      let decoded;
      try {
        decoded = jwt.verify(data.token, JWT_SECRET);
        console.log(`✅ Token OK: ${decoded.username}`);
      } catch (e) {
        console.error(`❌ JWT failed`);
        socket.disconnect(true);
        return;
      }
      
      const collisionMap = data.collisionMap || [];
      console.log(`📦 Received ${collisionMap.length} collision rects for ${decoded.username}`);
      
      const playerData = {
        socketId: socket.id,
        playerId: decoded.playerId,
        userId: decoded.userId,
        username: decoded.username,
        admin_level: decoded.admin_level || 'user',
        current_area: data.areaId || 'area1',
        position_x: data.x || 690,
        position_y: data.y || 385,
        direction: data.direction || 's',
        is_moving: false,
        animation_frame: 'idle',
        equipment: data.equipment || {},
        collisionMap: collisionMap
      };
      
      connectedPlayers.set(socket.id, playerData);
      
      socket.emit('identify_ok', { playerId: playerData.playerId });
      
      const playersInArea = Array.from(connectedPlayers.values())
        .filter(p => p.current_area === playerData.current_area)
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
      
      socket.emit('current_players', playersInArea);
      
      socket.broadcast.emit('player_joined', {
        id: playerData.playerId,
        username: playerData.username,
        admin_level: playerData.admin_level,
        current_area: playerData.current_area,
        equipment: playerData.equipment,
        position_x: playerData.position_x,
        position_y: playerData.position_y,
        direction: playerData.direction,
        is_moving: false,
        animation_frame: 'idle'
      });
      
      console.log(`✅ ${decoded.username} identified in ${playerData.current_area} with ${collisionMap.length} collision rects`);
      
    } catch (error) {
      console.error('Identify error:', error);
      socket.disconnect(true);
    }
  });
  
  socket.on('move_to', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;
    
    const { x, y } = data;
    console.log(`🎯 ${player.username} wants to move to (${Math.round(x)}, ${Math.round(y)})`);
    
    // 🚫 בדוק collision לפני שמתחילים לזוז!
    if (player.collisionMap && checkCollision(x, y, player.collisionMap)) {
      console.log(`🚫 SERVER: Rejected move for ${player.username}`);
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
  });
  
  socket.on('change_area', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;
    
    const { newArea, collisionMap } = data;
    console.log(`🚪 ${player.username} changing to ${newArea} with ${collisionMap?.length || 0} collision rects`);
    
    socket.broadcast.emit('player_area_changed', { id: player.playerId });
    
    player.current_area = newArea;
    player.position_x = 690;
    player.position_y = 385;
    player.is_moving = false;
    player.collisionMap = collisionMap || [];
    
    const playersInNewArea = Array.from(connectedPlayers.values())
      .filter(p => p.current_area === newArea)
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
    
    socket.emit('current_players', playersInNewArea);
    
    socket.broadcast.emit('player_joined', {
      id: player.playerId,
      username: player.username,
      admin_level: player.admin_level,
      current_area: player.current_area,
      equipment: player.equipment,
      position_x: player.position_x,
      position_y: player.position_y,
      direction: player.direction,
      is_moving: false,
      animation_frame: 'idle'
    });
  });
  
  socket.on('chat_message', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;
    
    io.emit('chat_message', {
      id: player.playerId,
      playerId: player.playerId,
      username: player.username,
      message: data.message,
      timestamp: Date.now()
    });
  });
  
  socket.on('player_update', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;
    
    if (data.equipment) {
      player.equipment = data.equipment;
      
      io.emit('player_update', {
        id: player.playerId,
        equipment: data.equipment
      });
    }
  });
  
  socket.on('disconnect', () => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      console.log(`🔴 ${player.username} disconnected`);
      io.emit('player_disconnected', player.playerId);
      connectedPlayers.delete(socket.id);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
