import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
const httpServer = createServer(app);

const corsOptions = {
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST']
};

const io = new Server(httpServer, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

app.use(cors(corsOptions));
app.use(express.json());

// Game State
const players = new Map();
const trades = new Map();

// ============ HTTP ROUTES ============
app.get('/', (req, res) => {
    res.send('Touch World Server Running!');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        players: players.size,
        trades: trades.size,
        timestamp: new Date().toISOString()
    });
});

app.get('/stats', (req, res) => {
    const areaStats = {};
    for (const player of players.values()) {
        areaStats[player.areaId] = (areaStats[player.areaId] || 0) + 1;
    }
    res.json({
        totalPlayers: players.size,
        areaStats,
        activeTrades: trades.size
    });
});

// ============ SOCKET.IO EVENTS ============
io.on('connection', (socket) => {
    console.log('✅ New connection:', socket.id);

    // Player Join
    socket.on('join', (data) => {
        try {
            const { playerId, areaId, playerData } = data;
            if (!playerId || !areaId || !playerData) return;

            const newPlayer = {
                id: playerId,
                socketId: socket.id,
                areaId: areaId,
                x: playerData.position_x || 960,
                y: playerData.position_y || 540,
                direction: playerData.direction || 'front',
                username: playerData.username,
                admin_level: playerData.admin_level || 'user',
                skin_code: playerData.skin_code || 'blue',
                equipped_hair: playerData.equipped_hair,
                equipped_top: playerData.equipped_top,
                equipped_pants: playerData.equipped_pants,
                equipped_hat: playerData.equipped_hat,
                equipped_halo: playerData.equipped_halo,
                equipped_necklace: playerData.equipped_necklace,
                equipped_accessories: playerData.equipped_accessories || [],
                is_invisible: playerData.is_invisible || false,
                animation_frame: 'idle',
                is_moving: false,
                lastUpdate: Date.now()
            };

            players.set(playerId, newPlayer);
            socket.join(areaId);

            const playersInArea = Array.from(players.values())
                .filter(p => p.areaId === areaId && p.id !== playerId);
            
            socket.emit('currentPlayers', playersInArea);
            socket.to(areaId).emit('newPlayer', newPlayer);

            console.log('👤 Player joined:', playerData.username, 'Area:', areaId);
        } catch (error) {
            console.error('❌ Join error:', error);
        }
    });

    // Player Move
    socket.on('move', (data) => {
        try {
            const { playerId, x, y, direction, is_moving, animation_frame } = data;
            const player = players.get(playerId);

            if (player) {
                player.x = x;
                player.y = y;
                player.direction = direction;
                player.is_moving = is_moving;
                player.animation_frame = animation_frame;
                player.lastUpdate = Date.now();

                socket.to(player.areaId).emit('playerMoved', player);
            }
        } catch (error) {
            console.error('❌ Move error:', error);
        }
    });

    // Change Area
    socket.on('changeArea', (data) => {
        try {
            const { playerId, newAreaId } = data;
            const player = players.get(playerId);

            if (player) {
                const oldArea = player.areaId;
                socket.leave(oldArea);
                socket.join(newAreaId);
                player.areaId = newAreaId;
                player.lastUpdate = Date.now();

                socket.to(oldArea).emit('playerLeft', { playerId });
                socket.to(newAreaId).emit('playerJoined', player);

                const playersInNewArea = Array.from(players.values())
                    .filter(p => p.areaId === newAreaId && p.id !== playerId);
                
                socket.emit('currentPlayers', playersInNewArea);

                console.log('🚪 Player changed area:', player.username, oldArea, '→', newAreaId);
            }
        } catch (error) {
            console.error('❌ Change area error:', error);
        }
    });

    // Chat Message
    socket.on('bubbleMessage', (data) => {
        try {
            const { playerId, message, username, adminLevel } = data;
            const player = players.get(playerId);

            if (player) {
                const messageData = {
                    playerId,
                    message,
                    username,
                    adminLevel,
                    timestamp: Date.now()
                };

                io.to(player.areaId).emit('bubbleMessage', messageData);
                console.log('💬', username, ':', message);
            }
        } catch (error) {
            console.error('❌ Chat error:', error);
        }
    });

    // Trade Request
    socket.on('tradeRequest', (data) => {
        try {
            const { tradeId, initiator_id, receiver_id } = data;
            const receiver = players.get(receiver_id);
            const initiator = players.get(initiator_id);

            if (receiver?.socketId) {
                io.to(receiver.socketId).emit('tradeRequest', {
                    tradeId,
                    initiator_id,
                    receiver_id,
                    initiator_username: initiator?.username
                });
                console.log('🤝 Trade request:', initiator?.username, '→', receiver?.username);
            }
        } catch (error) {
            console.error('❌ Trade request error:', error);
        }
    });

    // Trade Update
    socket.on('tradeUpdate', (data) => {
        try {
            const { tradeId, status } = data;
            trades.set(tradeId, { ...data, updatedAt: Date.now() });

            const trade = trades.get(tradeId);
            if (trade && trade.initiator_id && trade.receiver_id) {
                const initiatorSocket = players.get(trade.initiator_id)?.socketId;
                const receiverSocket = players.get(trade.receiver_id)?.socketId;

                if (initiatorSocket) io.to(initiatorSocket).emit('tradeUpdate', trade);
                if (receiverSocket) io.to(receiverSocket).emit('tradeUpdate', trade);

                console.log('🔄 Trade update:', tradeId, status);
            }
        } catch (error) {
            console.error('❌ Trade update error:', error);
        }
    });

    // Ping/Pong
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // Disconnect
    socket.on('disconnect', (reason) => {
        console.log('❌ Disconnected:', socket.id, reason);

        for (const [playerId, player] of players.entries()) {
            if (player.socketId === socket.id) {
                socket.to(player.areaId).emit('playerLeft', { playerId });
                players.delete(playerId);
                console.log('👋 Player left:', player.username);
                break;
            }
        }
    });
});

// ============ CLEANUP TASKS ============
setInterval(() => {
    const now = Date.now();
    const timeout = 120000;

    for (const [playerId, player] of players.entries()) {
        if (now - player.lastUpdate > timeout) {
            console.log('🧹 Removing inactive player:', player.username);
            players.delete(playerId);
            io.to(player.areaId).emit('playerLeft', { playerId });
        }
    }
}, 60000);

// ============ START SERVER ============
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════╗
║  🎮 TOUCH WORLD SERVER ONLINE     ║
║  Port: ${PORT}                       ║
║  Status: ✅ RUNNING                ║
╚═══════════════════════════════════╝
    `);
});

export { io, app };
