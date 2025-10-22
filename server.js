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

console.log('✅ JWT_SECRET loaded');

const connectedPlayers = new Map();

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '8.3.0',
    connectedPlayers: connectedPlayers.size
  });
});

// 🎮 Game Loop - מחשב תנועות של שחקנים
const MOVE_SPEED = 200; // פיקסלים לשנייה
const TICK_RATE = 60; // 60 FPS
const TICK_INTERVAL = 1000 / TICK_RATE;

function gameLoop() {
  const now = Date.now();
  const movingPlayers = [];

  for (const [socketId, player] of connectedPlayers) {
    if (!player.is_moving || player.destination_x === undefined) continue;

    const dx = player.destination_x - player.position_x;
    const dy = player.destination_y - player.position_y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 5) {
      // הגענו ליעד
      player.position_x = player.destination_x;
      player.position_y = player.destination_y;
      player.is_moving = false;
      player.destination_x = undefined;
      player.destination_y = undefined;
      player.animation_frame = 'idle';
    } else {
      // ממשיכים לנוע
      const moveDistance = (MOVE_SPEED * TICK_INTERVAL) / 1000;
      const ratio = moveDistance / distance;

      player.position_x += dx * ratio;
      player.position_y += dy * ratio;

      // עדכון כיוון
      if (Math.abs(dx) > Math.abs(dy)) {
        player.direction = dx > 0 ? 'e' : 'w';
      } else {
        player.direction = dy > 0 ? 's' : 'n';
      }

      player.animation_frame = 'walk';
    }

    player.lastUpdate = now;
    movingPlayers.push({
      id: player.playerId,
      position_x: player.position_x,
      position_y: player.position_y,
      direction: player.direction,
      is_moving: player.is_moving,
      animation_frame: player.animation_frame
    });
  }

  // שלח עדכון רק אם יש שחקנים שזזו
  if (movingPlayers.length > 0) {
    io.emit('players_moved', movingPlayers);
  }
}

// התחל game loop
setInterval(gameLoop, TICK_INTERVAL);
console.log(`✅ Game loop started at ${TICK_RATE} FPS`);

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
        destination_x: undefined,
        destination_y: undefined,
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

      // Notify others
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
      console.error('❌ Identify error:', error.message);
      socket.emit('disconnect_reason', 'Authentication failed');
      socket.disconnect(true);
    }
  });

  // Handle movement
  socket.on('move_to', (data) => {
    console.log(`📍 Move request: (${data.x}, ${data.y})`);
    
    const player = connectedPlayers.get(socket.id);
    if (!player) {
      console.error('❌ Player not found for socket:', socket.id);
      return;
    }

    player.destination_x = data.x;
    player.destination_y = data.y;
    player.is_moving = true;
    player.lastUpdate = Date.now();

    console.log(`✅ ${player.username} moving to (${data.x}, ${data.y})`);
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

  // Handle player update (equipment, etc)
  socket.on('player_update', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    if (data.equipment) {
      player.equipment = data.equipment;
    }

    io.emit('player_update', {
      id: player.playerId,
      equipment: player.equipment
    });
  });

  // Handle area change
  socket.on('change_area', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    player.current_area = data.newArea;
    player.position_x = 690;
    player.position_y = 385;
    player.is_moving = false;

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

const PORT = Deno.env.get('PORT') || 10000;
httpServer.listen(PORT, () => {
  console.log(`✅ Touch World Server v8.3.0 running on port ${PORT}`);
  console.log(`🎮 Game loop: ${TICK_RATE} FPS`);
});
