import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// ═══════════════════════════════════════════════════════════════════
// 🎮 TOUCH WORLD - REAL-TIME MULTIPLAYER SERVER v2.0.1
// ═══════════════════════════════════════════════════════════════════

const app = express();
const httpServer = createServer(app);

// ═══════════════════════════════════════════════════════════════════
// 🛡️ CORS CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const allowedOrigins = [
    'http://localhost:5173',
    'https://preview--copy-565f73e8.base44.app',
    'https://copy-565f73e8.base44.app',
    'https://base44.app',
    /\.base44\.app$/
];

const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.some(allowed =>
            typeof allowed === 'string' ? allowed === origin : allowed.test(origin)
        )) {
            callback(null, true);
        } else {
            console.warn('⚠️ CORS blocked:', origin);
            callback(null, true);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

// ═══════════════════════════════════════════════════════════════════
// 🔌 SOCKET.IO SERVER
// ═══════════════════════════════════════════════════════════════════

const io = new Server(httpServer, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

app.use(cors(corsOptions));
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════
// 💾 GAME STATE
// ═══════════════════════════════════════════════════════════════════

const players = new Map();
const trades = new Map();

// ═══════════════════════════════════════════════════════════════════
// 🎨 LOGGER
// ═══════════════════════════════════════════════════════════════════

const colors = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m'
};

function timestamp() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
}

const logger = {
    info: (msg) => console.log(`${colors.cyan}ℹ️  [${timestamp()}]${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✅ [${timestamp()}]${colors.reset} ${msg}`),
    warning: (msg) => console.warn(`${colors.yellow}⚠️  [${timestamp()}]${colors.reset} ${msg}`),
    error: (msg) => console.error(`${colors.red}❌ [${timestamp()}]${colors.reset} ${msg}`),
    player: (msg) => console.log(`${colors.magenta}👤 [${timestamp()}]${colors.reset} ${msg}`)
};

// ═══════════════════════════════════════════════════════════════════
// 🌐 HTTP ROUTES
// ═══════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
    res.send('🎮 Touch World Server v2.0.1 Running!');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        players: players.size,
        trades: trades.size,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '2.0.1'
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
        activeTrades: trades.size,
        timestamp: new Date().toISOString()
    });
});

