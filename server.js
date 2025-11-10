import express from 'express';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

// 🔒 Keys
const JWT_SECRET = process.env.JWT_SECRET || process.env.WSS_JWT_SECRET;
const BASE44_API = 'https://app.base44.com/api/apps/68e269394d8f2fa24e82cd71';
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;

if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET missing!');
    process.exit(1);
}

if (!BASE44_SERVICE_KEY) {
    console.error('❌ BASE44_SERVICE_KEY missing!');
    process.exit(1);
}

app.use(helmet());
app.use(cors({ origin: '*' }));
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

// ✅ API: Get Game Connection Details + Generate Token
app.post('/api/getGameConnectionDetails', async (req, res) => {
    try {
        const { playerId, userId } = req.body;

        console.log('📥 Connection request:', { playerId, userId });

        if (!playerId || !userId) {
            console.error('❌ Missing data');
            return res.status(400).json({ 
                error: 'Missing data',
                details: 'playerId and userId required'
            });
        }

        // ✅ שליפת השחקן מ-Base44 עם SERVICE_KEY
        let player;
        try {
            console.log('🔍 Fetching player from Base44...');
            
            const response = await fetch(`${BASE44_API}/entities/Player/${playerId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${BASE44_SERVICE_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('📡 Base44 response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Base44 API error:', response.status, errorText);
                throw new Error(`Base44 API returned ${response.status}`);
            }
            
            player = await response.json();
            console.log('✅ Player fetched:', player.username);
            
            if (!player || player.user_id !== userId) {
                console.error('❌ Player verification failed');
                return res.status(403).json({ 
                    error: 'Forbidden',
                    details: 'Player verification failed'
                });
            }
        } catch (error) {
            console.error('❌ Database error:', error.message);
            return res.status(500).json({ 
                error: 'Database error',
                details: error.message
            });
        }

        // ✅ יצירת JWT Token
        const payload = {
            jti: Math.random().toString(36).substring(2, 15),
            iat: Math.floor(Date.now() / 1000),
            playerId: player.id,
            userId: player.user_id,
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
                equipped_accessory: player.equipped_accessory ? player.equipped_accessory.split(',').filter(Boolean) : [],
            }
        };

        const token = jwt.sign(payload, JWT_SECRET, { 
            expiresIn: '1h',
            algorithm: 'HS256'
        });

        console.log(`✅ Token generated for: ${player.username}`);

        res.json({
            success: true,
            url: `${req.protocol}://${req.get('host')}`,
            token
        });

    } catch (error) {
        console.error('❌ Unexpected error:', error);
        res.status(500).json({ 
            error: 'Internal error',
            details: error.message
        });
    }
});

// ✅ Health Check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        env: {
            jwt_secret: !!JWT_SECRET,
            service_key: !!BASE44_SERVICE_KEY,
            port: PORT
        }
    });
});

// ✅ Start Server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🔐 JWT_SECRET: ${JWT_SECRET ? '✅ Set' : '❌ Missing'}`);
    console.log(`🔑 BASE44_SERVICE_KEY: ${BASE44_SERVICE_KEY ? '✅ Set' : '❌ Missing'}`);
});

// ✅ Socket.IO
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

const players = new Map();

// ✅ Socket Authentication
io.use((socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) {
            console.error('❌ No token in handshake');
            return next(new Error('No token'));
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        socket.playerId = decoded.playerId;
        socket.playerData = decoded;
        
        console.log(`✅ Authenticated: ${decoded.username} (${decoded.playerId})`);
        next();
    } catch (err) {
        console.error('❌ Auth failed:', err.message);
        next(new Error('Auth failed'));
    }
});

// ✅ Socket Connection
io.on('connection', (socket) => {
    const pd = socket.playerData;
    console.log(`✅ Player connected: ${pd.username} (${socket.id})`);

    players.set(socket.playerId, {
        ...pd,
        socketId: socket.id,
        position_x: pd.x,
        position_y: pd.y,
        is_moving: false,
        direction: 's'
    });

    // Send current players
    socket.emit('current_players', Array.from(players.values()).map(p => ({
        id: p.playerId,
        playerId: p.playerId,
        socketId: p.socketId,
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
        playerId: pd.playerId,
        socketId: socket.id,
        username: pd.username,
        admin_level: pd.admin_level,
        current_area: pd.current_area,
        position_x: pd.x,
        position_y: pd.y,
        skin_code: pd.skin_code,
        equipment: pd.equipment
    });

    // Handle movement
    socket.on('move_to', (data) => {
        const player = players.get(socket.playerId);
        if (!player) return;

        player.position_x = data.x;
        player.position_y = data.y;

        io.emit('players_moved', [{
            id: player.playerId,
            playerId: player.playerId,
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
    socket.on('change_area', (data) => {
        const player = players.get(socket.playerId);
        if (!player) return;

        player.current_area = data.newArea;
        socket.broadcast.emit('player_area_changed', {
            id: player.playerId,
            area_id: data.newArea
        });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`👋 Player disconnected: ${pd.username}`);
        players.delete(socket.playerId);
        io.emit('player_disconnected', socket.playerId);
    });
});

console.log('✅ Touch World Server Ready!');
