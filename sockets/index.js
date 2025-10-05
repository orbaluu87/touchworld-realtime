// 🔌 Socket.IO Main Handler
import { logger } from '../utils/logger.js';
import { setupPlayerHandlers } from './playerHandlers.js';
import { setupChatHandlers } from './chatHandlers.js';
import { setupTradeHandlers } from './tradeHandlers.js';
import { removePlayer } from '../state/gameState.js';

export function setupSocketHandlers(io, gameState) {
    io.on('connection', (socket) => {
        logger.connection('NEW CONNECTION', { 
            socketId: socket.id, 
            total: io.engine.clientsCount 
        });

        // Setup all handlers
        setupPlayerHandlers(socket, io, gameState);
        setupChatHandlers(socket, io, gameState);
        setupTradeHandlers(socket, io, gameState);

        // Disconnect Handler
        socket.on('disconnect', (reason) => {
            logger.connection('DISCONNECT', { socketId: socket.id, reason });

            let disconnectedPlayer = null;
            
            for (const [playerId, player] of gameState.players.entries()) {
                if (player.socketId === socket.id) {
                    disconnectedPlayer = player;
                    removePlayer(playerId);
                    
                    socket.to(player.areaId).emit('playerLeft', { 
                        playerId: player.id 
                    });
                    
                    logger.player('REMOVED', { 
                        user: player.username, 
                        area: player.areaId 
                    });
                    break;
                }
            }

            if (disconnectedPlayer) {
                const duration = Math.round(
                    (Date.now() - disconnectedPlayer.joinedAt) / 1000
                );
                
                logger.connection('DISCONNECTED PLAYER', {
                    user: disconnectedPlayer.username,
                    reason,
                    duration: `${duration}s`,
                    remaining: gameState.players.size
                });
            }
        });

        // Error Handler
        socket.on('error', (error) => {
            logger.error(`Socket error for ${socket.id}:`, error);
        });
    });
}
