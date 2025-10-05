// 🧹 Background Tasks
import { logger } from './logger.js';

// Cleanup inactive players
export function startCleanupTasks(io, gameState) {
    setInterval(() => {
        const now = Date.now();
        const timeout = 120000; // 2 minutes

        for (const [playerId, player] of gameState.players.entries()) {
            if (now - player.lastUpdate > timeout) {
                logger.warning('Removing inactive player', { 
                    user: player.username, 
                    id: playerId 
                });
                
                gameState.players.delete(playerId);
                io.to(player.areaId).emit('playerLeft', { playerId });
            }
        }
    }, 60000); // Run every 60 seconds
}

// Log stats periodically
export function startStatsTasks(gameState) {
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
    }, 300000); // Run every 5 minutes
}
