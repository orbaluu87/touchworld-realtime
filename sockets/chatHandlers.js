// Chat Socket Handlers - Enhanced Logging
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
            
            Logger.chat(username, message, player.areaId);
            
            // בדיקת תוכן חשוד
            if (message.includes('hack') || message.includes('cheat') || message.includes('script')) {
                Logger.security('Suspicious chat message detected', {
                    username,
                    message,
                    area: player.areaId,
                    adminLevel: admin_level
                });
            }
        }
    });

    // System Message Event
    socket.on('systemMessage', (data) => {
        const { message, senderLevel, senderName } = data;
        
        io.emit('systemMessage', {
            message,
            senderLevel,
            timestamp: Date.now()
        });
        
        Logger.info('System message broadcast', { 
            sender: senderName || 'System',
            level: senderLevel, 
            message 
        });
    });
}
