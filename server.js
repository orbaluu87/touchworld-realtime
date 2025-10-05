const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

let players = new Map();

io.on('connection', (socket) => {
  console.log('🟢 שחקן התחבר:', socket.id);
  players.set(socket.id, { id: socket.id, x: 100, y: 100 });

  socket.on('move', ({ x, y }) => {
    const player = players.get(socket.id);
    if (player) {
      player.x = x;
      player.y = y;
    }
  });

  socket.on('disconnect', () => {
    console.log('🔴 שחקן התנתק:', socket.id);
    players.delete(socket.id);
    io.emit('remove', socket.id);
  });
});

setInterval(() => {
  io.emit('update', Array.from(players.values()));
}, 50);

app.get('/', (req, res) => res.send('✅ Touch World Realtime Server v2 Running with HTTPS support!'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running securely on port ${PORT}`);
});
