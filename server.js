import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// ══════════════════════════════════════════════════════════
// 🎮 TOUCH WORLD - REAL-TIME MULTIPLAYER SERVER v3.0
// ══════════════════════════════════════════════════════════

const app = express();
const httpServer = createServer(app);

// ══════════════════════════════════════════════════════════
// 🎨 CONSOLE COLORS & LOGGER
// ══════════════════════════════════════════════════════════

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
    movement: (user, from, to, area) => console.log(`${colors.blue}🚶 [${timestamp()}] [MOVE]${colors.reset} ${user} in ${area}: (${from.x},${from.y}) → (${to.x},${to.y})`),
};

// ══════════════════════════════════════════════════════════
// 🛡️ CORS CONFIGURATION
// ══════════════════════════════════════════════════════════

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
            logger.warning('CORS blocked:', origin);
            callback(null, true); // Allow anyway for development
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};

// ══════════════════════════════════════════════════════════
// 🔌 SOCKET.IO SERVER
// ══════════════════════════════════════════════════════════

const io = new Server(httpServer, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

app.use(cors(corsOptions));
app.use(express.json());

// ══════════════════════════════════════════════════════════
// 💾 GAME STATE
// ══════════════════════════════════════════════════════════

const gameState = {
    players: new Map(),        // Map<playerId, playerData>
    userSessions: new Map(),   // Map<userId, { playerId, socketId }> - for single session
    trades: new Map(),         // Map<tradeId, tradeData>
    maintenance: {
        enabled: false,
        message: 'השרת בתחזוקה. נחזור בקרוב!'
    }
};

// ══════════════════════════════════════════════════════════
// 🔒 SECURITY HEADERS
// ══════════════════════════════════════════════════════════

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});

// ══════════════════════════════════════════════════════════
// 🌐 HTTP ROUTES
// ══════════════════════════════════════════════════════════

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🎮 Touch World Server</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            background: rgba(255,255,255,0.1);
            padding: 40px;
            border-radius: 20px;
            backdrop-filter: blur(10px);
        }
        h1 { font-size: 3em; margin: 0; }
        p { font-size: 1.2em; margin: 10px 0; }
        .status { color: #00ff88; font-weight: bold; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎮 Touch World Server</h1>
        <p class="status">✅ Online & Running</p>
        <p>Players: ${gameState.players.size}</p>
        <p>Version: 3.0.0</p>
    </div>
</body>
</html>
    `);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        players: gameState.players.size,
        trades: gameState.trades.size,
        maintenance: gameState.maintenance.enabled,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '3.0.0'
    });
});

app.get('/stats', (req, res) => {
    const areaStats = {};
    for (const player of gameState.players.values()) {
        areaStats[player.areaId] = (areaStats[player.areaId] || 0) + 1;
    }
    res.json({
        totalPlayers: gameState.players.size,
        activeSessions: gameState.userSessions.size,
        areaStats,
        activeTrades: gameState.trades.size,
        maintenance: gameState.maintenance,
        timestamp: new Date().toISOString()
    });
});

// Maintenance control (protected endpoint - add auth in production)
app.post('/maintenance', express.json(), (req, res) => {
    const { enabled, message } = req.body;
    
    gameState.maintenance.enabled = enabled;
    if (message) gameState.maintenance.message = message;
    
    // Notify all connected clients
    io.emit('maintenanceUpdate', gameState.maintenance);
    
    logger.info(`Maintenance mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    res.json({ success: true, maintenance: gameState.maintenance });
});

// ══════════════════════════════════════════════════════════
// 🎯 SOCKET.IO CONNECTION & HANDLERS
// ══════════════════════════════════════════════════════════

