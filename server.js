// Touch World - Main Server Entry Point
import { createServer } from 'http';
import { Server } from 'socket.io';
import { allowedOrigins, corsOptions } from './config/cors.js';
import { gameState } from './state/gameState.js';
import { setupPlayerHandlers } from './sockets/playerHandlers.js';
import { setupChatHandlers } from './sockets/chatHandlers.js';
import { setupTradeHandlers } from './sockets/tradeHandlers.js';
import { handleHealthCheck, handleStats } from './routes/apiRoutes.js';
import { Logger } from './utils/logger.js';

const PORT = process.env.PORT || 3000;

// Create HTTP Server
const httpServer = createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    
    Logger.info('HTTP Request', { 
        method: req.method, 
        url: url.pathname,
        ip: req.socket.remoteAddress
    });
    
    if (url.pathname === '/health') {
        return handleHealthCheck(req, res, gameState);
    }
    
    if (url.pathname === '/stats') {
        return handleStats(req, res, gameState);
    }
    
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Touch World Server Running!');
});

// Setup Socket.IO
const io = new Server(httpServer, {
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Setup Socket Event Handlers
io.on('connection', (socket) => {
    Logger.connection('NEW CONNECTION', { 
        socketId: socket.id,
        ip: socket.handshake.address,
        totalConnections: io.engine.clientsCount
    });

    setupPlayerHandlers(socket, io, gameState);
    setupChatHandlers(socket, io, gameState);
    setupTradeHandlers(socket, io, gameState);

    socket.on('disconnect', (reason) => {
        let disconnectedPlayer = null;
        
        for (const [playerId, player] of gameState.players.entries()) {
            if (player.socketId === socket.id) {
                disconnectedPlayer = player;
                gameState.players.delete(playerId);
                socket.to(player.areaId).emit('playerLeft', { playerId });
                break;
            }
        }
        
        if (disconnectedPlayer) {
            Logger.disconnection({ 
                username: disconnectedPlayer.username,
                socketId: socket.id,
                reason,
                sessionDuration: Date.now() - disconnectedPlayer.joinedAt,
                totalPlayers: gameState.players.size
            });
        } else {
            Logger.disconnection({ socketId: socket.id, reason });
        }
        
        Logger.stats('Active players', { count: gameState.players.size });
    });
});

// Stats Reporter - Every 5 minutes
setInterval(() => {
    const areaStats = {};
    for (const player of gameState.players.values()) {
        areaStats[player.areaId] = (areaStats[player.areaId] || 0) + 1;
    }
    
    Logger.separator();
    Logger.stats('Server Statistics', {
        totalPlayers: gameState.players.size,
        activeTrades: gameState.trades.size,
        areasPopulation: areaStats,
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
    Logger.separator();
}, 300000); // 5 minutes

// Start Server
httpServer.listen(PORT, () => {
    Logger.header('TOUCH WORLD SERVER STARTED');
    Logger.success('Server is running', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version
    });
    Logger.info('Endpoints available', {
        health: `http://localhost:${PORT}/health`,
        stats: `http://localhost:${PORT}/stats`,
        websocket: `ws://localhost:${PORT}`
    });
    Logger.separator();
});

// Graceful Shutdown
process.on('SIGTERM', () => {
    Logger.warning('SIGTERM signal received - shutting down gracefully');
    httpServer.close(() => {
        Logger.success('Server closed');
        process.exit(0);
    });
});

export { io, httpServer };
