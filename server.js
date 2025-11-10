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

// 🔒 Keys
const JWT_SECRET = process.env.JWT_SECRET || process.env.WSS_JWT_SECRET;
const BASE44_API = 'https://app.base44.com/api/apps/68e269394d8f2fa24e82cd71';
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;

if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET missing!');
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
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ error: 'No auth' });
        }

        const userToken = authHeader.replace('Bearer ', '');
        
        // Get player
        let player;
        try {
            const response = await fetch(`${BASE44_API}/entities/Player`, {
                headers: {
                    'Authorization': `Bearer ${userToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) throw new Error('Failed to fetch player');
            
            const players = await response.json();
            player = players && players.length > 0 ? players[0] : null;
        } catch (error) {
            return res.status(500).json({ error: 'Failed to fetch player' });
        }

        if (!player) {
            return res.status(404).json({ error: 'Player not found' });
        }

        // Generate JWT
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

        console.log(`✅ Token for: ${player.username}`);

        res.json({
            success: true,
            url: `${req.protocol}://${req.get('host')}`,
            token
        });

    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ error: 'Internal error', details: error.message });
    }
});

// ✅ Health
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server on ${PORT}`);
});

// ✅ WebSocket
const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling']
});

const players = new Map();

io.use((socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('No token'));

        const decoded = jwt.verify(token, JWT_SECRET);
        socket.playerId = decoded.playerId;
        socket.playerData = decoded;
        
        console.log(`✅ Auth: ${decoded.username}`);
        next();
    } catch (err) {
        console.error('❌ Auth fail:', err.message);
        next(new Error('Auth failed'));
    }
});

io.on('connection', (socket) => {
    const pd = socket.playerData;
    console.log(`✅ Connected: ${pd.username}`);

    players.set(socket.playerId, {
        ...pd,
        socketId: socket.id,
        position_x: pd.x,
        position_y: pd.y,
        is_moving: false
    });

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

    socket.on('change_area', (data) => {
        const player = players.get(socket.playerId);
        if (!player) return;

        player.current_area = data.newArea;
        socket.broadcast.emit('player_area_changed', {
            id: player.playerId,
            area_id: data.newArea
        });
    });

    socket.on('disconnect', () => {
        console.log(`👋 Disc: ${pd.username}`);
        players.delete(socket.playerId);
        io.emit('player_disconnected', socket.playerId);
    });
});

console.log('✅ Ready!');