io.on('connection', (socket) => {
    logger.connection('NEW CONNECTION', { socketId: socket.id, total: io.engine.clientsCount });

    // ═══════════════════════════════════════════════════
    // 👤 PLAYER JOIN
    // ═══════════════════════════════════════════════════
    socket.on('join', (data) => {
        try {
            const { playerId, areaId, playerData } = data;

            if (!playerId || !areaId || !playerData) {
                logger.warning('Invalid join data', { socketId: socket.id });
                return;
            }

            // 🔒 SINGLE SESSION ENFORCEMENT
            const existingSession = gameState.userSessions.get(playerData.user_id);
            if (existingSession && existingSession.socketId !== socket.id) {
                // Disconnect old session
                const oldSocket = io.sockets.sockets.get(existingSession.socketId);
                if (oldSocket) {
                    oldSocket.emit('sessionReplaced', {
                        message: 'חיבור חדש זוהה ממכשיר אחר. החיבור הישן מנותק.'
                    });
                    oldSocket.disconnect(true);
                    logger.warning('Old session disconnected', {
                        userId: playerData.user_id,
                        oldSocket: existingSession.socketId,
                        newSocket: socket.id
                    });
                }

                // Remove old player
                gameState.players.delete(existingSession.playerId);
            }

            // Create new player session
            const newPlayer = {
                id: playerId,
                socketId: socket.id,
                userId: playerData.user_id,
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
            gameState.userSessions.set(playerData.user_id, { playerId, socketId: socket.id });
            
            socket.join(areaId);

            // Send current players in area to new player
            const playersInArea = Array.from(gameState.players.values())
                .filter(p => p.areaId === areaId && p.id !== playerId);
            
            socket.emit('currentPlayers', playersInArea);

            // Notify others about new player
            socket.to(areaId).emit('newPlayer', newPlayer);

            logger.player('JOINED', {
                user: playerData.username,
                area: areaId,
                total: gameState.players.size
            });
        } catch (error) {
            logger.error('Error in join handler:', error);
        }
    });

    // ═══════════════════════════════════════════════════
    // 🚶 PLAYER MOVEMENT
    // ═══════════════════════════════════════════════════
    socket.on('move', (data) => {
        try {
            const { playerId, x, y, direction, is_moving, animation_frame } = data;

            const player = gameState.players.get(playerId);
            if (!player) {
                logger.warning('Move event for unknown player:', playerId);
                return;
            }

            const oldPos = { x: player.x, y: player.y };
            
            // Update player state
            player.x = x;
            player.y = y;
            player.direction = direction;
            player.is_moving = is_moving;
            player.animation_frame = animation_frame;
            player.lastUpdate = Date.now();

            // Broadcast to others in area
            socket.to(player.areaId).emit('playerMoved', {
                playerId,
                x,
                y,
                direction,
                is_moving,
                animation_frame
            });

            // Log movement (only for significant moves)
            const distance = Math.sqrt(Math.pow(x - oldPos.x, 2) + Math.pow(y - oldPos.y, 2));
            if (distance > 50) {
                logger.movement(player.username, oldPos, { x, y }, player.areaId);
            }
        } catch (error) {
            logger.error('Error in move handler:', error);
        }
    });

    // ═══════════════════════════════════════════════════
    // 🚪 CHANGE AREA
    // ═══════════════════════════════════════════════════
    socket.on('changeArea', (data) => {
        try {
            const { playerId, newAreaId } = data;
            const player = gameState.players.get(playerId);

            if (!player) {
                logger.warning('Change area for unknown player:', playerId);
                return;
            }

            const oldArea = player.areaId;
            
            socket.leave(oldArea);
            socket.join(newAreaId);
            
            player.areaId = newAreaId;
            player.lastUpdate = Date.now();

            // Notify old area
            socket.to(oldArea).emit('playerLeft', { playerId });

            // Notify new area
            socket.to(newAreaId).emit('playerJoined', player);

            // Send current players in new area
            const playersInNewArea = Array.from(gameState.players.values())
                .filter(p => p.areaId === newAreaId && p.id !== playerId);
            
            socket.emit('currentPlayers', playersInNewArea);

            logger.player('AREA CHANGE', {
                user: player.username,
                from: oldArea,
                to: newAreaId
            });
        } catch (error) {
            logger.error('Error in changeArea handler:', error);
        }
    });

    // ═══════════════════════════════════════════════════
    // 💬 CHAT / BUBBLE MESSAGE
    // ═══════════════════════════════════════════════════
    socket.on('bubbleMessage', (data) => {
        try {
            const { playerId, message, username, adminLevel } = data;
            const player = gameState.players.get(playerId);

            if (!player) {
                logger.warning('Bubble message from unknown player:', playerId);
                return;
            }

            const messageData = {
                playerId,
                message,
                username,
                adminLevel,
                timestamp: Date.now()
            };

            // Broadcast to everyone in area
            io.to(player.areaId).emit('bubbleMessage', messageData);

            logger.chat(username, message, player.areaId);
        } catch (error) {
            logger.error('Error in bubbleMessage handler:', error);
        }
    });

    // ═══════════════════════════════════════════════════
    // 🤝 TRADE SYSTEM
    // ═══════════════════════════════════════════════════
    socket.on('tradeRequest', (data) => {
        try {
            const { tradeId, initiator_id, receiver_id, initiator_username } = data;
            const receiver = gameState.players.get(receiver_id);

            if (!receiver?.socketId) {
                socket.emit('tradeError', {
                    message: 'השחקן אינו מחובר כרגע',
                    tradeId
                });
                return;
            }

            gameState.trades.set(tradeId, {
                initiator_id,
                receiver_id,
                status: 'pending',
                createdAt: Date.now()
            });

            io.to(receiver.socketId).emit('tradeRequest', {
                tradeId,
                initiator_id,
                receiver_id,
                initiator_username
            });

            logger.trade('REQUEST', {
                from: initiator_username,
                to: receiver.username,
                id: tradeId
            });
        } catch (error) {
            logger.error('Error in tradeRequest handler:', error);
        }
    });

    socket.on('tradeUpdate', (data) => {
        try {
            const { tradeId, status, ...tradeData } = data;
            
            const trade = gameState.trades.get(tradeId) || {};
            const updatedTrade = { ...trade, ...tradeData, status, updatedAt: Date.now() };
            gameState.trades.set(tradeId, updatedTrade);

            // Notify both parties
            if (updatedTrade.initiator_id && updatedTrade.receiver_id) {
                const initiator = gameState.players.get(updatedTrade.initiator_id);
                const receiver = gameState.players.get(updatedTrade.receiver_id);

                if (initiator?.socketId) {
                    io.to(initiator.socketId).emit('tradeUpdate', updatedTrade);
                }
                if (receiver?.socketId) {
                    io.to(receiver.socketId).emit('tradeUpdate', updatedTrade);
                }

                logger.trade('UPDATE', { id: tradeId, status });
            }
        } catch (error) {
            logger.error('Error in tradeUpdate handler:', error);
        }
    });

    socket.on('tradeComplete', (data) => {
        try {
            const { tradeId } = data;
            const trade = gameState.trades.get(tradeId);

            if (trade) {
                const initiator = gameState.players.get(trade.initiator_id);
                const receiver = gameState.players.get(trade.receiver_id);

                if (initiator?.socketId) {
                    io.to(initiator.socketId).emit('tradeComplete', { tradeId, status: 'completed' });
                }
                if (receiver?.socketId) {
                    io.to(receiver.socketId).emit('tradeComplete', { tradeId, status: 'completed' });
                }

                gameState.trades.delete(tradeId);
                logger.trade('COMPLETED', { id: tradeId });
            }
        } catch (error) {
            logger.error('Error in tradeComplete handler:', error);
        }
    });

    socket.on('tradeCancel', (data) => {
        try {
            const { tradeId } = data;
            const trade = gameState.trades.get(tradeId);

            if (trade) {
                const initiator = gameState.players.get(trade.initiator_id);
                const receiver = gameState.players.get(trade.receiver_id);

                if (initiator?.socketId) {
                    io.to(initiator.socketId).emit('tradeCancel', { tradeId, status: 'cancelled' });
                }
                if (receiver?.socketId) {
                    io.to(receiver.socketId).emit('tradeCancel', { tradeId, status: 'cancelled' });
                }

                gameState.trades.delete(tradeId);
                logger.trade('CANCELLED', { id: tradeId });
            }
        } catch (error) {
            logger.error('Error in tradeCancel handler:', error);
        }
    });

    // ═══════════════════════════════════════════════════
    // 🧹 PING/PONG (Keep-Alive)
    // ═══════════════════════════════════════════════════
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // ═══════════════════════════════════════════════════
    // ❌ DISCONNECT
    // ═══════════════════════════════════════════════════
    socket.on('disconnect', (reason) => {
        logger.connection('DISCONNECT', { socketId: socket.id, reason });

        let disconnectedPlayer = null;
        let userId = null;

        // Find and remove player
        for (const [playerId, player] of gameState.players.entries()) {
            if (player.socketId === socket.id) {
                disconnectedPlayer = player;
                userId = player.userId;
                
                gameState.players.delete(playerId);
                
                // Notify others in area
                socket.to(player.areaId).emit('playerLeft', { playerId });
                
                logger.player('REMOVED', {
                    user: player.username,
                    area: player.areaId
                });
                break;
            }
        }

        // Clean up session
        if (userId) {
            gameState.userSessions.delete(userId);
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

// ══════════════════════════════════════════════════════════
// 🧹 CLEANUP & MAINTENANCE
// ══════════════════════════════════════════════════════════

// Cleanup inactive players every 60 seconds
setInterval(() => {
    const now = Date.now();
    const timeout = 120000; // 2 minutes inactivity

    for (const [playerId, player] of gameState.players.entries()) {
        if (now - player.lastUpdate > timeout) {
            logger.warning('Removing inactive player', {
                user: player.username,
                id: playerId,
                area: player.areaId
            });
            
            gameState.players.delete(playerId);
            gameState.userSessions.delete(player.userId);
            
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
        sessions: gameState.userSessions.size,
        trades: gameState.trades.size,
        areas: Object.keys(areaStats).length,
        details: areaStats
    });
}, 300000);

// ══════════════════════════════════════════════════════════
// ❗ ERROR HANDLING
// ══════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
    logger.error('Express caught an error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message
    });
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// ══════════════════════════════════════════════════════════
// 🚀 START SERVER
// ══════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎮 TOUCH WORLD SERVER v3.0 - ONLINE & READY! 🎮        ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  🌐 Port: ${PORT}                                           ║
║  🔌 WebSocket: ws://localhost:${PORT}                       ║
║  📡 HTTP: http://localhost:${PORT}                          ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  📊 Routes:                                               ║
║    GET  /         - Server info page                     ║
║    GET  /health   - Health check                         ║
║    GET  /stats    - Game statistics                      ║
║    POST /maintenance - Toggle maintenance mode           ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  ✨ Features:                                             ║
║    ✅ Real-time player sync                               ║
║    ✅ Single session enforcement                          ║
║    ✅ Trade system                                        ║
║    ✅ Chat/bubble messages                                ║
║    ✅ Multi-area support                                  ║
║    ✅ Auto cleanup inactive players                       ║
║    ✅ Maintenance mode                                    ║
║    ✅ Security headers                                    ║
║    ✅ Advanced logging                                    ║
║                                                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  🌍 Environment: ${process.env.NODE_ENV || 'development'}                          ║
║  📅 Started: ${new Date().toLocaleString('he-IL')}          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
    
    logger.success('🎉 Server started successfully');
    logger.info(`🎧 Listening on port ${PORT}`);
    logger.info(`🔗 Access at: http://localhost:${PORT}`);
});

export { io, app, gameState };
