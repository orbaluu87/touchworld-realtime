import express from 'express';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 🔒 Security Keys
const JWT_SECRET = process.env.JWT_SECRET || process.env.WSS_JWT_SECRET;
const HEALTH_KEY = process.env.HEALTH_KEY || 'touchhealth123';

if (!JWT_SECRET) {
    console.error('❌ CRITICAL: JWT_SECRET not set!');
    process.exit(1);
}

// ✅ Middleware
app.use(helmet());
app.use(cors({
    origin: '*',
    credentials: true
}));
app.use(express.json());

// ✅ API: Get Chat Bubble Config
app.get('/api/getChatBubbleConfig', async (req, res) => {
    const defaultConfig = {
        bubble_duration_seconds: 7,
        default_username_color: '#FFFFFF',
        default_position: { x: 0, y: -45 },
        role_configs: [
            {
                role: "user",
                username_color: "#FFFFFF",
                role_icon_url: null,
                bubble_color: "#FFFFFF",
                text_color: "#000000",
                position: null
            },
            {
                role: "senior_touch",
                username_color: "#FFD700",
                role_icon_url: "https://img.icons8.com/emoji/48/crown-emoji.png",
                bubble_color: "#FFF4E6",
                text_color: "#B8860B",
                position: null
            },
            {
                role: "admin",
                username_color: "#FF0000",
                role_icon_url: "https://img.icons8.com/emoji/48/fire.png",
                bubble_color: "#FFE6E6",
                text_color: "#8B0000",
                position: null
            }
        ],
        shadow_settings: { x: 0, y: 0, scale: 100 },
        shadow_image_url: null
    };

    res.json(defaultConfig);
});

// ✅ Health Check
app.get('/health', (req, res) => {
    const key = req.query.key;
    if (key !== HEALTH_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ✅ Create HTTP Server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔐 JWT_SECRET: ${JWT_SECRET ? '✅ Set' : '❌ Missing'}`);
});

// ✅ Socket.IO Server
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
});

// Game State
const players = new Map();

// ✅ Socket Authentication
io.use((socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('No token provided'));
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        socket.userId = decoded.userId;
        socket.playerId = decoded.playerId;
        socket.playerData = decoded;
        
        console.log(`🔐 Authenticated: ${decoded.username} (${decoded.playerId})`);
        next();
    } catch (error) {
        console.error('❌ Auth failed:', error.message);
        next(new Error('Authentication failed'));
    }
});

// ✅ Socket Connection
io.on('connection', (socket) => {
    const playerData = socket.playerData;
    
    console.log(`✅ Player connected: ${playerData.username} (${socket.id})`);

    // Initialize player state
    players.set(socket.playerId, {
        ...playerData,
        socketId: socket.id,
        position_x: playerData.x,
        position_y: playerData.y,
        is_moving: false,
        direction: 's',
        animation_frame: 'idle'
    });

    // Send current players
    const currentPlayers = Array.from(players.values()).map(p => ({
        id: p.playerId,
        playerId: p.playerId,
        socketId: p.socketId,
        username: p.username,
        admin_level: p.admin_level,
        current_area: p.current_area,
        position_x: p.position_x,
        position_y: p.position_y,
        direction: p.direction,
        is_moving: p.is_moving,
        animation_frame: p.animation_frame,
        skin_code: p.skin_code,
        equipment: p.equipment
    }));

    socket.emit('current_players', currentPlayers);

    // Notify others
    socket.broadcast.emit('player_joined', {
        id: playerData.playerId,
        playerId: playerData.playerId,
        socketId: socket.id,
        username: playerData.username,
        admin_level: playerData.admin_level,
        current_area: playerData.current_area,
        position_x: playerData.x,
        position_y: playerData.y,
        skin_code: playerData.skin_code,
        equipment: playerData.equipment
    });

    // Handle movement
    socket.on('move_to', (data) => {
        const player = players.get(socket.playerId);
        if (!player) return;

        player.position_x = data.x;
        player.position_y = data.y;
        player.is_moving = true;

        io.emit('players_moved', [{
            id: player.playerId,
            playerId: player.playerId,
            socketId: socket.id,
            position_x: data.x,
            position_y: data.y,
            is_moving: true
        }]);
    });

    // Handle chat
    socket.on('chat_message', (data) => {
        const player = players.get(socket.playerId);
        if (!player) return;

        io.emit('chat_message', {
            id: player.playerId,
            playerId: player.playerId,
            username: player.username,
            admin_level: player.admin_level,
            message: data.message,
            timestamp: Date.now()
        });
    });

    // Handle area change
    socket.on('area_change', (data) => {
        const player = players.get(socket.playerId);
        if (!player) return;

        player.current_area = data.area_id;

        socket.broadcast.emit('player_area_changed', {
            id: player.playerId,
            playerId: player.playerId,
            area_id: data.area_id
        });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`👋 Player disconnected: ${playerData.username}`);
        players.delete(socket.playerId);
        
        io.emit('player_disconnected', socket.playerId);
    });
});

console.log('✅ Touch World Server initialized!');
