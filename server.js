const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

// מפת שחקנים
let players = new Map();

console.log('🚀 Touch World Realtime Server v4.0 - 60 FPS Edition');
console.log('⚡ Ultra-smooth realtime sync');

io.on('connection', (socket) => {
  console.log('🟢 Socket connected:', socket.id);
  
  let currentPlayerId = null;
  let currentUsername = null;

  // 🎮 קבלת תנועת שחקן
  socket.on('move', (data) => {
    try {
      const { 
        playerId, x, y, direction, is_moving, username, admin_level, skin_code, 
        equipped_hair, equipped_top, equipped_pants, equipped_hat, 
        equipped_halo, equipped_necklace, equipped_accessories, 
        is_invisible, animation_frame 
      } = data;
      
      if (!playerId || !username || username === 'שחקן') return;

      if (!currentPlayerId) {
        currentPlayerId = playerId;
        currentUsername = username;
        console.log(`🎮 ${username} (${playerId}) joined`);
      }

      players.set(currentPlayerId, {
        id: currentPlayerId,
        socketId: socket.id,
        x: Math.round(x),
        y: Math.round(y),
        direction: direction || 'front',
        is_moving: is_moving || false,
        username: username,
        admin_level: admin_level || 'user',
        skin_code: skin_code || 'blue',
        equipped_hair: equipped_hair || null,
        equipped_top: equipped_top || null,
        equipped_pants: equipped_pants || null,
        equipped_hat: equipped_hat || null,
        equipped_halo: equipped_halo || null,
        equipped_necklace: equipped_necklace || null,
        equipped_accessories: equipped_accessories || [],
        is_invisible: is_invisible || false,
        animation_frame: animation_frame || 'idle',
        lastUpdate: Date.now()
      });
    } catch (error) {
      console.error('❌ Error in move handler:', error);
    }
  });

  // 💬 הודעות צ'אט
  socket.on('bubbleMessage', (data) => {
    try {
      if (!data.playerId || !username || data.username === 'שחקן') return;
      
      io.emit('bubbleMessage', {
        playerId: data.playerId,
        message: data.message,
        username: data.username,
        adminLevel: data.adminLevel || 'user',
        timestamp: data.timestamp || Date.now()
      });
      
      console.log(`💬 ${data.username}: ${data.message}`);
    } catch (error) {
      console.error('❌ Error in bubbleMessage:', error);
    }
  });

  // 🤝 החלפות
  socket.on('tradeRequest', (data) => {
    try {
      io.emit('tradeRequest', {
        tradeId: data.tradeId,
        initiator_id: data.initiator_id,
        receiver_id: data.receiver_id,
        initiator_username: data.initiator_username || 'Unknown',
        receiver_username: data.receiver_username || 'Unknown',
        timestamp: data.timestamp || Date.now()
      });
      
      console.log(`🤝 Trade: ${data.initiator_username} → ${data.receiver_username}`);
    } catch (error) {
      console.error('❌ Error in tradeRequest:', error);
    }
  });

  socket.on('tradeUpdate', (data) => {
    try {
      io.emit('tradeUpdate', {
        tradeId: data.tradeId,
        status: data.status,
        timestamp: data.timestamp || Date.now()
      });
      
      console.log(`🔄 Trade updated: ${data.tradeId} → ${data.status}`);
    } catch (error) {
      console.error('❌ Error in tradeUpdate:', error);
    }
  });

  // 🔴 ניתוק
  socket.on('disconnect', (reason) => {
    console.log('🔴 Disconnected:', socket.id, reason);
    
    try {
      let playerToRemove = null;
      let playerUsername = null;
      
      for (const [playerId, playerData] of players.entries()) {
        if (playerData.socketId === socket.id) {
          playerToRemove = playerId;
          playerUsername = playerData.username;
          break;
        }
      }
      
      if (playerToRemove) {
        players.delete(playerToRemove);
        io.emit('remove', playerToRemove);
        console.log(`👋 ${playerUsername} left (${players.size} players online)`);
      }
    } catch (error) {
      console.error('❌ Error in disconnect:', error);
    }
  });
});

// 🔥 שידור מצב כל השחקנים - 60 FPS (כל 16ms)
setInterval(() => {
  try {
    if (players.size === 0) return;
    
    const now = Date.now();
    const playersArray = Array.from(players.values())
      .filter(p => (now - p.lastUpdate) < 5000); // רק שחקנים פעילים
    
    if (playersArray.length > 0) {
      io.emit('update', playersArray);
    }
  } catch (error) {
    console.error('❌ Broadcast error:', error);
  }
}, 16); // 🎯 60 FPS = 16.67ms

// ניקוי שחקנים לא פעילים
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  
  for (const [playerId, playerData] of players.entries()) {
    if (now - playerData.lastUpdate > 10000) {
      players.delete(playerId);
      io.emit('remove', playerId);
      removed++;
    }
  }
  
  if (removed > 0) {
    console.log(`🧹 Cleaned ${removed} inactive players`);
  }
}, 5000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`⚡ 60 FPS sync active`);
});
