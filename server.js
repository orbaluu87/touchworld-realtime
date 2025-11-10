// ============================================================================
// Touch World - Socket Server v10.3.1
// Multi-Player Game Server with JWT, Base44 Integration & Socket.IO
// ============================================================================

import express from 'express';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// ============================================================================
// 🔐 Environment Config
// ============================================================================
const JWT_SECRET = process.env.JWT_SECRET || process.env.WSS_JWT_SECRET;
const BASE44_API = 'https://app.base44.com/api';
const BASE44_APP_ID = '68e269394d8f2fa24e82cd71';
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;

// ============================================================================
// 🧩 Environment Checks
// ============================================================================
if (!JWT_SECRET) {
  console.error('❌ Missing JWT_SECRET');
  process.exit(1);
}

if (!BASE44_SERVICE_KEY) {
  console.error('❌ Missing BASE44_SERVICE_KEY');
  process.exit(1);
}

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

// ============================================================================
// 💬 Chat Bubble Configuration Endpoint
// ============================================================================
app.get('/api/getChatBubbleConfig', (req, res) => {
  res.json({
    bubble_duration_seconds: 7,
    default_username_color: '#FFFFFF',
    default_position: { x: 0, y: -45 },
    role_configs: [
      { role: "user", username_color: "#FFFFFF", bubble_color: "#FFFFFF", text_color: "#000000" },
      { role: "senior_touch", username_color: "#FFD700", bubble_color: "#FFF4E6", text_color: "#B8860B", role_icon_url: "https://img.icons8.com/emoji/48/crown-emoji.png" },
      { role: "admin", username_color: "#FF0000", bubble_color: "#FFE6E6", text_color: "#8B0000", role_icon_url: "https://img.icons8.com/emoji/48/fire.png" }
    ],
    shadow_settings: { x: 0, y: 0, scale: 100 }
  });
});

// ============================================================================
// 🎮 Game Connection (Base44 Auth → Player Token)
// ============================================================================
app.post('/api/getGameConnectionDetails', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing Authorization Header' });

    const userToken = authHeader.replace('Bearer ', '').trim();
    if (!userToken) return res.status(401).json({ error: 'Empty user token' });

    // 1️⃣ Get user from Base44
    const userRes = await fetch(`${BASE44_API}/auth/me`, {
      headers: { 'Authorization': `Bearer ${userToken}` },
    });

    if (!userRes.ok) {
      const msg = `Base44 /auth/me failed (${userRes.status})`;
      console.error('❌', msg);
      return res.status(401).json({ error: msg });
    }

    const user = await userRes.json();

    // 2️⃣ Get player record
    const playerRes = await fetch(
      `${BASE44_API}/apps/${BASE44_APP_ID}/entities/Player?user_id=${user.id}`,
      { headers: { 'api_key': BASE44_SERVICE_KEY } }
    );

    if (!playerRes.ok) {
      const msg = `Failed to fetch player (${playerRes.status})`;
      console.error('❌', msg);
      return res.status(500).json({ error: msg });
    }

    const players = await playerRes.json();
    const player = Array.isArray(players) ? players[0] : players;
    if (!player) {
      console.warn('⚠️ No player record found for user:', user.id);
      return res.status(404).json({ error: 'No player record found' });
    }

    // 3️⃣ Create signed token for Socket.IO
    const tokenPayload = {
      playerId: player.id,
      userId: user.id,
      username: player.username || "Guest",
      admin_level: player.admin_level || "user",
      current_area: player.current_area || 'area1',
      x: player.position_x || 600,
      y: player.position_y || 400,
      skin_code: player.skin_code || "blue",
      equipment: {
        equipped_hair: player.equipped_hair || null,
        equipped_top: player.equipped_top || null,
        equipped_pants: player.equipped_pants || null,
        equipped_hat: player.equipped_hat || null,
        equipped_necklace: player.equipped_necklace || null,
        equipped_halo: player.equipped_halo || null,
        equipped_accessory: player.equipped_accessory?.split(',').filter(Boolean) || []
      }
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1h' });

    console.log(`✅ Token created for: ${player.username}`);
    res.json({
      success: true,
      url: `${req.protocol}://${req.get('host')}`,
      token,
      player: { username: player.username, admin_level: player.admin_level, current_area: player.current_area }
    });

  } catch (err) {
    console.error('❌ Server Error in /getGameConnectionDetails:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// 🩺 Health Check
// ============================================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================================
// 🚀 Start Server
// ============================================================================
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔐 JWT Loaded: ${!!JWT_SECRET}`);
  console.log(`🔑 Base44 Key Loaded: ${!!BASE44_SERVICE_KEY}`);
});

// ============================================================================
// 🌐 Socket.IO Real-Time Layer
// ============================================================================
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000
});

const players = new Map();

// Middleware to verify JWT
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('No token provided'));

    const decoded = jwt.verify(token, JWT_SECRET);
    socket.playerId = decoded.playerId;
    socket.playerData = decoded;
    next();
  } catch (err) {
    console.error('❌ Socket Auth Error:', err.message);
    next(new Error('Authentication failed'));
  }
});

// Connection Events
io.on('connection', (socket) => {
  const pd = socket.playerData;
  console.log(`✅ Player connected: ${pd.username}`);

  // Save to map
  players.set(socket.playerId, { ...pd, socketId: socket.id, position_x: pd.x, position_y: pd.y });

  // Send current player list
  socket.emit('current_players', Array.from(players.values()).map(p => ({
    id: p.playerId,
    username: p.username,
    admin_level: p.admin_level,
    current_area: p.current_area,
    position_x: p.position_x,
    position_y: p.position_y,
    skin_code: p.skin_code,
    equipment: p.equipment
  })));

  // Notify others
  socket.broadcast.emit('player_joined', {
    id: pd.playerId,
    username: pd.username,
    admin_level: pd.admin_level,
    current_area: pd.current_area,
    position_x: pd.x,
    position_y: pd.y,
    skin_code: pd.skin_code,
    equipment: pd.equipment
  });

  // Movement
  socket.on('move_to', (data) => {
    const p = players.get(socket.playerId);
    if (p) {
      p.position_x = data.x;
      p.position_y = data.y;
      io.emit('players_moved', [{
        id: p.playerId,
        playerId: p.playerId,
        position_x: data.x,
        position_y: data.y,
        is_moving: true
      }]);
    }
  });

  // Chat
  socket.on('chat_message', (data) => {
    const p = players.get(socket.playerId);
    if (p && data.message?.trim()) {
      io.emit('chat_message', {
        id: p.playerId,
        username: p.username,
        admin_level: p.admin_level,
        message: data.message,
        timestamp: Date.now()
      });
    }
  });

  // Area change
  socket.on('change_area', (data) => {
    const p = players.get(socket.playerId);
    if (p && data.newArea) {
      p.current_area = data.newArea;
      socket.broadcast.emit('player_area_changed', { id: p.playerId, area_id: data.newArea });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    players.delete(socket.playerId);
    io.emit('player_disconnected', socket.playerId);
    console.log(`❎ Player disconnected: ${pd.username}`);
  });
});

console.log('✅ Touch World Server Ready!');
