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

console.log('🚀 Touch World Realtime Server v2.1 Starting...');

io.on('connection', (socket) => {
  console.log('🟢 Socket connected:', socket.id);
  
  let currentPlayerId = null;
  let currentUsername = null;

  // קבלת תנועת שחקן
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

  // הודעות צ'אט
  socket.on('bubbleMessage', (data) => {
    try {
      if (!data.playerId || !data.username || data.username === 'שחקן') {
        return; // התעלם מהודעות לא תקינות
      }
      
      // שידור ההודעה לכל השחקנים
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

  // בקשות החלפה
  socket.on('tradeRequest', (data) => {
    try {
      io.emit('tradeRequest', data);
      console.log(`🤝 Trade request: ${data.initiator_username} → ${data.receiver_username}`);
    } catch (error) {
      console.error('❌ Error in tradeRequest handler:', error);
    }
  });

  socket.on('tradeUpdate', (data) => {
    try {
      io.emit('tradeUpdate', data);
      console.log(`🔄 Trade updated: ${data.tradeId} → ${data.status}`);
    } catch (error) {
      console.error('❌ Error in tradeUpdate handler:', error);
    }
  });

  // ניתוק
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

// 🔄 שליחת עדכוני שחקנים כל 50ms (20 FPS)
setInterval(() => {
  try {
    const now = Date.now();
    const playersArray = [];
    
    // ניקוי שחקנים לא פעילים (לא שלחו עדכון ב-10 שניות)
    for (const [playerId, playerData] of players.entries()) {
      if (now - playerData.lastUpdate > 10000) {
        console.log(`⏰ ${playerData.username} timed out`);
        players.delete(playerId);
        io.emit('remove', playerId);
      } else {
        // רק שחקנים עם username אמיתי
        if (playerData.username && playerData.username !== 'שחקן') {
          playersArray.push(playerData);
        }
      }
    }

    // שליחת עדכון רק אם יש שחקנים
    if (playersArray.length > 0) {
      io.emit('update', playersArray);
    }
  } catch (error) {
    console.error('❌ Error in update interval:', error);
  }
}, 50);

// 📊 דף סטטוס
app.get('/', (req, res) => {
  const playersList = Array.from(players.values())
    .map(p => `<li>${p.username} (${p.admin_level})</li>`)
    .join('');

  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="he">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Touch World Server Status</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
          text-align: center;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background: rgba(0,0,0,0.3);
          padding: 30px;
          border-radius: 15px;
          backdrop-filter: blur(10px);
        }
        h1 { font-size: 2.5em; margin-bottom: 20px; }
        .status { font-size: 1.5em; margin: 20px 0; }
        .players { text-align: right; margin-top: 20px; }
        ul { list-style: none; padding: 0; }
        li { 
          background: rgba(255,255,255,0.1); 
          margin: 5px 0; 
          padding: 10px; 
          border-radius: 5px; 
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>✅ Touch World Realtime Server</h1>
        <div class="status">
          <p>🟢 שחקנים פעילים: <strong>${players.size}</strong></p>
          <p>🔌 זמן שרת: ${new Date().toLocaleString('he-IL')}</p>
          <p>⚡ גרסה: 2.1</p>
        </div>
        ${players.size > 0 ? `
          <div class="players">
            <h3>👥 שחקנים במשחק:</h3>
            <ul>${playersList}</ul>
          </div>
        ` : '<p>אין שחקנים כרגע</p>'}
      </div>
    </body>
    </html>
  `);
});

// 🏥 Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    players: players.size,
    timestamp: Date.now()
  });
});

// 🚀 הפעלת השרת
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 Touch World Server is Running!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌐 Local: http://localhost:${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

// טיפול בשגיאות כלליות
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});
