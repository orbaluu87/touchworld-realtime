// 💬 Chat Socket Handlers
import { logger } from '../utils/logger.js';
import { getPlayer } from '../state/gameState.js';

export function setupChatHandlers(socket, io, gameState) {
    
    // Bubble Message
    socket.on('bubbleMessage', (data) => {
        const { playerId, message, username, adminLevel } = data;
        const player = getPlayer(playerId);

        if (!player) {
            logger.warning('Bubble message from unknown player:', playerId);
            return;
        }

        if (!message || typeof message !== 'string' || message.length > 150) {
            logger.warning('Invalid bubble message', { playerId, messageLength: message?.length });
            return;
        }

        const messageData = {
            playerId,
            message,
            username,
            adminLevel,
            timestamp: Date.now()
        };

        io.to(player.areaId).emit('bubbleMessage', messageData);
        logger.chat(username, message, player.areaId);
    });
}
