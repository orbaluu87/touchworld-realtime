// Chat Socket Handlers
import { getPlayerById } from '../state/gameState.js';
import { Logger } from '../utils/logger.js';

export function setupChatHandlers(socket, io, gameState) {
    
    // Chat Message Event
    socket.on('chatMessage', (data) => {
        const { playerId, message, username, admin_level } = data;
        const player = getPlayerById(playerId);
        
        if (player) {
            const messageData = {
                playerId,
                message,
                username,
                admin_level,
                timestamp: Date.now()
            };
            
            io.to(player.areaId).emit('bubbleMessage', messageData);
            Logger.chat(username, message);
        }
    });

    // System Message Event (for admins)
    socket.on('systemMessage', (data) => {
        const { message, senderLevel } = data;
        
        io.emit('systemMessage', {
            message,
            senderLevel,
            timestamp: Date.now()
        });
        
        Logger.info('System message sent', { message, level: senderLevel });
    });
}
