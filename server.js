import express from 'express';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || process.env.WSS_JWT_SECRET;

if (!JWT_SECRET) {
    console.error('❌ JWT_SECRET missing!');
    process.exit(1);
}

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on ${PORT}`);
});

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
        
        console.log(`✅ Auth OK: ${decoded.username}`);
        next();
    } catch (err) {
        console.error('❌ Auth failed:', err.message);
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
        console.log(`👋 Disconnected: ${pd.username}`);
        players.delete(socket.playerId);
        io.emit('player_disconnected', socket.playerId);
    });
});

console.log('✅ Ready!');
