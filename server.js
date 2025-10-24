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
  console.error('❌ JWT_SECRET not set!');
  process.exit(1);
}

console.log('✅ Touch World Server v10.0.0');

const connectedPlayers = new Map();

const MOVE_SPEED = 600;
const TICK_RATE = 60;
const TICK_INTERVAL = 1000 / TICK_RATE;

function gameLoop() {
  const updates = [];

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

      player.position_x += dx * ratio;
      player.position_y += dy * ratio;

      if (Math.abs(dx) > Math.abs(dy)) {
        player.direction = dx > 0 ? 'e' : 'w';
      } else {
        player.direction = dy > 0 ? 's' : 'n';
      }

      player.animation_frame = 'walk';
    }

    updates.push({
      id: player.playerId,
      position_x: Math.round(player.position_x),
      position_y: Math.round(player.position_y),
      direction: player.direction,
      is_moving: player.is_moving,
      animation_frame: player.animation_frame
    });
  }

  if (updates.length > 0) {
    io.emit('players_moved', updates);
  }
}

setInterval(gameLoop, TICK_INTERVAL);

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    version: '10.0.0',
    players: connectedPlayers.size
  });
});

app.get('/', (req, res) => {
  res.json({ 
    message: 'Touch World Server',
    version: '10.0.0'
  });
});

io.on('connection', (socket) => {
  console.log(`🟡 Connection: ${socket.id}`);

  socket.on('identify', async (data) => {
    try {
      if (!data || !data.token) {
        socket.emit('disconnect_reason', 'No token');
        socket.disconnect(true);
        return;
      }

      let decoded;
      try {
        decoded = jwt.verify(data.token, JWT_SECRET);
      } catch (err) {
        console.error(`❌ JWT fail: ${err.message}`);
        socket.emit('disconnect_reason', 'Invalid token');
        socket.disconnect(true);
        return;
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

      console.log(`✅ ${decoded.username} joined (${connectedPlayers.size})`);

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
      console.error(`❌ Error: ${error.message}`);
      socket.disconnect(true);
    }
  });

  socket.on('move_to', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    player.destination_x = data.x;
    player.destination_y = data.y;
    player.is_moving = true;
  });

  socket.on('player_update', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    if (data.equipment) {
      player.equipment = data.equipment;
      
      io.emit('player_update', {
        id: player.playerId,
        equipment: player.equipment
      });
    }
  });

  socket.on('chat_message', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    io.emit('chat_message', {
      id: player.playerId,
      playerId: player.playerId,
      username: player.username,
      message: data.message,
      text: data.message,
      timestamp: Date.now()
    });
  });

  socket.on('change_area', (data) => {
    const player = connectedPlayers.get(socket.id);
    if (!player) return;

    player.current_area = data.newArea;

    io.emit('player_area_changed', {
      id: player.playerId,
      current_area: data.newArea
    });
  });

  socket.on('trade_request', (data) => {
    const initiator = connectedPlayers.get(socket.id);
    if (!initiator || !data.receiver || !data.receiver.id) return;

    const receiverSocket = Array.from(connectedPlayers.entries())
      .find(([_, p]) => p.playerId === data.receiver.id);

    if (receiverSocket) {
      const [receiverSocketId, receiver] = receiverSocket;
      
      io.to(receiverSocketId).emit('trade_request_received', {
        trade_id: `trade_${Date.now()}`,
        initiator: {
          id: initiator.playerId,
          username: initiator.username
        }
      });
    }
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
      reason: data.reason || 'Trade cancelled'
    });
  });

  socket.on('disconnect', () => {
    const player = connectedPlayers.get(socket.id);
    
    if (player) {
      console.log(`❌ ${player.username} left`);
      connectedPlayers.delete(socket.id);
      
      io.emit('player_disconnected', player.playerId);
    }
  });
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, () => {
  console.log(`✅ Server on port ${PORT}`);
});
