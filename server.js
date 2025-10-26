import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000
});

const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 10000;

if (!JWT_SECRET) {
  console.error('❌ JWT_SECRET not configured!');
  process.exit(1);
}

console.log('✅ Touch World Server v11.0 - Collision Fixed!');
console.log(`🔑 JWT: ${JWT_SECRET.substring(0, 10)}...`);

const connectedPlayers = new Map();

// 🎮 Game Configuration
const MOVE_SPEED = 600;
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

// 🚫 בדיקת Collision מדויקת!
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

    // בדיקה מדויקת
    if (x >= left && x <= right && y >= top && y <= bottom) {
      console.log(`🚫 COLLISION: (${Math.round(x)},${Math.round(y)}) blocked by rect (${rect.x},${rect.y},${rect.width}x${rect.height})`);
      return true;
    }
  }

  return false;
}

// 🎯 Game Loop
function gameLoop() {
  const movingPlayers = [];

  for (const [socketId, player] of connectedPlayers) {
    if (!player.is_moving || player.destination_x === undefined) continue;

    const dx = player.destination_x - player.position_x;
    const dy = player.destination_y - player.position_y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 10) {
      // הגענו ליעד
      player.position_x = player.destination_x;
      player.position_y = player.destination_y;
      player.is_moving = false;
      player.destination_x = undefined;
      player.destination_y = undefined;
      player.animation_frame = 'idle';
    } else {
      // חשב תנועה
      const moveDistance = (MOVE_SPEED * TICK_INTERVAL) / 1000;
      const ratio = Math.min(moveDistance / distance, 1);

      const newX = player.position_x + (dx * ratio);
      const newY = player.position_y + (dy * ratio);

      // 🚫 בדוק collision!
      if (player.collisionMap && checkCollision(newX, newY, player.collisionMap)) {
        console.log(`🚫 SERVER BLOCKED: ${player.username} at (${Math.round(newX)},${Math.round(newY)})`);
        
        // עצור את השחקן
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

      // ✅ תנועה מותרת
      player.position_x = newX;
      player.position_y = newY;

      // עדכן כיוון
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

// 🌐 HTTP Endpoints
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '11.0',
    players: connectedPlayers.size,
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Touch World Server',
    version: '11.0 - Collision Working',
    status: 'running',
    players: connectedPlayers.size
  });
});

