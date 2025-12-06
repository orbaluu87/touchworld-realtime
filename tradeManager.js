// 🔄 Trade Manager - מערכת החלפות מושלמת
export default class TradeManager {
    constructor() {
        this.trades = new Map();
        this.playerTrades = new Map();
        this.io = null;
        this.playerSocketMap = null;
        this.base44 = null;
    }

    initialize(io, playerSocketMap, base44) {
        this.io = io;
        this.playerSocketMap = playerSocketMap;
        this.base44 = base44;
        console.log('✅ TradeManager initialized');
    }

    handleTradeRequest(socket, data) {
        const { target_player_id } = data;
        const initiatorPlayerId = socket.playerId;

        console.log(`📤 Trade request: ${initiatorPlayerId} -> ${target_player_id}`);

        if (this.playerTrades.has(initiatorPlayerId)) {
            socket.emit('trade_error', { error: 'אתה כבר בהחלפה' });
            return;
        }

        const targetSocket = this.playerSocketMap.get(target_player_id);
        if (!targetSocket) {
            socket.emit('trade_error', { error: 'השחקן לא מחובר' });
            return;
        }

        if (this.playerTrades.has(target_player_id)) {
            socket.emit('trade_error', { error: 'השחקן כבר בהחלפה' });
            return;
        }

        const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const trade = {
            id: tradeId,
            status: 'pending',
            initiator: {
                id: initiatorPlayerId,
                username: socket.playerData.username,
                equipment: {
                    skin_code: socket.playerData.skin_code,
                    equipped_hair: socket.playerData.equipped_hair,
                    equipped_top: socket.playerData.equipped_top,
                    equipped_pants: socket.playerData.equipped_pants,
                    equipped_hat: socket.playerData.equipped_hat,
                    equipped_necklace: socket.playerData.equipped_necklace,
                    equipped_halo: socket.playerData.equipped_halo,
                    equipped_shoes: socket.playerData.equipped_shoes,
                    equipped_gloves: socket.playerData.equipped_gloves,
                    equipped_accessory: socket.playerData.equipped_accessory
                },
                locked: false,
                ready: false
            },
            receiver: {
                id: target_player_id,
                username: targetSocket.playerData.username,
                equipment: {
                    skin_code: targetSocket.playerData.skin_code,
                    equipped_hair: targetSocket.playerData.equipped_hair,
                    equipped_top: targetSocket.playerData.equipped_top,
                    equipped_pants: targetSocket.playerData.equipped_pants,
                    equipped_hat: targetSocket.playerData.equipped_hat,
                    equipped_necklace: targetSocket.playerData.equipped_necklace,
                    equipped_halo: targetSocket.playerData.equipped_halo,
                    equipped_shoes: targetSocket.playerData.equipped_shoes,
                    equipped_gloves: targetSocket.playerData.equipped_gloves,
                    equipped_accessory: targetSocket.playerData.equipped_accessory
                },
                locked: false,
                ready: false
            },
            initiator_offer: { items: [], coins: 0, gems: 0 },
            receiver_offer: { items: [], coins: 0, gems: 0 },
            created_at: new Date().toISOString()
        };

        this.trades.set(tradeId, trade);
        this.playerTrades.set(initiatorPlayerId, tradeId);
        this.playerTrades.set(target_player_id, tradeId);

        socket.emit('trade_request_sent', { trade_id: tradeId });
        targetSocket.emit('trade_request_received', { 
            trade,
            from_player: socket.playerData.username
        });

        console.log(`✅ Trade created: ${tradeId}`);
    }

    handleTradeAccept(socket, data) {
        const { trade_id } = data;
        const trade = this.trades.get(trade_id);

        if (!trade) {
            socket.emit('trade_error', { error: 'החלפה לא קיימת' });
            return;
        }

        if (trade.receiver.id !== socket.playerId) {
            return;
        }

        trade.status = 'active';

        const initiatorSocket = this.playerSocketMap.get(trade.initiator.id);
        const receiverSocket = this.playerSocketMap.get(trade.receiver.id);

        if (initiatorSocket) initiatorSocket.emit('trade_accepted', { trade });
        if (receiverSocket) receiverSocket.emit('trade_accepted', { trade });

        console.log(`✅ Trade accepted: ${trade_id}`);
    }

    handleOfferUpdate(socket, data) {
        const { trade_id, offer } = data;
        const trade = this.trades.get(trade_id);

        if (!trade || trade.status !== 'active') return;

        const isInitiator = trade.initiator.id === socket.playerId;
        
        if (isInitiator) {
            if (trade.initiator.locked) return;
            trade.initiator_offer = offer;
        } else {
            if (trade.receiver.locked) return;
            trade.receiver_offer = offer;
        }

        this._broadcastTradeUpdate(trade);
    }

    handleLockUpdate(socket, data) {
        const { trade_id, locked } = data;
        const trade = this.trades.get(trade_id);

        if (!trade || trade.status !== 'active') return;

        const isInitiator = trade.initiator.id === socket.playerId;
        
        if (isInitiator) {
            trade.initiator.locked = locked;
            if (!locked) trade.initiator.ready = false;
        } else {
            trade.receiver.locked = locked;
            if (!locked) trade.receiver.ready = false;
        }

        this._broadcastTradeUpdate(trade);
    }

