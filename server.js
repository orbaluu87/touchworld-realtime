const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['websocket','polling'],
  pingInterval: 10000,
  pingTimeout: 5000,
  perMessageDeflate: false
});

const players = new Map();          // playerId -> playerData
const socketIndex = new Map();      // socketId  -> playerId (למציאת שחקן בניתוק)
const BROADCAST_MS = 50;            // 20Hz לסנכרון כללי

console.log('🚀 Touch World Realtime v2.3 (presence fix)');

io.on('connection', (socket) => {
  console.log('🟢 connected:', socket.id);

  // השחקן "נרשם" כשמגיעה תנועת move הראשונה שלו עם מזהה ושם
  socket.on('move', (data = {}) => {
    try {
      const {
        playerId, username, x, y,
        direction, is_moving,
        admin_level, skin_code,
        equipped_hair, equipped_top, equipped_pants,
        equipped_hat, equipped_halo, equipped_necklace, equipped_accessories,
        is_invisible, animation_frame
      } = data;

      if (!playerId || !username || username === 'שחקן') return;

      const isFirstTime = !players.has(playerId);
      const now = Date.now();

      const player = {
        id: playerId,
        socketId: socket.id,
        username,
        x: Math.round(Number(x) || 0),
        y: Math.round(Number(y) || 0),
        direction: direction || 'front',
        is_moving: !!is_moving,
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
        lastUpdate: now
      };

      players.set(playerId, player);
      socketIndex.set(socket.id, playerId);

      if (isFirstTime) {
        // 1) שלח לשחקן החדש את כל מי שכבר בעולם (חוץ ממנו)
        const snapshot = Array.from(players.values())
          .filter(p => p.id !== playerId && p.username && p.username !== 'שחקן')
          .map(p => ({ id: p.id, username: p.username, x: p.x, y: p.y, direction: p.direction, is_moving: p.is_moving }));
        socket.compress(false).emit('presence:snapshot', snapshot);

        // 2) שדר לשאר השחקנים שהשחקן החדש הצטרף
        const joinedPayload = { id: player.id, username: player.username, x: player.x, y: player.y, direction: player.direction, is_moving: player.is_moving };
        socket.broadcast.compress(false).emit('presence:join', joinedPayload);
      }

      // שדר מיידית את תנועת השחקן הזה כדי שיֵראו אותו עכשיו (ללא דיליי)
      socket.broadcast.compress(false).emit('update', [
        { id: player.id, x: player.x, y: player.y, direction: player.direction, is_moving: player.is_moving }
      ]);

    } catch (e) {
      console.error('❌ move error:', e);
    }
  });

  // צ'אט – מיידי
  socket.on('chat:send', (data = {}, ack) => {
    try {
      const { playerId, username, message } = data;
      if (!playerId || !username || !message || username === 'שחקן') return ack && ack({ ok:false, err:'invalid' });

      const payload = { type:'chat', playerId, username, message:String(message).slice(0,280), serverTs: Date.now() };
      socket.compress(false).emit('chat:new', payload);
      socket.broadcast.compress(false).emit('chat:new', payload);
      ack && ack({ ok:true, serverTs: payload.serverTs });
    } catch (e) {
      console.error('❌ chat error:', e);
      ack && ack({ ok:false, err:'server' });
    }
  });

  // בועת טקסט – מיידי
  socket.on('bubble:show', (data = {}, ack) => {
    try {
      const { playerId, username, text, ttlMs = 2500 } = data;
      if (!playerId || !username || !text || username === 'שחקן') return ack && ack({ ok:false, err:'invalid' });

      const payload = { type:'bubble', playerId, username, text:String(text).slice(0,140), ttlMs: Math.min(Math.max(ttlMs,800),8000), serverTs: Date.now() };
      socket.compress(false).emit('bubble:show', payload);
      socket.broadcast.compress(false).emit('bubble:show', payload);
      ack && ack({ ok:true, serverTs: payload.serverTs });
    } catch (e) {
      console.error('❌ bubble error:', e);
      ack && ack({ ok:false, err:'server' });
    }
  });

  // ניתוק – נקה ושדר לכולם
  socket.on('disconnect', (reason) => {
    try {
      const pid = socketIndex.get(socket.id);
      if (pid) {
        const p = players.get(pid);
        players.delete(pid);
        socketIndex.delete(socket.id);
        io.compress(false).emit('presence:leave', { id: pid });
        io.compress(false).emit('remove', pid); // לשמירת תאימות לקוד הישן
        // console.log(`👋 ${p?.username || pid} left (${reason})`);
      }
    } catch (e) {
      console.error('❌ disconnect error:', e);
    }
  });
});

// שידור סנכרון כללי כל 50ms (נוח לסגור פערים/ל late joiners)
setInterval(() => {
  try {
    const now = Date.now();
    const list = [];
    for (const p of players.values()) {
      if (now - p.lastUpdate > 10000) {
        players.delete(p.id);
        io.compress(false).emit('presence:leave', { id: p.id });
        io.compress(false).emit('remove', p.id);
      } else if (p.username && p.username !== 'שחקן') {
        list.push({ id: p.id, x: p.x, y: p.y, direction: p.direction, is_moving: p.is_moving });
      }
    }
    if (list.length) io.emit('update', list);
  } catch (e) {
    console.error('❌ tick error:', e);
  }
}, BROADCAST_MS);

// בריאות
app.get('/', (req, res) => res.send('✅ Touch World v2.3 (presence join/snapshot/leave fixed)'));
app.get('/health', (req, res) => res.json({ status:'ok', players: players.size, ts: Date.now() }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log('🚀 Server on', PORT));