// 🔌 Socket.IO
io.on('connection', (socket) => {
  console.log(`🟡 CONNECTION: ${socket.id}`);

  socket.on('identify', async (data) => {
    try {
      console.log(`🔐 IDENTIFY: ${socket.id}`);
      
      if (!data || !data.token) {
        console.error(`❌ No token from ${socket.id}`);
        socket.emit('disconnect_reason', 'No token');
        socket.disconnect(true);
        return;
      }

      // Verify JWT
      let decoded;
      try {
        decoded = jwt.verify(data.token, JWT_SECRET);
        console.log(`✅ Token OK: ${decoded.username}`);
      } catch (jwtError) {
        console.error(`❌ JWT failed: ${jwtError.message}`);
        socket.emit('disconnect_reason', 'Invalid token');
        socket.disconnect(true);
        return;
      }

      // קבל collision map מהקליינט
      const collisionMap = data.collisionMap || [];
      console.log(`📍 ${decoded.username} collision map: ${collisionMap.length} rects`);
      
      if (collisionMap.length > 0) {
        console.log(`📐 First rect:`, collisionMap[0]);
      }

      // צור את נתוני השחקן
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
        collisionMap: collisionMap, // 🚫 שמור את ה-collision map!
        lastUpdate: Date.now()
      };

      connectedPlayers.set(socket.id, playerData);
      console.log(`✅ ${decoded.username} CONNECTED (Total: ${connectedPlayers.size})`);

      // אמת שהשחקן קיבל identify
      socket.emit('identify_ok', {
        playerId: playerData.playerId,
        username: playerData.username
      });

      // שלח רשימת שחקנים אחרים
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

      // הודע לכל השחקנים על השחקן החדש
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

    } catch (error) {
      console.error(`❌ Identify error:`, error);
      socket.disconnect(true);
    }
  });

  // 🎯 קבלת בקשת תנועה
  socket.on('move_to', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) {
      console.warn(`⚠️ move_to from unknown socket: ${socket.id}`);
      return;
    }

    const { x, y } = data;
    console.log(`🎯 ${player.username} wants to move to (${Math.round(x)}, ${Math.round(y)})`);

    // 🚫 בדוק collision בשרת!
    if (player.collisionMap && checkCollision(x, y, player.collisionMap)) {
      console.log(`🚫 SERVER REJECTED: ${player.username} move to (${Math.round(x)}, ${Math.round(y)})`);
      
      // שלח לקליינט שהתנועה נדחתה
      socket.emit('move_rejected', { x, y });
      return;
    }

    // ✅ תנועה מותרת
    console.log(`✅ Move allowed for ${player.username}`);
    player.destination_x = x;
    player.destination_y = y;
    player.is_moving = true;

    // חשב כיוון
    const dx = x - player.position_x;
    const dy = y - player.position_y;

    if (Math.abs(dx) > Math.abs(dy)) {
      player.direction = dx > 0 ? 'e' : 'w';
    } else {
      player.direction = dy > 0 ? 's' : 'n';
    }
  });

  // 🔄 עדכון ציוד
  socket.on('player_update', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    if (data.equipment) {
      player.equipment = data.equipment;
      
      socket.broadcast.emit('player_update', {
        id: player.playerId,
        equipment: data.equipment
      });
    }
  });

  // 💬 הודעת צ'אט
  socket.on('chat_message', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    const messageData = {
      id: player.playerId,
      playerId: player.playerId,
      username: player.username,
      message: data.message || data.text,
      text: data.message || data.text,
      timestamp: Date.now()
    };

    io.emit('chat_message', messageData);
    console.log(`💬 ${player.username}: ${messageData.text}`);
  });

  // 🗺️ שינוי אזור
  socket.on('change_area', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    const newArea = data.newArea;
    const newCollisionMap = data.collisionMap || [];

    player.current_area = newArea;
    player.collisionMap = newCollisionMap; // 🚫 עדכן collision map!
    player.position_x = 690;
    player.position_y = 385;
    player.is_moving = false;
    player.destination_x = undefined;
    player.destination_y = undefined;

    console.log(`🗺️ ${player.username} → ${newArea} (${newCollisionMap.length} collision rects)`);

    socket.broadcast.emit('player_area_changed', {
      id: player.playerId,
      newArea: newArea
    });
  });

  // 💱 Trade events
  socket.on('trade_request', (data) => {
    const initiator = connectedPlayers.get(socket.id);
    if (!initiator) return;

    const receiverSocket = Array.from(connectedPlayers.entries())
      .find(([sid, p]) => p.playerId === data.receiver.id);

    if (!receiverSocket) return;

    const [receiverSocketId, receiver] = receiverSocket;

    io.to(receiverSocketId).emit('trade_request_received', {
      trade_id: `trade_${Date.now()}`,
      initiator: {
        id: initiator.playerId,
        username: initiator.username
      }
    });

    console.log(`💱 Trade: ${initiator.username} → ${receiver.username}`);
  });

  socket.on('trade_accept', (data) => {
    io.emit('trade_status_updated', {
      id: data.trade_id,
      status: 'started'
    });
  });

  socket.on('trade_cancel', (data) => {
    io.emit('trade_status_updated', {
      id: data.trade_id,
      status: 'cancelled',
      reason: data.reason
    });
  });

  // ⚡ ניתוק
  socket.on('disconnect', (reason) => {
    const player = connectedPlayers.get(socket.id);
    
    if (player) {
      console.log(`🔴 ${player.username} DISCONNECTED (${reason})`);
      
      socket.broadcast.emit('player_disconnected', player.playerId);
      connectedPlayers.delete(socket.id);
      
      console.log(`📊 Players: ${connectedPlayers.size}`);
    } else {
      console.log(`🔴 Unknown socket disconnected: ${socket.id}`);
    }
  });
});

// 🚀 Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`📊 Game loop: ${TICK_RATE} FPS, Speed: ${MOVE_SPEED}`);
  console.log(`🔒 Collision detection: ENABLED`);
  console.log(`✅ Ready for connections!`);
});
