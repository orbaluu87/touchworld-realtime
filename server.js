// 🎮 Touch World - Real-time Game Server
// Version 2.0.0

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// ═══════════════════════════════════════
// 🎨 LOGGER UTILITIES
// ═══════════════════════════════════════

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

function timestamp() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
}

const logger = {
    info: (msg, data) => console.log(`${colors.cyan}ℹ️  [${timestamp()}] [INFO]${colors.reset} ${msg}`, data || ''),
    success: (msg, data) => console.log(`${colors.green}✅ [${timestamp()}] [SUCCESS]${colors.reset} ${msg}`, data || ''),
    warning: (msg, data) => console.warn(`${colors.yellow}⚠️  [${timestamp()}] [WARN]${colors.reset} ${msg}`, data || ''),
    error: (msg, err) => console.error(`${colors.red}❌ [${timestamp()}] [ERROR]${colors.reset} ${msg}`, err || ''),
    player: (action, data) => console.log(`${colors.magenta}👤 [${timestamp()}] [PLAYER]${colors.reset} ${action}`, data || ''),
    chat: (user, msg, area) => console.log(`${colors.cyan}💬 [${timestamp()}] [CHAT]${colors.reset} ${colors.bright}${user}${colors.reset} (${area}): ${msg}`),
    trade: (action, data) => console.log(`${colors.yellow}🤝 [${timestamp()}] [TRADE]${colors.reset} ${action}`, data || ''),
    connection: (action, data) => console.log(`${colors.green}🔌 [${timestamp()}] [CONNECT]${colors.reset} ${action}`, data || ''),
};

// ═══════════════════════════════════════
// 📊 GAME STATE
// ═══════════════════════════════════════

const gameState = {
    players: new Map(),
    trades: new Map()
};

// ═══════════════════════════════════════
// 🔧 EXPRESS & SOCKET.IO SETUP
// ═══════════════════════════════════════

const app = express();
const httpServer = createServer(app);

