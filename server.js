const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let players = new Map();

wss.on('connection', (ws) => {
  const playerId = Math.random().toString(36).substring(7);
  console.log('🟢 שחקן התחבר:', playerId);
  
  players.set(playerId, { 
    id: playerId, 
    x: 100, 
    y: 100,
    ws: ws
  });

  // שליחת ID לשחקן
  ws.send(JSON.stringify({ type: 'init', playerId }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'move') {
        const player = players.get(playerId);
        if (player) {
          player.x = data.x;
          player.y = data.y;
          player.direction = data.direction;
          player.is_moving = data.is_moving;
          player.username = data.username;
          player.admin_level = data.admin_level;
          player.skin_code = data.skin_code;
          player.equipped_hair = data.equipped_hair;
          player.equipped_top = data.equipped_top;
          player.equipped_pants = data.equipped_pants;
          player.equipped_hat = data.equipped_hat;
          player.equipped_halo = data.equipped_halo;
          player.equipped_necklace = data.equipped_necklace;
          player.equipped_accessories = data.equipped_accessories;
          player.is_invisible = data.is_invisible;
          player.animation_frame = data.animation_frame;
        }
      } else if (data.type === 'bubbleMessage') {
        // שידור הודעת צ'אט לכולם
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'bubbleMessage',
              ...data
            }));
          }
        });
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔴 שחקן התנתק:', playerId);
    players.delete(playerId);
    
    // שידור להסרת שחקן
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'remove', playerId }));
      }
    });
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// שליחת עדכונים כל 50ms
setInterval(() => {
  const playersArray = Array.from(players.values()).map(p => ({
    id: p.id,
    x: p.x,
    y: p.y,
    direction: p.direction,
    is_moving: p.is_moving,
    username: p.username,
    admin_level: p.admin_level,
    skin_code: p.skin_code,
    equipped_hair: p.equipped_hair,
    equipped_top: p.equipped_top,
    equipped_pants: p.equipped_pants,
    equipped_hat: p.equipped_hat,
    equipped_halo: p.equipped_halo,
    equipped_necklace: p.equipped_necklace,
    equipped_accessories: p.equipped_accessories,
    is_invisible: p.is_invisible,
    animation_frame: p.animation_frame
  }));
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'update', players: playersArray }));
    }
  });
}, 50);

app.get('/', (req, res) => res.send('✅ Touch World Realtime Server Running!'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
