// 🎮 Touch World - Main Server File
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { corsOptions } from './config/cors.js';
import { socketConfig } from './config/socket.js';
import { logger } from './utils/logger.js';
import { securityMiddleware } from './middleware/security.js';
import apiRoutes from './routes/api.js';
import { setupSocketHandlers } from './sockets/index.js';
import { gameState } from './state/gameState.js';
import { startCleanupTasks, startStatsTasks } from './utils/tasks.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, socketConfig(corsOptions));

// Middleware
app.use(express.json());
app.use(securityMiddleware);

// Routes
app.use('/', apiRoutes);

// Socket.IO Setup
setupSocketHandlers(io, gameState);

// Background Tasks
startCleanupTasks(io, gameState);
startStatsTasks(gameState);

// Error Handling
app.use((err, req, res, next) => {
    logger.error('Express error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start Server
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║   🎮 TOUCH WORLD SERVER ONLINE v2.0          ║
╠═══════════════════════════════════════════════╣
║  Port: ${PORT}                                  ║
║  Environment: ${process.env.NODE_ENV || 'dev'} ║
║  WebSocket: ws://localhost:${PORT}              ║
╚═══════════════════════════════════════════════╝
    `);
    logger.success('Server started successfully');
});

export { io, app };