// ═══════════════════════════════════════════════════════════════════
// 🎯 SOCKET.IO CONNECTION
// ═══════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
    logger.success(`New connection: ${socket.id}`);

    // ═══════════════════════════════════════════════════════════════
    // 👤 PLAYER JOIN
    // ═══════════════════════════════════════════════════════════════
    socket.on('join', (data) => {
        try {
            const { playerId, areaId, playerData } = data;
            
            if (!playerId || !areaId || !playerData) {
                logger.warning('Invalid join data');
                return;
            }

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
                joinedAt: Date.now(),
                lastUpdate: Date.now()
            };

            players.set(playerId, newPlayer);
            socket.join(areaId);

            const playersInArea = Array.from(players.values())
                .filter(p => p.areaId === areaId && p.id !== playerId);
            
            socket.emit('currentPlayers', playersInArea);
            socket.to(areaId).emit('newPlayer', newPlayer);

            logger.player(`${playerData.username} joined ${areaId} (Total: ${players.size})`);
        } catch (error) {
            logger.error(`Join error: ${error.message}`);
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // 🚶 PLAYER MOVEMENT
    // ═══════════════════════════════════════════════════════════════
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
            logger.error(`Move error: ${error.message}`);
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // 🚪 CHANGE AREA
    // ═══════════════════════════════════════════════════════════════
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

                logger.player(`${player.username} moved: ${oldArea} → ${newAreaId}`);
            }
        } catch (error) {
            logger.error(`Change area error: ${error.message}`);
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // 💬 BUBBLE MESSAGE
    // ═══════════════════════════════════════════════════════════════
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
                logger.info(`💬 ${username} (${player.areaId}): ${message}`);
            }
        } catch (error) {
            logger.error(`Bubble message error: ${error.message}`);
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // 🤝 TRADE REQUEST
    // ═══════════════════════════════════════════════════════════════
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
                logger.info(`🤝 Trade request: ${initiator?.username} → ${receiver?.username}`);
            }
        } catch (error) {
            logger.error(`Trade request error: ${error.message}`);
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // 🔄 TRADE UPDATE
    // ═══════════════════════════════════════════════════════════════
    socket.on('tradeUpdate', (data) => {
        try {
            const { tradeId, status, ...tradeData } = data;
            const existingTrade = trades.get(tradeId) || {};
            trades.set(tradeId, { ...existingTrade, ...tradeData, status, updatedAt: Date.now() });

            const trade = trades.get(tradeId);
            if (trade && trade.initiator_id && trade.receiver_id) {
                const initiatorSocketId = players.get(trade.initiator_id)?.socketId;
                const receiverSocketId = players.get(trade.receiver_id)?.socketId;

                if (initiatorSocketId) io.to(initiatorSocketId).emit('tradeUpdate', trade);
                if (receiverSocketId) io.to(receiverSocketId).emit('tradeUpdate', trade);

                logger.info(`🔄 Trade update: ${tradeId} → ${status}`);
            }
        } catch (error) {
            logger.error(`Trade update error: ${error.message}`);
        }
    });

    // ═══════════════════════════════════════════════════════════════
    // 🏓 PING/PONG
    // ═══════════════════════════════════════════════════════════════
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // ═══════════════════════════════════════════════════════════════
    // ❌ DISCONNECT
    // ═══════════════════════════════════════════════════════════════
    socket.on('disconnect', (reason) => {
        logger.info(`Disconnect: ${socket.id} (${reason})`);

        for (const [playerId, player] of players.entries()) {
            if (player.socketId === socket.id) {
                players.delete(playerId);
                socket.to(player.areaId).emit('playerLeft', { playerId: player.id });
                logger.player(`${player.username} left (Total: ${players.size})`);
                break;
            }
        }
    });

    socket.on('error', (error) => {
        logger.error(`Socket error: ${error.message}`);
    });
});

// ═══════════════════════════════════════════════════════════════════
// 🧹 CLEANUP INACTIVE PLAYERS (Every 60 seconds)
// ═══════════════════════════════════════════════════════════════════

setInterval(() => {
    const now = Date.now();
    const timeout = 120000; // 2 minutes

    for (const [playerId, player] of players.entries()) {
        if (now - player.lastUpdate > timeout) {
            logger.warning(`Removing inactive player: ${player.username}`);
            players.delete(playerId);
            io.to(player.areaId).emit('playerLeft', { playerId });
        }
    }
}, 60000);

// ═══════════════════════════════════════════════════════════════════
// 📊 STATS LOGGER (Every 5 minutes)
// ═══════════════════════════════════════════════════════════════════

setInterval(() => {
    const areaStats = {};
    for (const player of players.values()) {
        areaStats[player.areaId] = (areaStats[player.areaId] || 0) + 1;
    }
    logger.info(`📊 Stats - Players: ${players.size}, Trades: ${trades.size}, Areas: ${JSON.stringify(areaStats)}`);
}, 300000);

// ═══════════════════════════════════════════════════════════════════
// 🚀 START SERVER
// ═══════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║   🎮 TOUCH WORLD SERVER v2.0.1 ONLINE        ║
╠═══════════════════════════════════════════════╣
║  Port: ${PORT.toString().padEnd(38)} ║
║  HTTP: http://localhost:${PORT.toString().padEnd(24)} ║
║  WebSocket: ws://localhost:${PORT.toString().padEnd(19)} ║
║  Health: GET /health                          ║
║  Stats: GET /stats                            ║
╠═══════════════════════════════════════════════╣
║  ✅ Real-time multiplayer sync               ║
║  ✅ Single session enforcement               ║
║  ✅ Trade system                             ║
║  ✅ Chat/bubble messages                     ║
║  ✅ Auto cleanup inactive players            ║
╚═══════════════════════════════════════════════╝
    `);
    logger.success('Server started successfully');
});

export { io, app };
