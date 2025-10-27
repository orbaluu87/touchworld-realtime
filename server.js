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

console.log('✅ Touch World Server v12.0 - Pure Client-Side Collision!');
console.log(`🔑 JWT: ${JWT_SECRET.substring(0, 10)}...`);

const connectedPlayers = new Map();

// 🌐 HTTP Endpoints
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '12.0',
    players: connectedPlayers.size,
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Touch World Server',
    version: '12.0 - Client-Side Collision',
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

      const { userId, playerId, username, admin_level } = decoded;
      const areaId = data.areaId || 'area1';

      // בדוק אם המשתמש כבר מחובר
      for (const [existingSocketId, existingPlayer] of connectedPlayers) {
        if (existingPlayer.userId === userId) {
          console.log(`🔄 User ${username} already connected on ${existingSocketId}, disconnecting old connection`);
          const oldSocket = io.sockets.sockets.get(existingSocketId);
          if (oldSocket) {
            oldSocket.emit('disconnect_reason', 'logged_in_elsewhere');
            oldSocket.disconnect(true);
          }
          connectedPlayers.delete(existingSocketId);
        }
      }

      // צור אובייקט שחקן
      const playerData = {
        socketId: socket.id,
        userId: userId,
        playerId: playerId,
        username: username,
        admin_level: admin_level || 'user',
        current_area: areaId,
        position_x: 690,
        position_y: 385,
        direction: 's',
        is_moving: false,
        animation_frame: 'idle',
        equipment: {},
        is_trading: false
      };

      connectedPlayers.set(socket.id, playerData);
      socket.join(areaId);

      console.log(`✅ ${username} joined ${areaId} (${connectedPlayers.size} total)`);

      // שלח אישור
      socket.emit('identify_ok', { playerId: playerId });

      // שלח רשימת שחקנים באזור
      const playersInArea = Array.from(connectedPlayers.values())
        .filter(p => p.current_area === areaId)
        .map(p => ({
          id: p.playerId,
          username: p.username,
          admin_level: p.admin_level,
          current_area: p.current_area,
          equipment: p.equipment,
          position_x: p.position_x,
          position_y: p.position_y,
          direction: p.direction,
          is_moving: false,
          animation_frame: 'idle',
          is_trading: p.is_trading
        }));

      socket.emit('current_players', playersInArea);

      // הודע לאחרים על שחקן חדש
      socket.to(areaId).emit('player_joined', {
        id: playerId,
        username: username,
        admin_level: admin_level,
        current_area: areaId,
        equipment: {},
        position_x: 690,
        position_y: 385,
        direction: 's',
        is_moving: false,
        animation_frame: 'idle',
        is_trading: false
      });

    } catch (error) {
      console.error(`❌ Identify error:`, error);
      socket.disconnect(true);
    }
  });

  // 📍 עדכון מיקום - רק מיקום סופי!
  socket.on('position_update', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    const { x, y, direction } = data;
    
    player.position_x = x;
    player.position_y = y;
    if (direction) player.direction = direction;

    console.log(`📍 ${player.username} moved to (${x}, ${y})`);

    // שדר לכולם באזור
    socket.to(player.current_area).emit('player_position', {
      id: player.playerId,
      x: x,
      y: y,
      direction: direction || player.direction
    });
  });

  // 💬 צ'אט
  socket.on('chat_message', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    const { message } = data;
    if (!message || message.trim().length === 0) return;

    console.log(`💬 ${player.username}: ${message}`);

    io.to(player.current_area).emit('chat_message', {
      id: player.playerId,
      username: player.username,
      message: message.trim(),
      timestamp: Date.now()
    });
  });

  // 🚪 שינוי אזור
  socket.on('change_area', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    const { newArea } = data;
    const oldArea = player.current_area;

    socket.leave(oldArea);
    socket.join(newArea);
    player.current_area = newArea;

    console.log(`🚪 ${player.username} moved from ${oldArea} to ${newArea}`);

    // הודע לשחקנים באזור הישן
    socket.to(oldArea).emit('player_area_changed', {
      id: player.playerId,
      newArea: newArea
    });

    // הודע לשחקנים באזור החדש
    socket.to(newArea).emit('player_joined', {
      id: player.playerId,
      username: player.username,
      admin_level: player.admin_level,
      current_area: newArea,
      equipment: player.equipment,
      position_x: player.position_x,
      position_y: player.position_y,
      direction: player.direction,
      is_moving: false,
      animation_frame: 'idle',
      is_trading: player.is_trading
    });

    // שלח לשחקן את רשימת השחקנים באזור החדש
    const playersInNewArea = Array.from(connectedPlayers.values())
      .filter(p => p.current_area === newArea && p.socketId !== socket.id)
      .map(p => ({
        id: p.playerId,
        username: p.username,
        admin_level: p.admin_level,
        current_area: p.current_area,
        equipment: p.equipment,
        position_x: p.position_x,
        position_y: p.position_y,
        direction: p.direction,
        is_moving: false,
        animation_frame: 'idle',
        is_trading: p.is_trading
      }));

    socket.emit('current_players', playersInNewArea);
  });

  // 👕 עדכון ציוד
  socket.on('player_update', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    if (data.equipment) {
      player.equipment = data.equipment;
      console.log(`👕 ${player.username} updated equipment`);
    }

    io.to(player.current_area).emit('player_update', {
      id: player.playerId,
      equipment: player.equipment
    });
  });

  // 💰 בקשת החלפה
  socket.on('trade_request', (data) => {
    const initiator = connectedPlayers.get(socket.id);
    if (!initiator) return;

    const { receiver } = data;
    if (!receiver || !receiver.id) return;

    // מצא את ה-socket של המקבל
    let receiverSocket = null;
    for (const [sid, p] of connectedPlayers) {
      if (p.playerId === receiver.id) {
        receiverSocket = io.sockets.sockets.get(sid);
        break;
      }
    }

    if (receiverSocket) {
      const tradeId = `trade_${Date.now()}_${Math.random()}`;
      console.log(`💰 Trade request: ${initiator.username} -> ${receiver.id}`);

      receiverSocket.emit('trade_request_received', {
        trade_id: tradeId,
        initiator: {
          id: initiator.playerId,
          username: initiator.username
        }
      });
    }
  });

  // ✅ קבלת החלפה
  socket.on('trade_accept', (data) => {
    const { trade_id } = data;
    console.log(`✅ Trade accepted: ${trade_id}`);
    // Logic handled by client
  });

  // ❌ ביטול החלפה
  socket.on('trade_cancel', (data) => {
    const { trade_id, reason } = data;
    console.log(`❌ Trade cancelled: ${trade_id} - ${reason}`);
    // Logic handled by client
  });

  // 🔌 ניתוק
  socket.on('disconnect', (reason) => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      console.log(`🔴 DISCONNECT: ${player.username} (${reason})`);
      
      io.to(player.current_area).emit('player_disconnected', player.playerId);
      connectedPlayers.delete(socket.id);
      
      console.log(`👥 ${connectedPlayers.size} players online`);
    }
  });
});

// 🚀 Start Server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Accepting connections from all origins`);
});
