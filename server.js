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

console.log('🚀 Touch World Realtime Server v3.0 Starting...');
console.log('📡 Realtime sync: Players, Chat, Trades');

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
        return; // התעלם משחקנים לא תקינים
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
        return; // התעלם מהודעות לא תקינות
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
        initiator_username: data.initiator_username || 'Unknown',
        receiver_username: data.receiver_username || 'Unknown',
        timestamp: data.timestamp || Date.now()
      });
      
      console.log(`🤝 Trade request: ${data.initiator_username} → ${data.receiver_username}`);
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
        console.log(`👋 ${playerUsername} left the game`);
        players.delete(playerToRemove);
        
        // שליחת הודעה לכל השחקנים שהשחקן עזב
        io.emit('remove', playerToRemove);
      }
    } catch (error) {
      console.error('❌ Error in disconnect handler:', error);
    }
  });

  // טיפול בשגיאות
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
  });
});

// ========================================
// 🔄 שליחת עדכוני שחקנים כל 50ms (20 FPS)
// ========================================
setInterval(() => {
  try {
    const now = Date.now();
    const playersArray = [];
    
    // ניקוי שחקנים לא פעילים (לא שלחו עדכון ב-10 שניות)
    for (const [playerId, playerData] of players.entries()) {
      if (now - playerData.lastUpdate > 10000) {
        console.log(`⏰ ${playerData.username} timed out (inactive for 10s)`);
        players.delete(playerId);
        io.emit('remove', playerId);
      } else {
        // רק שחקנים עם username תקין
        if (playerData.username && playerData.username !== 'שחקן') {
          playersArray.push(playerData);
        }
      }
    }

    // שליחת העדכון רק אם יש שחקנים
    if (playersArray.length > 0) {
      io.emit('update', playersArray);
    }
  } catch (error) {
    console.error('❌ Error in update interval:', error);
  }
}, 50); // כל 50ms = 20 FPS

// ========================================
// 🌐 דף בית
// ========================================
app.get('/', (req, res) => {
  const uptimeSeconds = Math.floor(process.uptime());
  const uptimeMinutes = Math.floor(uptimeSeconds / 60);
  const uptimeHours = Math.floor(uptimeMinutes / 60);
  
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="he">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Touch World Realtime Server</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
        }
        .container {
          background: rgba(0, 0, 0, 0.3);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          padding: 40px;
          max-width: 600px;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        h1 {
          font-size: 2.5em;
          margin-bottom: 10px;
          text-align: center;
        }
        .status {
          background: rgba(0, 255, 0, 0.2);
          border: 2px solid #00ff00;
          border-radius: 10px;
          padding: 15px;
          margin: 20px 0;
          text-align: center;
          font-size: 1.2em;
        }
        .stats {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin-top: 20px;
        }
        .stat {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          padding: 15px;
          text-align: center;
        }
        .stat-value {
          font-size: 2em;
          font-weight: bold;
          color: #ffd700;
        }
        .stat-label {
          font-size: 0.9em;
          opacity: 0.8;
          margin-top: 5px;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          opacity: 0.7;
          font-size: 0.9em;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>✅ Touch World Server</h1>
        <div class="status">
          🟢 Server Running
        </div>
        <div class="stats">
          <div class="stat">
            <div class="stat-value">${players.size}</div>
            <div class="stat-label">👥 שחקנים פעילים</div>
          </div>
          <div class="stat">
            <div class="stat-value">${uptimeHours}:${(uptimeMinutes % 60).toString().padStart(2, '0')}</div>
            <div class="stat-label">⏱️ זמן פעולה</div>
          </div>
          <div class="stat">
            <div class="stat-value">v3.0</div>
            <div class="stat-label">📦 גרסה</div>
          </div>
          <div class="stat">
            <div class="stat-value">20 FPS</div>
            <div class="stat-label">🔄 קצב עדכון</div>
          </div>
        </div>
        <div class="footer">
          🔌 Socket.IO | 💬 Real-time Chat | 🤝 Trades<br>
          🚀 Powered by Node.js & Express
        </div>
      </div>
    </body>
    </html>
  `);
});

// ========================================
// 🚀 הפעלת השרת
// ========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Touch World Realtime Server v3.0');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Server running on port ${PORT}`);
  console.log(`🌐 Local:  http://localhost:${PORT}`);
  console.log(`🔌 Socket.IO ready for connections`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
