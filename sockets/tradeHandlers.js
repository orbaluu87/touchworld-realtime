// Trade Socket Handlers
import { getPlayerById, getTrade, setTrade, removeTrade } from '../state/gameState.js';
import { Logger } from '../utils/logger.js';

export function setupTradeHandlers(socket, io, gameState) {
    
    // Trade Request Event
    socket.on('tradeRequest', (data) => {
        const { tradeId, initiatorId, receiverId } = data;
        const receiver = getPlayerById(receiverId);
        
        if (receiver && receiver.socketId) {
            io.to(receiver.socketId).emit('tradeRequest', { 
                tradeId, 
                initiatorId, 
                receiverId 
            });
            
            Logger.trade('request sent', { from: initiatorId, to: receiverId });
        }
    });

    // Trade Update Event
    socket.on('tradeUpdate', (data) => {
        const { tradeId, status } = data;
        setTrade(tradeId, data);
        
        io.emit('tradeUpdate', data);
        
        Logger.trade('updated', { tradeId, status });
    });

    // Trade Complete Event
    socket.on('tradeComplete', (data) => {
        const { tradeId } = data;
        
        removeTrade(tradeId);
        io.emit('tradeComplete', data);
        
        Logger.trade('completed', { tradeId });
    });

    // Trade Cancel Event
    socket.on('tradeCancel', (data) => {
        const { tradeId } = data;
        
        removeTrade(tradeId);
        io.emit('tradeCancel', data);
        
        Logger.trade('cancelled', { tradeId });
    });
}
