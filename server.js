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

// מפת שחקנים: playerId -> player data
let players = new Map();

console.log('🚀 Touch World Realtime Server v4.0 Starting...');
console.log('⚡ 60 FPS Sync | 💬 Real-time Chat | 🤝 Live Trades');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// ========================================
// 📡 שידור מצב כל השחקנים - 60 FPS
// ========================================
setInterval(() => {
  if (players.size === 0) return;
  
  // מסננים שחקנים תקינים בלבד
  const validPlayers = Array.from(players.values()).filter(p => 
    p.id && p.username && p.username !== 'שחקן'
  );
  
  if (validPlayers.length > 0) {
    // שידור לכל השחקנים
    io.emit('update', validPlayers);
  }
}, 16); // 60 FPS = כל 16ms

// ========================================
// 🧹 ניקוי שחקנים לא פעילים
// ========================================
setInterval(() => {
  const now = Date.now();
  const timeout = 30000; // 30 שניות
  
  let removed = 0;
  for (const [playerId, playerData] of players.entries()) {
    if (now - playerData.lastUpdate > timeout) {
      console.log(`⏰ Removing inactive player: ${playerData.username} (${playerId})`);
      players.delete(playerId);
      io.emit('remove', playerId);
      removed++;
    }
  }
  
  if (removed > 0) {
    console.log(`🧹 Cleaned ${removed} inactive players. Active: ${players.size}`);
  }
}, 10000); // כל 10 שניות

io.on('connection', (socket) => {
  console.log('🟢 Socket connected:', socket.id);
  
  let currentPlayerId = null;
  let currentUsername = null;

  // ========================================
  // 🎮 קבלת תנועת שחקן
  // ========================================
  socket.on('move', (data) => {
    try {
      const { 
        playerId, x, y, direction, is_moving, username, admin_level, skin_code, 
        equipped_hair, equipped_top, equipped_pants, equipped_hat, 
        equipped_halo, equipped_necklace, equipped_accessories, 
        is_invisible, animation_frame 
      } = data;
      
      // 🔥 וולידציה: חייב להיות playerId ו-username תקין
      if (!playerId || !username || username === 'שחקן') {
        return;
      }

      // שמירת פרטי השחקן בפעם הראשונה
      if (!currentPlayerId) {
        currentPlayerId = playerId;
        currentUsername = username;
        console.log(`🎮 ${username} (${playerId}) joined the game`);
      }

      // עדכון/יצירת נתוני השחקן
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

  // ========================================
  // 💬 הודעות צ'אט
  // ========================================
  socket.on('bubbleMessage', (data) => {
    try {
      if (!data.playerId || !data.username || data.username === 'שחקן') {
        return;
      }
      
      // שידור מיידי ההודעה לכל השחקנים
      io.emit('bubbleMessage', {
        playerId: data.playerId,
        message: data.message,
        username: data.username,
        adminLevel: data.adminLevel || 'user',
        timestamp: data.timestamp || Date.now()
      });
      
      console.log(`💬 ${data.username}: ${data.message}`);
    } catch (error) {
      console.error('❌ Error in bubbleMessage handler:', error);
    }
  });

  // ========================================
  // 🤝 מערכת החלפות (Trades)
  // ========================================
  socket.on('tradeRequest', (data) => {
    try {
      // שידור מיידי של בקשת ההחלפה
      io.emit('tradeRequest', {
        tradeId: data.tradeId,
        initiator_id: data.initiator_id,
        receiver_id: data.receiver_id,
        timestamp: data.timestamp || Date.now()
      });
      
      console.log(`🤝 Trade request: ${data.tradeId}`);
    } catch (error) {
      console.error('❌ Error in tradeRequest handler:', error);
    }
  });

  socket.on('tradeUpdate', (data) => {
    try {
      // שידור מיידי של עדכון ההחלפה
      io.emit('tradeUpdate', {
        tradeId: data.tradeId,
        status: data.status,
        timestamp: data.timestamp || Date.now()
      });
      
      console.log(`🔄 Trade updated: ${data.tradeId} → ${data.status}`);
    } catch (error) {
      console.error('❌ Error in tradeUpdate handler:', error);
    }
  });

  // ========================================
  // 🔴 ניתוק
  // ========================================
  socket.on('disconnect', (reason) => {
    console.log('🔴 Socket disconnected:', socket.id, 'Reason:', reason);
    
    try {
      // מציאת השחקן לפי socketId
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
        
        // שידור להסרת השחקן
        io.emit('remove', playerToRemove);
        
        console.log(`👋 ${playerUsername} (${playerToRemove}) left the game`);
        console.log(`📊 Active players: ${players.size}`);
        
        // איפוס המזהים
        if (currentPlayerId === playerToRemove) {
          currentPlayerId = null;
          currentUsername = null;
        }
      }
    } catch (error) {
      console.error('❌ Error handling disconnect:', error);
    }
  });
});

// ========================================
// 🚀 הפעלת השרת
// ========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`🌐 WebSocket endpoint: ws://localhost:${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

// ========================================
// 📊 לוג סטטיסטיקות כל דקה
// ========================================
setInterval(() => {
  const playerCount = players.size;
  if (playerCount > 0) {
    const playerNames = Array.from(players.values()).map(p => p.username).join(', ');
    console.log(`📊 [${new Date().toLocaleTimeString('he-IL')}] Active players (${playerCount}): ${playerNames}`);
  }
}, 60000); // כל דקה
