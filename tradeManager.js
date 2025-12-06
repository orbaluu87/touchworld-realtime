// 🔄 Trade Manager - מערכת החלפות מושלמת
const fetch = require("node-fetch");

class TradeManager {
    constructor() {
        this.trades = new Map();
        this.playerTrades = new Map();
        this.io = null;
        this.players = null;
        this.getSocketIdByPlayerId = null;
        this.BASE44_API_URL = null;
        this.BASE44_SERVICE_KEY = null;
    }

    initialize(io, apiUrl, serviceKey, players, getSocketIdByPlayerId) {
        this.io = io;
        this.BASE44_API_URL = apiUrl;
        this.BASE44_SERVICE_KEY = serviceKey;
        this.players = players;
        this.getSocketIdByPlayerId = getSocketIdByPlayerId;
        console.log('✅ TradeManager initialized');
    }

    getActiveTradesCount() {
        return this.trades.size;
    }

    setupSocketHandlers(socket) {
        socket.on('trade_request', (data) => this.handleTradeRequest(socket, data));
        socket.on('trade_accept', (data) => this.handleTradeAccept(socket, data));
        socket.on('trade_offer_update', (data) => this.handleOfferUpdate(socket, data));
        socket.on('trade_lock_update', (data) => this.handleLockUpdate(socket, data));
        socket.on('trade_ready_update', (data) => this.handleReadyUpdate(socket, data));
        socket.on('trade_cancel', (data) => this.handleTradeCancel(socket, data));
        socket.on('trade_chat', (data) => this.handleTradeChat(socket, data));
    }

    handleDisconnect(socketId) {
        const player = this.players.get(socketId);
        if (player) {
            this.handlePlayerDisconnect(player.playerId);
        }
    }

    handleTradeRequest(socket, data) {
        const { target_player_id } = data;
        const initiatorPlayerId = socket.playerId;

        console.log(`📤 Trade request: ${initiatorPlayerId} -> ${target_player_id}`);

        if (this.playerTrades.has(initiatorPlayerId)) {
            socket.emit('trade_error', { error: 'אתה כבר בהחלפה' });
            return;
        }

        const targetSocketId = this.getSocketIdByPlayerId(target_player_id);
        if (!targetSocketId) {
            socket.emit('trade_error', { error: 'השחקן לא מחובר' });
            return;
        }
        
        const targetSocket = this.io.sockets.sockets.get(targetSocketId);
        if (!targetSocket) {
            socket.emit('trade_error', { error: 'השחקן לא מחובר' });
            return;
        }
        
        const targetPlayerData = this.players.get(targetSocketId);

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
                username: targetPlayerData.username,
                equipment: {
                    skin_code: targetPlayerData.skin_code,
                    equipped_hair: targetPlayerData.equipped_hair,
                    equipped_top: targetPlayerData.equipped_top,
                    equipped_pants: targetPlayerData.equipped_pants,
                    equipped_hat: targetPlayerData.equipped_hat,
                    equipped_necklace: targetPlayerData.equipped_necklace,
                    equipped_halo: targetPlayerData.equipped_halo,
                    equipped_shoes: targetPlayerData.equipped_shoes,
                    equipped_gloves: targetPlayerData.equipped_gloves,
                    equipped_accessory: targetPlayerData.equipped_accessory
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

        const initiatorSocketId = this.getSocketIdByPlayerId(trade.initiator.id);
        const receiverSocketId = this.getSocketIdByPlayerId(trade.receiver.id);
        
        const initiatorSocket = initiatorSocketId ? this.io.sockets.sockets.get(initiatorSocketId) : null;
        const receiverSocket = receiverSocketId ? this.io.sockets.sockets.get(receiverSocketId) : null;

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

        const initiatorSocketId = this.getSocketIdByPlayerId(trade.initiator.id);
        const receiverSocketId = this.getSocketIdByPlayerId(trade.receiver.id);
        
        const initiatorSocket = initiatorSocketId ? this.io.sockets.sockets.get(initiatorSocketId) : null;
        const receiverSocket = receiverSocketId ? this.io.sockets.sockets.get(receiverSocketId) : null;

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

        const initiatorSocketId = this.getSocketIdByPlayerId(trade.initiator.id);
        const receiverSocketId = this.getSocketIdByPlayerId(trade.receiver.id);
        
        const initiatorSocket = initiatorSocketId ? this.io.sockets.sockets.get(initiatorSocketId) : null;
        const receiverSocket = receiverSocketId ? this.io.sockets.sockets.get(receiverSocketId) : null;

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
        const otherSocketId = this.getSocketIdByPlayerId(otherPlayerId);
        const otherSocket = otherSocketId ? this.io.sockets.sockets.get(otherSocketId) : null;

        if (otherSocket) {
            otherSocket.emit('trade_cancelled', { reason: 'השותף התנתק' });
        }

        this._cleanupTrade(tradeId);
    }

    async _executeTrade(trade) {
        trade.status = 'executing';
        console.log(`⚙️ Executing trade: ${trade.id}`);

        try {
            const response = await fetch(`${this.BASE44_API_URL}/functions/executeTrade`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.BASE44_SERVICE_KEY}`
                },
                body: JSON.stringify({
                    trade_id: trade.id,
                    initiator_id: trade.initiator.id,
                    receiver_id: trade.receiver.id,
                    initiator_offer: trade.initiator_offer,
                    receiver_offer: trade.receiver_offer
                })
            });
            
            const result = await response.json();

            if (result?.success || result?.data?.success) {
                const initiatorSocketId = this.getSocketIdByPlayerId(trade.initiator.id);
                const receiverSocketId = this.getSocketIdByPlayerId(trade.receiver.id);
                
                const initiatorSocket = initiatorSocketId ? this.io.sockets.sockets.get(initiatorSocketId) : null;
                const receiverSocket = receiverSocketId ? this.io.sockets.sockets.get(receiverSocketId) : null;

                if (initiatorSocket) initiatorSocket.emit('trade_completed_successfully', { trade });
                if (receiverSocket) receiverSocket.emit('trade_completed_successfully', { trade });

                console.log(`✅ Trade executed successfully: ${trade.id}`);
            } else {
                throw new Error(result.data?.error || 'Trade execution failed');
            }
        } catch (error) {
            console.error(`❌ Trade execution failed:`, error);
            
            const initiatorSocketId = this.getSocketIdByPlayerId(trade.initiator.id);
            const receiverSocketId = this.getSocketIdByPlayerId(trade.receiver.id);
            
            const initiatorSocket = initiatorSocketId ? this.io.sockets.sockets.get(initiatorSocketId) : null;
            const receiverSocket = receiverSocketId ? this.io.sockets.sockets.get(receiverSocketId) : null;

            if (initiatorSocket) initiatorSocket.emit('trade_error', { error: 'שגיאה בביצוע החלפה' });
            if (receiverSocket) receiverSocket.emit('trade_error', { error: 'שגיאה בביצוע החלפה' });
        } finally {
            this._cleanupTrade(trade.id);
        }
    }

    _broadcastTradeUpdate(trade) {
        const initiatorSocketId = this.getSocketIdByPlayerId(trade.initiator.id);
        const receiverSocketId = this.getSocketIdByPlayerId(trade.receiver.id);
        
        const initiatorSocket = initiatorSocketId ? this.io.sockets.sockets.get(initiatorSocketId) : null;
        const receiverSocket = receiverSocketId ? this.io.sockets.sockets.get(receiverSocketId) : null;

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

module.exports = new TradeManager();