// CORS Configuration
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
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
            logger.warning('CORS blocked:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

const io = new Server(httpServer, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

app.use(cors(corsOptions));
app.use(express.json());

// Security Headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// ═══════════════════════════════════════
// 🛣️ HTTP ROUTES
// ═══════════════════════════════════════

app.get('/', (req, res) => {
    res.status(200).send('🎮 Touch World Server Running!\n');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        players: gameState.players.size,
        trades: gameState.trades.size,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/stats', (req, res) => {
    const areaStats = {};
    for (const player of gameState.players.values()) {
        areaStats[player.areaId] = (areaStats[player.areaId] || 0) + 1;
    }
    res.json({
        totalPlayers: gameState.players.size,
        areaStats,
        activeTrades: gameState.trades.size,
        timestamp: new Date().toISOString()
    });
});

// ═══════════════════════════════════════
// 🔌 SOCKET.IO EVENT HANDLERS
// ═══════════════════════════════════════

io.on('connection', (socket) => {
    logger.connection('NEW CONNECTION', { socketId: socket.id, total: io.engine.clientsCount });

    // 👤 Player Join
    socket.on('join', (data) => {
        const { playerId, areaId, playerData } = data;

        if (!playerId || !areaId || !playerData) {
            logger.warning('Invalid join data', data);
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
        
        gameState.players.set(playerId, newPlayer);
        socket.join(areaId);

        const playersInArea = Array.from(gameState.players.values())
            .filter(p => p.areaId === areaId && p.id !== playerId);
        
        socket.emit('currentPlayers', playersInArea);
        socket.to(areaId).emit('newPlayer', newPlayer);

        logger.player('JOINED', { user: playerData.username, area: areaId, total: gameState.players.size });
    });

    // 🚀 Player Movement
    socket.on('move', (data) => {
        const { playerId, x, y, direction, is_moving, animation_frame } = data;
        const player = gameState.players.get(playerId);

        if (player) {
            player.x = x;
            player.y = y;
            player.direction = direction;
            player.is_moving = is_moving;
            player.animation_frame = animation_frame;
            player.lastUpdate = Date.now();

            socket.to(player.areaId).emit('playerMoved', {
                id: playerId,
                x,
                y,
                direction,
                is_moving,
                animation_frame
            });
        }
    });

    // 🚪 Change Area
    socket.on('changeArea', (data) => {
        const { playerId, newAreaId } = data;
        const player = gameState.players.get(playerId);

        if (player) {
            const oldArea = player.areaId;
            socket.leave(oldArea);
            socket.join(newAreaId);
            player.areaId = newAreaId;
            player.lastUpdate = Date.now();

            socket.to(oldArea).emit('playerLeft', { playerId });
            socket.to(newAreaId).emit('playerJoined', player);

            const playersInNewArea = Array.from(gameState.players.values())
                .filter(p => p.areaId === newAreaId && p.id !== playerId);
            
            socket.emit('currentPlayers', playersInNewArea);

            logger.player('AREA CHANGE', { user: player.username, from: oldArea, to: newAreaId });
        }
    });

    // 💬 Chat Bubble
    socket.on('bubbleMessage', (data) => {
        const { playerId, message, username, adminLevel } = data;
        const player = gameState.players.get(playerId);

        if (player && message && message.length <= 150) {
            const messageData = {
                playerId,
                message,
                username,
                adminLevel,
                timestamp: Date.now()
            };

            io.to(player.areaId).emit('bubbleMessage', messageData);
            logger.chat(username, message, player.areaId);
        }
    });

    // 🤝 Trade Request
    socket.on('tradeRequest', (data) => {
        const { tradeId, initiator_id, receiver_id } = data;
        const receiver = gameState.players.get(receiver_id);
        const initiator = gameState.players.get(initiator_id);

        if (receiver?.socketId) {
            io.to(receiver.socketId).emit('tradeRequest', { 
                tradeId, 
                initiator_id, 
                receiver_id, 
                initiator_username: initiator?.username 
            });
            logger.trade('REQUEST', { from: initiator?.username, to: receiver?.username, id: tradeId });
        }
    });

    // 🔄 Trade Update
    socket.on('tradeUpdate', (data) => {
        const { tradeId, status, ...tradeData } = data;
        const existingTrade = gameState.trades.get(tradeId) || {};
        gameState.trades.set(tradeId, { ...existingTrade, ...tradeData, status, updatedAt: Date.now() });

        const trade = gameState.trades.get(tradeId);
        if (trade && trade.initiator_id && trade.receiver_id) {
            const initiatorSocketId = gameState.players.get(trade.initiator_id)?.socketId;
            const receiverSocketId = gameState.players.get(trade.receiver_id)?.socketId;

            if (initiatorSocketId) io.to(initiatorSocketId).emit('tradeUpdate', trade);
            if (receiverSocketId) io.to(receiverSocketId).emit('tradeUpdate', trade);

            logger.trade('UPDATE', { id: tradeId, status });
        }
    });

    // ✅ Trade Complete
    socket.on('tradeComplete', (data) => {
        const { tradeId } = data;
        const trade = gameState.trades.get(tradeId);
        
        if (trade) {
            const initiatorSocketId = gameState.players.get(trade.initiator_id)?.socketId;
            const receiverSocketId = gameState.players.get(trade.receiver_id)?.socketId;

            if (initiatorSocketId) io.to(initiatorSocketId).emit('tradeComplete', { tradeId, status: 'completed' });
            if (receiverSocketId) io.to(receiverSocketId).emit('tradeComplete', { tradeId, status: 'completed' });

            gameState.trades.delete(tradeId);
            logger.trade('COMPLETED', { id: tradeId });
        }
    });

    // ❌ Trade Cancel
    socket.on('tradeCancel', (data) => {
        const { tradeId } = data;
        const trade = gameState.trades.get(tradeId);
        
        if (trade) {
            const initiatorSocketId = gameState.players.get(trade.initiator_id)?.socketId;
            const receiverSocketId = gameState.players.get(trade.receiver_id)?.socketId;

            if (initiatorSocketId) io.to(initiatorSocketId).emit('tradeCancel', { tradeId, status: 'cancelled' });
            if (receiverSocketId) io.to(receiverSocketId).emit('tradeCancel', { tradeId, status: 'cancelled' });

            gameState.trades.delete(tradeId);
            logger.trade('CANCELLED', { id: tradeId });
        }
    });

    // 🧹 Ping/Pong
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // ❌ Disconnect
    socket.on('disconnect', (reason) => {
        logger.connection('DISCONNECT', { socketId: socket.id, reason });

        let disconnectedPlayer = null;
        for (const [playerId, player] of gameState.players.entries()) {
            if (player.socketId === socket.id) {
                disconnectedPlayer = player;
                gameState.players.delete(playerId);
                socket.to(player.areaId).emit('playerLeft', { playerId: player.id });
                logger.player('REMOVED', { user: player.username, area: player.areaId });
                break;
            }
        }

        if (disconnectedPlayer) {
            const duration = Math.round((Date.now() - disconnectedPlayer.joinedAt) / 1000);
            logger.connection('DISCONNECTED PLAYER', {
                user: disconnectedPlayer.username,
                reason,
                duration: `${duration}s`,
                remaining: gameState.players.size
            });
        }
    });

    socket.on('error', (error) => {
        logger.error(`Socket error for ${socket.id}:`, error);
    });
});

// ═══════════════════════════════════════
// 🧹 CLEANUP & STATS INTERVALS
// ═══════════════════════════════════════

// Cleanup inactive players every 60 seconds
setInterval(() => {
    const now = Date.now();
    const timeout = 120000; // 2 minutes

    for (const [playerId, player] of gameState.players.entries()) {
        if (now - player.lastUpdate > timeout) {
            logger.warning('Removing inactive player', { user: player.username, id: playerId });
            gameState.players.delete(playerId);
            io.to(player.areaId).emit('playerLeft', { playerId });
        }
    }
}, 60000);

// Log stats every 5 minutes
setInterval(() => {
    const areaStats = {};
    for (const player of gameState.players.values()) {
        areaStats[player.areaId] = (areaStats[player.areaId] || 0) + 1;
    }
    logger.info('📊 PERIODIC STATS', {
        players: gameState.players.size,
        trades: gameState.trades.size,
        areas: Object.keys(areaStats).length,
        details: areaStats
    });
}, 300000);

// ═══════════════════════════════════════
// ❗ ERROR HANDLING
// ═══════════════════════════════════════

app.use((err, req, res, next) => {
    logger.error('Express error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ═══════════════════════════════════════
// 🚀 START SERVER
// ═══════════════════════════════════════

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║   🎮 TOUCH WORLD SERVER ONLINE v2.0          ║
╠═══════════════════════════════════════════════╣
║  Port: ${PORT}                                  ║
║  WebSocket: ws://localhost:${PORT}              ║
║  HTTP: http://localhost:${PORT}                 ║
║  Health: GET /health                          ║
║  Stats: GET /stats                            ║
╠═══════════════════════════════════════════════╣
║  Features:                                    ║
║  ✅ Real-time player sync                     ║
║  ✅ Trade system                              ║
║  ✅ Chat/bubble messages                      ║
║  ✅ Multi-area support                        ║
║  ✅ Auto cleanup inactive players             ║
║  ✅ Enhanced Security                         ║
╚═══════════════════════════════════════════════╝
    `);
    logger.success('Server started successfully');
    logger.info(`Listening on port ${PORT}`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

export { io, app };
