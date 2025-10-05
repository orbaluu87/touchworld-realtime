// 🤝 Trade Socket Handlers
import { logger } from '../utils/logger.js';
import { getPlayer, addTrade, getTrade, updateTrade, removeTrade } from '../state/gameState.js';

export function setupTradeHandlers(socket, io, gameState) {
    
    // Trade Request
    socket.on('tradeRequest', (data) => {
        const { tradeId, initiator_id, receiver_id } = data;
        
        const receiver = getPlayer(receiver_id);
        const initiator = getPlayer(initiator_id);

        if (!receiver?.socketId) {
            logger.warning('Trade request to unknown/offline receiver:', receiver_id);
            socket.emit('tradeError', { 
                message: 'Recipient is not online',
                tradeId 
            });
            return;
        }

        addTrade(tradeId, {
            initiator_id,
            receiver_id,
            status: 'pending'
        });

        io.to(receiver.socketId).emit('tradeRequest', {
            tradeId,
            initiator_id,
            receiver_id,
            initiator_username: initiator?.username || 'Unknown'
        });

        logger.trade('REQUEST', { 
            from: initiator?.username || initiator_id,
            to: receiver?.username || receiver_id,
            id: tradeId 
        });
    });

    // Trade Update
    socket.on('tradeUpdate', (data) => {
        const { tradeId, status, ...updates } = data;
        
        updateTrade(tradeId, { ...updates, status });
        
        const trade = getTrade(tradeId);
        if (trade) {
            const initiatorSocketId = getPlayer(trade.initiator_id)?.socketId;
            const receiverSocketId = getPlayer(trade.receiver_id)?.socketId;

            if (initiatorSocketId) {
                io.to(initiatorSocketId).emit('tradeUpdate', trade);
            }
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('tradeUpdate', trade);
            }

            logger.trade('UPDATE', { id: tradeId, status });
        }
    });

    // Trade Complete
    socket.on('tradeComplete', (data) => {
        const { tradeId } = data;
        const trade = getTrade(tradeId);

        if (trade) {
            const initiatorSocketId = getPlayer(trade.initiator_id)?.socketId;
            const receiverSocketId = getPlayer(trade.receiver_id)?.socketId;

            if (initiatorSocketId) {
                io.to(initiatorSocketId).emit('tradeComplete', { 
                    tradeId, 
                    status: 'completed' 
                });
            }
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('tradeComplete', { 
                    tradeId, 
                    status: 'completed' 
                });
            }

            removeTrade(tradeId);
            logger.trade('COMPLETED', { id: tradeId });
        }
    });

    // Trade Cancel
    socket.on('tradeCancel', (data) => {
        const { tradeId } = data;
        const trade = getTrade(tradeId);

        if (trade) {
            const initiatorSocketId = getPlayer(trade.initiator_id)?.socketId;
            const receiverSocketId = getPlayer(trade.receiver_id)?.socketId;

            if (initiatorSocketId) {
                io.to(initiatorSocketId).emit('tradeCancel', { 
                    tradeId, 
                    status: 'cancelled' 
                });
            }
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('tradeCancel', { 
                    tradeId, 
                    status: 'cancelled' 
                });
            }

            removeTrade(tradeId);
            logger.trade('CANCELLED', { id: tradeId });
        }
    });
}
