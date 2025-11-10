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

app.post('/api/getGameConnectionDetails', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'No auth' });

        const userToken = authHeader.replace('Bearer ', '');

        // Get user
        const userRes = await fetch(`${BASE44_API}/auth/me`, {
            headers: { 'Authorization': `Bearer ${userToken}` }
        });
        if (!userRes.ok) return res.status(401).json({ error: 'Invalid token' });
        const user = await userRes.json();

        // Get player with api_key
        const playerRes = await fetch(`${BASE44_API}/entities/Player?user_id=${user.id}`, {
            headers: { 'api_key': BASE44_SERVICE_KEY }
        });
        if (!playerRes.ok) return res.status(500).json({ error: 'DB error' });
        const players = await playerRes.json();
        const player = players?.[0];
        if (!player) return res.status(404).json({ error: 'No player' });

        // Create token
        const token = jwt.sign({
            playerId: player.id,
            userId: user.id,
            username: player.username || "Guest",
            admin_level: player.admin_level || "user",
            current_area: player.current_area || 'area1',
            x: player.position_x || 600,
            y: player.position_y || 400,
            skin_code: player.skin_code || "blue",
            equipment: {
                equipped_hair: player.equipped_hair,
                equipped_top: player.equipped_top,
                equipped_pants: player.equipped_pants,
                equipped_hat: player.equipped_hat,
                equipped_necklace: player.equipped_necklace,
                equipped_halo: player.equipped_halo,
                equipped_accessory: player.equipped_accessory?.split(',').filter(Boolean) || []
            }
        }, JWT_SECRET, { expiresIn: '1h' });

        console.log(`✅ Token for: ${player.username}`);
        res.json({ success: true, url: `${req.protocol}://${req.get('host')}`, token });
    } catch (err) {
        console.error('❌', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Port ${PORT}`);
    console.log(`🔐 JWT: ${!!JWT_SECRET}`);
    console.log(`🔑 KEY: ${!!BASE44_SERVICE_KEY}`);
});

const io = new Server(server, {
    cors: { origin: '*' },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000
});

const players = new Map();

io.use((socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('No token'));
        const decoded = jwt.verify(token, JWT_SECRET);
        socket.playerId = decoded.playerId;
        socket.playerData = decoded;
        next();
    } catch (err) {
        next(new Error('Auth failed'));
    }
});

io.on('connection', (socket) => {
    const pd = socket.playerData;
    console.log(`✅ ${pd.username}`);

    players.set(socket.playerId, { ...pd, socketId: socket.id, position_x: pd.x, position_y: pd.y });

    socket.emit('current_players', Array.from(players.values()).map(p => ({
        id: p.playerId, playerId: p.playerId, socketId: p.socketId,
        username: p.username, admin_level: p.admin_level,
        current_area: p.current_area, position_x: p.position_x, position_y: p.position_y,
        skin_code: p.skin_code, equipment: p.equipment
    })));

    socket.broadcast.emit('player_joined', {
        id: pd.playerId, playerId: pd.playerId, socketId: socket.id,
        username: pd.username, admin_level: pd.admin_level,
        current_area: pd.current_area, position_x: pd.x, position_y: pd.y,
        skin_code: pd.skin_code, equipment: pd.equipment
    });

    socket.on('move_to', (data) => {
        const p = players.get(socket.playerId);
        if (p) {
            p.position_x = data.x;
            p.position_y = data.y;
            io.emit('players_moved', [{ id: p.playerId, playerId: p.playerId, position_x: data.x, position_y: data.y, is_moving: true }]);
        }
    });

    socket.on('chat_message', (data) => {
        const p = players.get(socket.playerId);
        if (p) io.emit('chat_message', { id: p.playerId, playerId: p.playerId, username: p.username, admin_level: p.admin_level, message: data.message, timestamp: Date.now() });
    });

    socket.on('change_area', (data) => {
        const p = players.get(socket.playerId);
        if (p) {
            p.current_area = data.newArea;
            socket.broadcast.emit('player_area_changed', { id: p.playerId, area_id: data.newArea });
        }
    });

    socket.on('disconnect', () => {
        players.delete(socket.playerId);
        io.emit('player_disconnected', socket.playerId);
    });
});

console.log('✅ Ready!');
