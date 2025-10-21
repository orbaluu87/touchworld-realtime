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
  console.error('❌ JWT_SECRET not configured!');
  process.exit(1);
}

console.log('✅ JWT_SECRET loaded');

const connectedPlayers = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '8.2.1',
    connectedPlayers: connectedPlayers.size
  });
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('🟡 New connection:', socket.id);

  socket.on('identify', async (data) => {
    try {
      console.log('🔍 Verifying token...');
      
      if (!data || !data.token) {
        console.error('❌ No token provided');
        socket.emit('disconnect_reason', 'No authentication token');
        socket.disconnect(true);
        return;
      }

      // ✅ Verify JWT token
      let decoded;
      try {
        decoded = jwt.verify(data.token, JWT_SECRET);
        console.log('✅ Token verified for user:', decoded.username);
      } catch (jwtError) {
        console.error('❌ JWT verification failed:', jwtError.message);
        socket.emit('disconnect_reason', 'Invalid token');
        socket.disconnect(true);
        return;
      }

      // Store player data
      const playerData = {
        socketId: socket.id,
        playerId: decoded.playerId,
        userId: decoded.userId,
        username: decoded.username,
        admin_level: decoded.admin_level || 'user',
        current_area: 'area1',
        position_x: 690,
        position_y: 385,
        direction: 's',
        is_moving: false,
        animation_frame: 'idle',
        equipment: {},
        lastUpdate: Date.now()
      };

      connectedPlayers.set(socket.id, playerData);

      console.log(`✅ Player ${decoded.username} connected (${connectedPlayers.size} total)`);

      // Send confirmation
      socket.emit('identify_ok', {
        playerId: playerData.playerId,
        username: playerData.username
      });

      // Send current players
      const otherPlayers = Array.from(connectedPlayers.values())
        .filter(p => p.socketId !== socket.id);
      
      socket.emit('current_players', otherPlayers);

      // Notify others
      socket.broadcast.emit('player_joined', playerData);

    } catch (error) {
      console.error('❌ Identify error:', error.message);
      socket.emit('disconnect_reason', 'Authentication failed');
      socket.disconnect(true);
    }
  });

  // Handle movement
  socket.on('move_to', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    player.destination_x = data.x;
    player.destination_y = data.y;
    player.is_moving = true;
    player.lastUpdate = Date.now();

    io.emit('players_moved', [player]);
  });

  // Handle chat
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

  // Handle area change
  socket.on('change_area', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    player.current_area = data.newArea;
    io.emit('player_area_changed', {
      id: player.playerId,
      current_area: data.newArea
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    const player = connectedPlayers.get(socket.id);
    if (player) {
      console.log(`❌ Player ${player.username} disconnected`);
      connectedPlayers.delete(socket.id);
      io.emit('player_disconnected', player.playerId);
    }
  });
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`✅ Touch World Server running on port ${PORT}`);
});
