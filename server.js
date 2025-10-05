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
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

app.use(cors(corsOptions));
app.use(express.json());

// ============ GAME STATE ============
const players = new Map();
const trades = new Map();

// ============ HTTP ROUTES ============
app.get('/', (req, res) => {
    res.send('🎮 Touch World Server Online!');
});

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        players: players.size,
        trades: trades.size,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
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
    console.log('✅ Player connected:', socket.id);

    // 🎮 JOIN - שחקן נכנס
    socket.on('join', (data) => {
        try {
            const { playerId, areaId, playerData } = data;
            if (!playerId || !areaId || !playerData) {
                console.warn('⚠️ Invalid join data');
                return;
            }

            const newPlayer = {
                id: playerId,
                socketId: socket.id,
                areaId: areaId,
                position_x: playerData.position_x || 960,
                position_y: playerData.position_y || 540,
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

            // שלח שחקנים קיימים לשחקן החדש
            const playersInArea = Array.from(players.values())
                .filter(p => p.areaId === areaId && p.id !== playerId);
            
            socket.emit('currentPlayers', playersInArea);

            // הודע לשחקנים אחרים על שחקן חדש
            socket.to(areaId).emit('newPlayer', newPlayer);

            console.log('👤 Player joined:', playerData.username, '| Area:', areaId, '| Total:', players.size);
        } catch (error) {
            console.error('❌ Join error:', error);
        }
    });

    // 🚶 MOVE - תנועת שחקן
    socket.on('move', (data) => {
        try {
            const { playerId, x, y, direction, is_moving, animation_frame, username, admin_level, skin_code, equipped_hair, equipped_top, equipped_pants, equipped_hat, equipped_halo, equipped_necklace, equipped_accessories, is_invisible } = data;
            
            const player = players.get(playerId);
            if (player) {
                // עדכן את כל הנתונים
                player.position_x = x;
                player.position_y = y;
                player.direction = direction;
                player.is_moving = is_moving;
                player.animation_frame = animation_frame;
                player.username = username;
                player.admin_level = admin_level;
                player.skin_code = skin_code;
                player.equipped_hair = equipped_hair;
                player.equipped_top = equipped_top;
                player.equipped_pants = equipped_pants;
                player.equipped_hat = equipped_hat;
                player.equipped_halo = equipped_halo;
                player.equipped_necklace = equipped_necklace;
                player.equipped_accessories = equipped_accessories;
                player.is_invisible = is_invisible;
                player.lastUpdate = Date.now();

                // שדר לכל השחקנים באזור
                socket.to(player.areaId).emit('playerMoved', player);
            }
        } catch (error) {
            console.error('❌ Move error:', error);
        }
    });

    // 🚪 CHANGE AREA - שינוי אזור
    socket.on('changeArea', (data) => {
        try {
            const { playerId, newAreaId } = data;
            const player = players.get(playerId);

            if (player) {
                const oldArea = player.areaId;
                
                // עזוב אזור ישן
                socket.leave(oldArea);
                socket.to(oldArea).emit('playerLeft', { playerId });

                // הצטרף לאזור חדש
                socket.join(newAreaId);
                player.areaId = newAreaId;
                player.lastUpdate = Date.now();

                // שלח שחקנים קיימים באזור החדש
                const playersInNewArea = Array.from(players.values())
                    .filter(p => p.areaId === newAreaId && p.id !== playerId);
                
                socket.emit('currentPlayers', playersInNewArea);

                // הודע לשחקנים באזור החדש
                socket.to(newAreaId).emit('newPlayer', player);

                console.log('🚪 Area change:', player.username, oldArea, '→', newAreaId);
            }
        } catch (error) {
            console.error('❌ Area change error:', error);
        }
    });

    // 💬 BUBBLE MESSAGE - הודעת בועה
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

                // שדר לכל השחקנים באזור (כולל השולח)
                io.to(player.areaId).emit('bubbleMessage', messageData);

                console.log('💬', username, ':', message.substring(0, 50));
            }
        } catch (error) {
            console.error('❌ Bubble error:', error);
        }
    });

    // 🤝 TRADE REQUEST - בקשת טריד
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

    // 🔄 TRADE UPDATE - עדכון טריד
    socket.on('tradeUpdate', (data) => {
        try {
            const { tradeId, status } = data;
            trades.set(tradeId, { ...data, updatedAt: Date.now() });

            const trade = trades.get(tradeId);
            if (trade) {
                const initiator = players.get(trade.initiator_id);
                const receiver = players.get(trade.receiver_id);

                if (initiator?.socketId) {
                    io.to(initiator.socketId).emit('tradeUpdate', trade);
                }
                if (receiver?.socketId) {
                    io.to(receiver.socketId).emit('tradeUpdate', trade);
                }

                console.log('🔄 Trade update:', tradeId, '→', status);

                if (['completed', 'cancelled'].includes(status)) {
                    trades.delete(tradeId);
                }
            }
        } catch (error) {
            console.error('❌ Trade update error:', error);
        }
    });

    // 🏓 PING/PONG - בדיקת חיבור
    socket.on('ping', () => {
        socket.emit('pong');
    });

    // ❌ DISCONNECT - התנתקות
    socket.on('disconnect', (reason) => {
        console.log('❌ Player disconnected:', socket.id, '| Reason:', reason);

        let disconnectedPlayer = null;
        for (const [playerId, player] of players.entries()) {
            if (player.socketId === socket.id) {
                disconnectedPlayer = player;
                players.delete(playerId);
                socket.to(player.areaId).emit('playerLeft', { playerId });
                break;
            }
        }

        if (disconnectedPlayer) {
            const duration = Math.round((Date.now() - disconnectedPlayer.joinedAt) / 1000);
            console.log('👋 Removed:', disconnectedPlayer.username, '| Duration:', duration, 's | Remaining:', players.size);
        }
    });

    // ⚠️ ERROR
    socket.on('error', (error) => {
        console.error('⚠️ Socket error:', socket.id, error);
    });
});

// ============ CLEANUP TASKS ============
setInterval(() => {
    const now = Date.now();
    const timeout = 120000; // 2 minutes

    for (const [playerId, player] of players.entries()) {
        if (now - player.lastUpdate > timeout) {
            console.log('🧹 Removing inactive player:', player.username);
            players.delete(playerId);
            io.to(player.areaId).emit('playerLeft', { playerId });
        }
    }
}, 60000); // Run every 60 seconds

// ============ STATS LOGGING ============
setInterval(() => {
    const areaStats = {};
    for (const player of players.values()) {
        areaStats[player.areaId] = (areaStats[player.areaId] || 0) + 1;
    }
    console.log('📊 Stats | Players:', players.size, '| Trades:', trades.size, '| Areas:', areaStats);
}, 300000); // Every 5 minutes

// ============ ERROR HANDLING ============
app.use((err, req, res, next) => {
    console.error('❌ Express error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║   🎮 TOUCH WORLD SERVER ONLINE v2.0          ║
╠═══════════════════════════════════════════════╣
║  Port: ${PORT}                                  ║
║  Environment: ${process.env.NODE_ENV || 'dev'} ║
║  WebSocket: Enabled ✅                        ║
║  Multiplayer: Active ✅                       ║
╚═══════════════════════════════════════════════╝
    `);
});

export { io, app };