    handleReadyUpdate(socket, data) {
        const { trade_id, ready } = data;
        const trade = this.trades.get(trade_id);

        if (!trade || trade.status !== 'active') return;

        const isInitiator = trade.initiator.id === socket.playerId;
        
        if (!trade.initiator.locked || !trade.receiver.locked) return;

        if (isInitiator) {
            trade.initiator.ready = ready;
        } else {
            trade.receiver.ready = ready;
        }

        this._broadcastTradeUpdate(trade);

        if (trade.initiator.ready && trade.receiver.ready) {
            this._executeTrade(trade);
        }
    }

    handleTradeCancel(socket, data) {
        const { trade_id } = data;
        const trade = this.trades.get(trade_id);

        if (!trade) return;

        const initiatorSocket = this.playerSocketMap.get(trade.initiator.id);
        const receiverSocket = this.playerSocketMap.get(trade.receiver.id);

        if (initiatorSocket) initiatorSocket.emit('trade_cancelled', { reason: 'השותף ביטל' });
        if (receiverSocket) receiverSocket.emit('trade_cancelled', { reason: 'השותף ביטל' });

        this._cleanupTrade(trade_id);

        console.log(`❌ Trade cancelled: ${trade_id}`);
    }

    handleTradeChat(socket, data) {
        const { trade_id, message } = data;
        const trade = this.trades.get(trade_id);

        if (!trade) return;

        const chatMessage = {
            trade_id,
            sender_id: socket.playerId,
            sender_name: socket.playerData.username,
            message: message.trim(),
            timestamp: Date.now()
        };

        console.log(`💬 Trade chat [${trade_id}]: ${chatMessage.sender_name}: ${chatMessage.message}`);

        const initiatorSocket = this.playerSocketMap.get(trade.initiator.id);
        const receiverSocket = this.playerSocketMap.get(trade.receiver.id);

        if (initiatorSocket) {
            initiatorSocket.emit('trade_chat_message', chatMessage);
        }
        if (receiverSocket) {
            receiverSocket.emit('trade_chat_message', chatMessage);
        }
    }

    handlePlayerDisconnect(playerId) {
        const tradeId = this.playerTrades.get(playerId);
        if (!tradeId) return;

        const trade = this.trades.get(tradeId);
        if (!trade) return;

        const otherPlayerId = trade.initiator.id === playerId ? trade.receiver.id : trade.initiator.id;
        const otherSocket = this.playerSocketMap.get(otherPlayerId);

        if (otherSocket) {
            otherSocket.emit('trade_cancelled', { reason: 'השותף התנתק' });
        }

        this._cleanupTrade(tradeId);
    }

    async _executeTrade(trade) {
        trade.status = 'executing';
        console.log(`⚙️ Executing trade: ${trade.id}`);

        try {
            const result = await this.base44.functions.invoke('executeTrade', {
                trade_id: trade.id,
                initiator_id: trade.initiator.id,
                receiver_id: trade.receiver.id,
                initiator_offer: trade.initiator_offer,
                receiver_offer: trade.receiver_offer
            });

            if (result.data?.success) {
                const initiatorSocket = this.playerSocketMap.get(trade.initiator.id);
                const receiverSocket = this.playerSocketMap.get(trade.receiver.id);

                if (initiatorSocket) initiatorSocket.emit('trade_completed_successfully', { trade });
                if (receiverSocket) receiverSocket.emit('trade_completed_successfully', { trade });

                console.log(`✅ Trade executed successfully: ${trade.id}`);
            } else {
                throw new Error(result.data?.error || 'Trade execution failed');
            }
        } catch (error) {
            console.error(`❌ Trade execution failed:`, error);
            
            const initiatorSocket = this.playerSocketMap.get(trade.initiator.id);
            const receiverSocket = this.playerSocketMap.get(trade.receiver.id);

            if (initiatorSocket) initiatorSocket.emit('trade_error', { error: 'שגיאה בביצוע החלפה' });
            if (receiverSocket) receiverSocket.emit('trade_error', { error: 'שגיאה בביצוע החלפה' });
        } finally {
            this._cleanupTrade(trade.id);
        }
    }

    _broadcastTradeUpdate(trade) {
        const initiatorSocket = this.playerSocketMap.get(trade.initiator.id);
        const receiverSocket = this.playerSocketMap.get(trade.receiver.id);

        if (initiatorSocket) initiatorSocket.emit('trade_status_updated', trade);
        if (receiverSocket) receiverSocket.emit('trade_status_updated', trade);
    }

    _cleanupTrade(tradeId) {
        const trade = this.trades.get(tradeId);
        if (!trade) return;

        this.playerTrades.delete(trade.initiator.id);
        this.playerTrades.delete(trade.receiver.id);
        this.trades.delete(tradeId);

        console.log(`🧹 Trade cleaned up: ${tradeId}`);
    }
}
