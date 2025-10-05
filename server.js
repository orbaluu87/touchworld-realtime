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
    Logger.player('connected', { socketId: socket.id });

    setupPlayerHandlers(socket, io, gameState);
    setupChatHandlers(socket, io, gameState);
    setupTradeHandlers(socket, io, gameState);

    socket.on('disconnect', () => {
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
            Logger.player('disconnected', { username: disconnectedPlayer.username });
        }
    });
});

// Start Server
httpServer.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║   Touch World Real-time Server        ║
    ╠═══════════════════════════════════════╣
    ║  Server: http://localhost:${PORT}       ║
    ║  WebSocket: ws://localhost:${PORT}      ║
    ║  Stats: http://localhost:${PORT}/stats  ║
    ║  Health: http://localhost:${PORT}/health║
    ╚═══════════════════════════════════════╝
    `);
    Logger.success('Server started successfully');
});

export { io, httpServer };
