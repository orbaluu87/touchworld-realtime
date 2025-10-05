const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

/**
 * Socket.IO – כיוון לביצועים:
 * - CORS פתוח (בשלב ראשון). אחרי שזה עובד, לצמצם ל-origins של Base44.
 * - לא לדחוס הודעות (perMessageDeflate=false + compress(false)) כדי לצמצם latency.
 * - לתת גם polling וגם websocket כדי שלא ייחסם בפריוויו.
 */
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
  pingInterval: 10000,
  pingTimeout: 5000,
  perMessageDeflate: false
});

// ======== State ========
const players = new Map(); // playerId -> {id, socketId, x,y, ... , lastUpdate}
const SOCKET_TO_PLAYER = new Map(); // socket.id -> playerId
const TICK_MS = 50; // 20 FPS

console.log('🚀 Touch World Realtime Server v2.3 (20FPS, instant chat/bubbles)');

io.on('connection', (socket) => {
  console.log('🟢 connected:', socket.id);

  // --- HELLO / SYNC: כשהקליינט מתחבר – שולח snapshot של כל השחקנים הקיימים ---
  socket.emit('presence:all', Array.from(players.values()).map(stripForPresence));

  // --- תנועת שחקן / עדכון סטייט ---
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

      // רישום שחקן חדש אם נדרש
      if (!players.has(playerId)) {
        players.set(playerId, {
          id: playerId,
          socketId: socket.id,
          x: 0, y: 0,
          direction: 'front',
          is_moving: false,
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
          lastUpdate: 0
        });

        // מיפוי שקע→שחקן
        SOCKET_TO_PLAYER.set(socket.id, playerId);

        // שדר מיד לכל השחקנים שיש מצטרף חדש (נוכחות)
        const joinPayload = stripForPresence(players.get(playerId));
        io.compress(false).emit('presence:join', joinPayload);
      }

      // עדכון מצב (עגול קל להקטין גודל חבילה)
      const p = players.get(playerId);
      p.x = Math.round(Number(x) || 0);
      p.y = Math.round(Number(y) || 0);
      p.direction = direction || 'front';
      p.is_moving = !!is_moving;
      p.username = username;
      p.admin_level = admin_level || p.admin_level;
      p.skin_code = skin_code || p.skin_code;
      p.equipped_hair = equipped_hair ?? p.equipped_hair;
      p.equipped_top = equipped_top ?? p.equipped_top;
      p.equipped_pants = equipped_pants ?? p.equipped_pants;
      p.equipped_hat = equipped_hat ?? p.equipped_hat;
      p.equipped_halo = equipped_halo ?? p.equipped_halo;
      p.equipped_necklace = equipped_necklace ?? p.equipped_necklace;
      p.equipped_accessories = Array.isArray(equipped_accessories) ? equipped_accessories : p.equipped_accessories;
      p.is_invisible = !!is_invisible;
      p.animation_frame = animation_frame || p.animation_frame;
      p.lastUpdate = Date.now();
    } catch (e) {
      console.error('❌ move error:', e);
    }
  });

  // --- צ'אט מיידי (ACK) ---
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
      // לשולח + לכל השאר – מיידי ובלי דחיסה
      socket.compress(false).emit('chat:new', payload);
      socket.broadcast.compress(false).emit('chat:new', payload);
      if (ack) ack({ ok: true, serverTs: payload.serverTs });
    } catch (e) {
      console.error('❌ chat:send error:', e);
      if (ack) ack({ ok: false, err: 'server' });
    }
  });

  // --- בועת טקסט מיידית (ACK) ---
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
        ttlMs: Math.min(Math.max(ttlMs, 800), 8000),
        serverTs: Date.now()
      };
      socket.compress(false).emit('bubble:show', payload);
      socket.broadcast.compress(false).emit('bubble:show', payload);
      if (ack) ack({ ok: true, serverTs: payload.serverTs });
    } catch (e) {
      console.error('❌ bubble:show error:', e);
      if (ack) ack({ ok: false, err: 'server' });
    }
  });

  // --- החלפות (דוגמאות) ---
  socket.on('tradeRequest', (d = {}) => {
    try { io.compress(false).emit('tradeRequest', { ...d, serverTs: Date.now() }); }
    catch (e) { console.error('❌ tradeRequest:', e); }
  });
  socket.on('tradeUpdate', (d = {}) => {
    try { io.compress(false).emit('tradeUpdate', { ...d, serverTs: Date.now() }); }
    catch (e) { console.error('❌ tradeUpdate:', e); }
  });

  // --- ניתוק ---
  socket.on('disconnect', (reason) => {
    try {
      const playerId = SOCKET_TO_PLAYER.get(socket.id);
      if (playerId && players.has(playerId)) {
        const username = players.get(playerId).username;
        players.delete(playerId);
        SOCKET_TO_PLAYER.delete(socket.id);
        // שדר מיד שיצא
        io.compress(false).emit('presence:leave', { playerId, username, serverTs: Date.now() });
        // ומחק דמות
        io.compress(false).emit('remove', playerId);
      }
    } catch (e) {
      console.error('❌ disconnect:', e);
    }
    // console.log('🔴 disconnected:', socket.id, reason);
  });

  socket.on('error', (e) => console.error('❌ socket error:', e));
});

// ======== Tick (20FPS) – עדכון מיקומים בלבד ========
setInterval(() => {
  try {
    const now = Date.now();
    const list = [];

    // נקה לא פעילים ושלח snapshot מרוכז
    for (const [id, p] of players.entries()) {
      if (now - p.lastUpdate > 10000) {
        players.delete(id);
        io.compress(false).emit('presence:leave', { playerId: id, username: p.username, serverTs: Date.now() });
        io.compress(false).emit('remove', id);
      } else if (p.username && p.username !== 'שחקן') {
        list.push({ id: p.id, x: p.x, y: p.y, direction: p.direction, is_moving: p.is_moving });
      }
    }

    if (list.length) io.emit('update', list);
  } catch (e) {
    console.error('❌ tick error:', e);
  }
}, TICK_MS);

// ======== Utils ========
function stripForPresence(p) {
  // מידע מספיק כדי לרנדר דמות ברגע ההצטרפות
  return {
    id: p.id, username: p.username,
    x: p.x, y: p.y, direction: p.direction, is_moving: p.is_moving,
    skin_code: p.skin_code,
    equipped_hair: p.equipped_hair,
    equipped_top: p.equipped_top,
    equipped_pants: p.equipped_pants,
    equipped_hat: p.equipped_hat,
    equipped_halo: p.equipped_halo,
    equipped_necklace: p.equipped_necklace,
    equipped_accessories: p.equipped_accessories || []
  };
}

// ======== HTTP ========
app.get('/', (_, res) => res.send('✅ Touch World v2.3 – 20FPS, instant chat & bubbles, presence sync'));
app.get('/health', (_, res) => res.json({ status: 'ok', players: players.size, ts: Date.now() }));

// ======== Start ========
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('🚀 Server on', PORT));
