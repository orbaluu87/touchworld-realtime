const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// ⚡ Socket.IO מכויל למהירות: בלי דחיסת פריימים, CORS פתוח (תצמצם אח"כ)
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['websocket', 'polling'],
  pingInterval: 10000,
  pingTimeout: 5000,
  perMessageDeflate: false // אל תדחוס — פחות latency
});

// שחקנים חיים בזיכרון
const players = new Map();  // playerId -> playerData
const BROADCAST_MS = 50;    // 20Hz למיקומים (לא לצ'אט)

console.log('🚀 Touch World Realtime Server v2.2 (low-latency)');

io.on('connection', (socket) => {
  console.log('🟢 connected:', socket.id);
  let currentPlayerId = null;

  // ─────────────────────────────────────────────────────
  // תנועה/סטייט (נשאר בטיקים – לא משפיע על צ'אט)
  // ─────────────────────────────────────────────────────
  socket.on('move', (data = {}) => {
    try {
      const {
        playerId, x, y,
        direction, is_moving,
        username, admin_level, skin_code,
        equipped_hair, equipped_top, equipped_pants,
        equipped_hat, equipped_halo, equipped_necklace, equipped_accessories,
        is_invisible, animation_frame
      } = data;

      if (!playerId || !username || username === 'שחקן') return;

      if (!currentPlayerId) {
        currentPlayerId = playerId;
        console.log(`🎮 ${username} (${playerId}) joined`);
      }

      players.set(playerId, {
        id: playerId,
        socketId: socket.id,
        x: Math.round(Number(x) || 0),
        y: Math.round(Number(y) || 0),
        direction: direction || 'front',
        is_moving: !!is_moving,
        username,
        admin_level: admin_level || 'user',
        skin_code: skin_code || 'blue',
        equipped_hair: equipped_hair ?? null,
        equipped_top: equipped_top ?? null,
        equipped_pants: equipped_pants ?? null,
        equipped_hat: equipped_hat ?? null,
        equipped_halo: equipped_halo ?? null,
        equipped_necklace: equipped_necklace ?? null,
        equipped_accessories: Array.isArray(equipped_accessories) ? equipped_accessories : [],
        is_invisible: !!is_invisible,
        animation_frame: animation_frame || 'idle',
        lastUpdate: Date.now()
      });
    } catch (e) {
      console.error('❌ move error:', e);
    }
  });

  // ─────────────────────────────────────────────────────
  // צ'אט: נשלח מיידית (ללא דיליי, ללא תלות ב-tick)
  // שליחת ההודעה *גם לשולח* וגם לכל השאר, בלי השהייה
  // ─────────────────────────────────────────────────────
  socket.on('chat:send', (data = {}, ack) => {
    try {
      const { playerId, username, message } = data;
      if (!playerId || !username || !message || username === 'שחקן') {
        if (ack) ack({ ok: false, err: 'invalid' });
        return;
      }

      const payload = {
        type: 'chat',
        playerId,
        username,
        message: String(message).slice(0, 280),
        serverTs: Date.now()
      };

      // שליחה מיידית — ללא דחיסה כדי לקצר latency
      socket.compress(false).emit('chat:new', payload);       // לשולח
      socket.broadcast.compress(false).emit('chat:new', payload); // לכל האחרים

      if (ack) ack({ ok: true, serverTs: payload.serverTs });
      // לוג קצר בלבד
      // console.log(`💬 ${username}: ${message}`);
    } catch (e) {
      console.error('❌ chat:send error:', e);
      if (ack) ack({ ok: false, err: 'server', serverTs: Date.now() });
    }
  });

  // ─────────────────────────────────────────────────────
  // בועת טקסט: גם מיידי (אפשר לאחד עם chat אם תרצה)
  // ─────────────────────────────────────────────────────
  socket.on('bubble:show', (data = {}, ack) => {
    try {
      const { playerId, username, text, ttlMs = 3000 } = data;
      if (!playerId || !username || !text || username === 'שחקן') {
        if (ack) ack({ ok: false, err: 'invalid' });
        return;
      }

      const payload = {
        type: 'bubble',
        playerId,
        username,
        text: String(text).slice(0, 140),
        ttlMs: Math.min(Math.max(ttlMs, 800), 8000), // 0.8s–8s
        serverTs: Date.now()
      };

      socket.compress(false).emit('bubble:show', payload);
      socket.broadcast.compress(false).emit('bubble:show', payload);

      if (ack) ack({ ok: true, serverTs: payload.serverTs });
    } catch (e) {
      console.error('❌ bubble:show error:', e);
      if (ack) ack({ ok: false, err: 'server', serverTs: Date.now() });
    }
  });

  // ─────────────────────────────────────────────────────
  // החלפות (דוגמה — גם מיידי)
  // ─────────────────────────────────────────────────────
  socket.on('tradeRequest', (d = {}) => {
    try { io.compress(false).emit('tradeRequest', { ...d, serverTs: Date.now() }); }
    catch (e) { console.error('❌ tradeRequest:', e); }
  });

  socket.on('tradeUpdate', (d = {}) => {
    try { io.compress(false).emit('tradeUpdate', { ...d, serverTs: Date.now() }); }
    catch (e) { console.error('❌ tradeUpdate:', e); }
  });

  // ניתוק
  socket.on('disconnect', (reason) => {
    try {
      for (const [pid, pdata] of players.entries()) {
        if (pdata.socketId === socket.id) {
          players.delete(pid);
          io.compress(false).emit('remove', pid); // גם זה מיידי
          break;
        }
      }
    } catch (e) {
      console.error('❌ disconnect:', e);
    }
    // console.log('🔴 disconnected:', socket.id, reason);
  });

  socket.on('error', (e) => console.error('❌ socket error:', e));
});

// ─────────────────────────────────────────────────────
// עדכוני מיקום (snapshots) — כל 50ms, רק לזה (לא צ'אט)
// ─────────────────────────────────────────────────────
setInterval(() => {
  try {
    const now = Date.now();
    const list = [];

    // מנקים לא פעילים ושולחים רק שחקנים חוקיים
    for (const [id, p] of players.entries()) {
      if (now - p.lastUpdate > 10000) {
        players.delete(id);
        io.compress(false).emit('remove', id);
      } else if (p.username && p.username !== 'שחקן') {
        // מעט עיגול כדי להקטין נפח חבילה
        list.push({ id: p.id, x: p.x, y: p.y, direction: p.direction, is_moving: p.is_moving });
      }
    }

    if (list.length) io.emit('update', list);
  } catch (e) {
    console.error('❌ tick error:', e);
  }
}, BROADCAST_MS);

// סטטוס
app.get('/', (req, res) => res.send('✅ Touch World Realtime v2.2 (no-delay chat/bubble)'));
app.get('/health', (req, res) => res.json({ status: 'ok', players: players.size, ts: Date.now() }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('🚀 Server on', PORT));
