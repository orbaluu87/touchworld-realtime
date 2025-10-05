// Trade Socket Handlers - Enhanced Logging
import { getPlayerById, getTrade, setTrade, removeTrade } from '../state/gameState.js';
import { Logger } from '../utils/logger.js';

export function setupTradeHandlers(socket, io, gameState) {
    
    // Trade Request Event
    socket.on('tradeRequest', (data) => {
        const { tradeId, initiatorId, receiverId } = data;
        const initiator = getPlayerById(initiatorId);
        const receiver = getPlayerById(receiverId);
        
        if (receiver && receiver.socketId) {
            io.to(receiver.socketId).emit('tradeRequest', { 
                tradeId, 
                initiatorId, 
                receiverId 
            });
            
            Logger.trade('REQUEST SENT', { 
                tradeId,
                from: initiator?.username || initiatorId,
                to: receiver?.username || receiverId,
                initiatorArea: initiator?.areaId,
                receiverArea: receiver?.areaId
            });
        }
    });

    // Trade Update Event
    socket.on('tradeUpdate', (data) => {
        const { tradeId, status, initiatorOffer, receiverOffer } = data;
        setTrade(tradeId, data);
        
        io.emit('tradeUpdate', data);
        
        Logger.trade('UPDATED', { 
            tradeId, 
            status,
            initiatorItems: initiatorOffer?.items?.length || 0,
            initiatorCoins: initiatorOffer?.coins || 0,
            receiverItems: receiverOffer?.items?.length || 0,
            receiverCoins: receiverOffer?.coins || 0
        });
    });

    // Trade Complete Event
    socket.on('tradeComplete', (data) => {
        const { tradeId, initiatorId, receiverId } = data;
        const initiator = getPlayerById(initiatorId);
        const receiver = getPlayerById(receiverId);
        
        removeTrade(tradeId);
        io.emit('tradeComplete', data);
        
        Logger.trade('COMPLETED', { 
            tradeId,
            between: `${initiator?.username || initiatorId} <-> ${receiver?.username || receiverId}`
        });
        
        Logger.success('Trade successful', { tradeId });
    });

    // Trade Cancel Event
    socket.on('tradeCancel', (data) => {
        const { tradeId, reason } = data;
        
        removeTrade(tradeId);
        io.emit('tradeCancel', data);
        
        Logger.trade('CANCELLED', { tradeId, reason: reason || 'User cancelled' });
    });
}
