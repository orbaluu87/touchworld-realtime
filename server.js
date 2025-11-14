import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import fetch from 'node-fetch';

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
    'https://app.base44.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'https://preview.base44.com',
];

app.use(helmet());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

const io = new SocketIOServer(server, {
    cors: { origin: allowedOrigins, credentials: true },
    pingInterval: 25000,
    pingTimeout: 60000,
    transports: ['websocket', 'polling']
});

const players = new Map();
const activeTrades = new Map();
const chatRateLimit = new Map();

const BASE44_API_URL = process.env.BASE44_API_URL || 'https://app.base44.com/api';
const APP_ID = process.env.BASE44_APP_ID;
const SERVICE_KEY = process.env.BASE44_SERVICE_KEY;

if (!SERVICE_KEY || !APP_ID) {
    console.error('❌ Missing BASE44_SERVICE_KEY or BASE44_APP_ID');
    process.exit(1);
}

async function verifyToken(token) {
    try {
        const response = await fetch(`${BASE44_API_URL}/apps/${APP_ID}/functions/verifyWebSocketToken`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SERVICE_KEY}`
            },
            body: JSON.stringify({ token })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Token verification failed:', response.status, errorText);
            return null;
        }
        
        const data = await response.json();
        return data.valid ? data.user : null;
    } catch (error) {
        console.error('Token verification error:', error);
        return null;
    }
}

io.on('connection', async (socket) => {
    console.log(`🔌 New connection attempt: ${socket.id}`);
    
    const token = socket.handshake.auth?.token;
    if (!token) {
        console.log(`❌ No token provided for ${socket.id}`);
        socket.emit('disconnect_reason', 'No authentication token');
        socket.disconnect(true);
        return;
    }

    const user = await verifyToken(token);
    if (!user) {
        console.log(`❌ Invalid token for ${socket.id}`);
        socket.emit('disconnect_reason', 'Invalid token');
        socket.disconnect(true);
        return;
    }

    const existingPlayer = Array.from(players.values()).find(p => p.userId === user.id);
    if (existingPlayer && existingPlayer.socketId !== socket.id) {
        console.log(`⚠️ Duplicate login detected for user ${user.id}. Disconnecting old session ${existingPlayer.socketId}`);
        const oldSocket = io.sockets.sockets.get(existingPlayer.socketId);
        if (oldSocket) {
            oldSocket.emit('disconnect_reason', 'logged_in_elsewhere');
            oldSocket.disconnect(true);
        }
        players.delete(existingPlayer.socketId);
    }

    const player = {
        socketId: socket.id,
        userId: user.id,
        playerId: user.player_id,
        username: user.username,
        admin_level: user.admin_level,
        current_area: user.current_area,
        is_invisible: user.is_invisible || false,
        keep_away_mode: user.keep_away_mode || false,
        equipment: user.equipment || {},
        position_x: user.position_x,
        position_y: user.position_y,
        direction: user.direction || 's',
        is_moving: false,
        animation_frame: 'idle',
        move_type: 'walk',
        is_trading: false
    };

    players.set(socket.id, player);
    console.log(`✅ Player connected: ${player.username} (${socket.id}) in ${player.current_area}`);

    const playersInSameArea = Array.from(players.values()).filter(p => 
        p.current_area === player.current_area && p.socketId !== socket.id
    );

    socket.emit('current_players', playersInSameArea.map(p => ({
        id: p.playerId,
        playerId: p.playerId,
        socketId: p.socketId,
        username: p.username,
        admin_level: p.admin_level,
        current_area: p.current_area,
        equipment: p.equipment,
        position_x: p.position_x,
        position_y: p.position_y,
        direction: p.direction,
        is_moving: p.is_moving,
        animation_frame: p.animation_frame,
        move_type: p.move_type,
        is_trading: p.is_trading,
        is_invisible: p.is_invisible
    })));

    socket.broadcast.emit('player_joined', {
        id: player.playerId,
        playerId: player.playerId,
        socketId: socket.id,
        username: player.username,
        admin_level: player.admin_level,
        current_area: player.current_area,
        equipment: player.equipment,
        position_x: player.position_x,
        position_y: player.position_y,
        direction: player.direction,
        is_moving: player.is_moving,
        animation_frame: player.animation_frame,
        move_type: player.move_type,
        is_trading: player.is_trading,
        is_invisible: player.is_invisible
    });

    socket.on('move_to', (data) => {
        const p = players.get(socket.id);
        if (!p) return;

        p.destination_x = data.x;
        p.destination_y = data.y;
        p.is_moving = true;
        
        const dx = data.x - p.position_x;
        const dy = data.y - p.position_y;
        
        if (Math.abs(dx) > Math.abs(dy)) {
            p.direction = dx > 0 ? 'e' : 'w';
        } else {
            p.direction = dy > 0 ? 's' : 'n';
        }
    });

    socket.on('area_change', (newAreaId) => {
        const p = players.get(socket.id);
        if (!p) return;

        const oldArea = p.current_area;
        p.current_area = newAreaId;

        socket.broadcast.emit('player_area_changed', {
            id: p.playerId,
            playerId: p.playerId,
            socketId: socket.id,
            from_area: oldArea,
            to_area: newAreaId
        });

        console.log(`🚪 ${p.username} moved from ${oldArea} to ${newAreaId}`);
    });

    socket.on('player_update', (updateData) => {
        const p = players.get(socket.id);
        if (!p) return;

        if (updateData.equipment) p.equipment = updateData.equipment;
        if (updateData.admin_level) p.admin_level = updateData.admin_level;
        if (typeof updateData.is_invisible === 'boolean') p.is_invisible = updateData.is_invisible;
        if (typeof updateData.keep_away_mode === 'boolean') p.keep_away_mode = updateData.keep_away_mode;

        socket.broadcast.emit('player_update', {
            id: p.playerId,
            playerId: p.playerId,
            socketId: socket.id,
            equipment: p.equipment,
            admin_level: p.admin_level,
            is_invisible: p.is_invisible,
            keep_away_mode: p.keep_away_mode
        });
    });

    socket.on('chat_message', (data) => {
        const p = players.get(socket.id);
        if (!p) return;

        const now = Date.now();
        const userRateLimit = chatRateLimit.get(socket.id) || { count: 0, resetTime: now + 10000 };

        if (now > userRateLimit.resetTime) {
            userRateLimit.count = 0;
            userRateLimit.resetTime = now + 10000;
        }

        userRateLimit.count++;
        chatRateLimit.set(socket.id, userRateLimit);

        if (userRateLimit.count > 5) {
            socket.emit('rate_limit_exceeded', { message: 'יותר מדי הודעות, נסה שוב בעוד כמה שניות' });
            return;
        }

        if (!data || !data.message || data.message.trim().length === 0) return;

        const messageData = {
            id: p.playerId,
            playerId: p.playerId,
            socketId: socket.id,
            username: p.username,
            admin_level: p.admin_level,
            message: data.message.trim().substring(0, 200),
            area_id: p.current_area,
            timestamp: now
        };

        if (data.isSystemMessage && p.admin_level === 'admin') {
            io.emit('chat_message', messageData);
        } else {
            const playersInArea = Array.from(players.values()).filter(pl => pl.current_area === p.current_area);
            playersInArea.forEach(pl => {
                const targetSocket = io.sockets.sockets.get(pl.socketId);
                if (targetSocket) targetSocket.emit('chat_message', messageData);
            });
        }
    });

    socket.on('admin_kick_player', (data) => {
        const p = players.get(socket.id);
        if (!p || p.admin_level !== 'admin') return;

        const targetSocket = io.sockets.sockets.get(data.socketId);
        if (targetSocket) {
            targetSocket.emit('kicked_by_admin');
            targetSocket.disconnect(true);
            console.log(`👮 Admin ${p.username} kicked player ${data.socketId}`);
        }
    });

    socket.on('trade_request', (data) => {
        const initiator = players.get(socket.id);
        if (!initiator || !data.receiver?.id) return;

        const receiverEntry = Array.from(players.entries()).find(([sid, p]) => p.playerId === data.receiver.id);
        if (!receiverEntry) {
            socket.emit('trade_status_updated', { status: 'failed', reason: 'המשתמש השני לא מחובר' });
            return;
        }

        const [receiverSocketId, receiver] = receiverEntry;

        if (initiator.is_trading || receiver.is_trading) {
            socket.emit('trade_status_updated', { status: 'failed', reason: 'אחד השחקנים כבר בהחלפה' });
            return;
        }

        const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const trade = {
            id: tradeId,
            initiator: { id: initiator.playerId, username: initiator.username, socketId: socket.id, equipment: initiator.equipment, ready: false },
            receiver: { id: receiver.playerId, username: receiver.username, socketId: receiverSocketId, equipment: receiver.equipment, ready: false },
            initiator_offer: { items: [], coins: 0, gems: 0 },
            receiver_offer: { items: [], coins: 0, gems: 0 },
            status: 'pending'
        };

        activeTrades.set(tradeId, trade);
        initiator.is_trading = true;
        receiver.is_trading = true;

        const receiverSocket = io.sockets.sockets.get(receiverSocketId);
        if (receiverSocket) {
            receiverSocket.emit('trade_request_received', { trade_id: tradeId, initiator: trade.initiator });
        }
    });

    socket.on('trade_accept', (data) => {
        const trade = activeTrades.get(data.trade_id);
        if (!trade) return;

        trade.status = 'started';
        io.to(trade.initiator.socketId).emit('trade_status_updated', trade);
        io.to(trade.receiver.socketId).emit('trade_status_updated', trade);
    });

    socket.on('trade_offer_update', (data) => {
        const trade = activeTrades.get(data.trade_id);
        if (!trade) return;

        const p = players.get(socket.id);
        if (!p) return;

        if (p.playerId === trade.initiator.id) {
            trade.initiator_offer = data.offer;
            trade.initiator.ready = false;
        } else if (p.playerId === trade.receiver.id) {
            trade.receiver_offer = data.offer;
            trade.receiver.ready = false;
        }

        io.to(trade.initiator.socketId).emit('trade_status_updated', trade);
        io.to(trade.receiver.socketId).emit('trade_status_updated', trade);
    });

    socket.on('trade_ready_update', (data) => {
        const trade = activeTrades.get(data.trade_id);
        if (!trade) return;

        const p = players.get(socket.id);
        if (!p) return;

        if (p.playerId === trade.initiator.id) {
            trade.initiator.ready = data.ready;
        } else if (p.playerId === trade.receiver.id) {
            trade.receiver.ready = data.ready;
        }

        io.to(trade.initiator.socketId).emit('trade_status_updated', trade);
        io.to(trade.receiver.socketId).emit('trade_status_updated', trade);

        if (trade.initiator.ready && trade.receiver.ready) {
            executeTrade(trade);
        }
    });

    socket.on('trade_cancel', (data) => {
        const trade = activeTrades.get(data.trade_id);
        if (!trade) return;

        trade.status = 'cancelled';
        trade.reason = data.reason || 'ההחלפה בוטלה';

        const initiatorPlayer = players.get(trade.initiator.socketId);
        const receiverPlayer = players.get(trade.receiver.socketId);
        
        if (initiatorPlayer) initiatorPlayer.is_trading = false;
        if (receiverPlayer) receiverPlayer.is_trading = false;

        io.to(trade.initiator.socketId).emit('trade_status_updated', trade);
        io.to(trade.receiver.socketId).emit('trade_status_updated', trade);

        activeTrades.delete(data.trade_id);
    });

    socket.on('trade_chat', (data) => {
        const trade = activeTrades.get(data.trade_id);
        if (!trade) return;

        const p = players.get(socket.id);
        if (!p) return;

        const message = data.message?.trim();
        if (!message) return;

        const chatPayload = {
            trade_id: data.trade_id,
            sender_id: p.playerId,
            sender_name: p.username,
            message: message.substring(0, 100)
        };

        io.to(trade.initiator.socketId).emit('trade_chat_message', chatPayload);
        io.to(trade.receiver.socketId).emit('trade_chat_message', chatPayload);
    });

    socket.on('disconnect', () => {
        const p = players.get(socket.id);
        if (p) {
            console.log(`❌ Player disconnected: ${p.username} (${socket.id})`);

            socket.broadcast.emit('player_disconnected', p.playerId);

            const userTrades = Array.from(activeTrades.values()).filter(t => 
                t.initiator.socketId === socket.id || t.receiver.socketId === socket.id
            );

            userTrades.forEach(trade => {
                trade.status = 'cancelled';
                trade.reason = 'המשתמש השני התנתק';

                const otherSocketId = trade.initiator.socketId === socket.id ? trade.receiver.socketId : trade.initiator.socketId;
                const otherSocket = io.sockets.sockets.get(otherSocketId);
                if (otherSocket) {
                    otherSocket.emit('trade_status_updated', trade);
                }

                const otherPlayer = players.get(otherSocketId);
                if (otherPlayer) {
                    otherPlayer.is_trading = false;
                }

                activeTrades.delete(trade.id);
            });

            players.delete(socket.id);
        }
    });

    async function executeTrade(trade) {
        console.log(`🔄 Executing trade ${trade.id}`);
        trade.status = 'executing';

        io.to(trade.initiator.socketId).emit('trade_status_updated', trade);
        io.to(trade.receiver.socketId).emit('trade_status_updated', trade);

        try {
            const response = await fetch(`${BASE44_API_URL}/apps/${APP_ID}/functions/executeTrade`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SERVICE_KEY}`
                },
                body: JSON.stringify({
                    player1_id: trade.initiator.id,
                    player2_id: trade.receiver.id,
                    player1_username: trade.initiator.username,
                    player2_username: trade.receiver.username,
                    player1_items: trade.initiator_offer.items || [],
                    player2_items: trade.receiver_offer.items || [],
                    player1_coins: trade.initiator_offer.coins || 0,
                    player2_coins: trade.receiver_offer.coins || 0,
                    player1_gems: trade.initiator_offer.gems || 0,
                    player2_gems: trade.receiver_offer.gems || 0,
                })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                console.log(`✅ Trade executed successfully: ${trade.id}`);

                // ✅ הורדת פריטים מהדמות אם הם היו לבושים
                await removeEquippedItemsFromCharacter(trade);

                const initiatorPlayer = players.get(trade.initiator.socketId);
                const receiverPlayer = players.get(trade.receiver.socketId);
                
                if (initiatorPlayer) initiatorPlayer.is_trading = false;
                if (receiverPlayer) receiverPlayer.is_trading = false;

                io.to(trade.initiator.socketId).emit('trade_completed_successfully', { trade_id: trade.id });
                io.to(trade.receiver.socketId).emit('trade_completed_successfully', { trade_id: trade.id });

                activeTrades.delete(trade.id);
            } else {
                throw new Error(result.error || 'Trade execution failed on server');
            }
        } catch (error) {
            console.error(`❌ Trade execution failed:`, error);
            trade.status = 'failed';
            trade.reason = 'ההחלפה נכשלה בצד השרת';

            io.to(trade.initiator.socketId).emit('trade_status_updated', trade);
            io.to(trade.receiver.socketId).emit('trade_status_updated', trade);

            const initiatorPlayer = players.get(trade.initiator.socketId);
            const receiverPlayer = players.get(trade.receiver.socketId);
            
            if (initiatorPlayer) initiatorPlayer.is_trading = false;
            if (receiverPlayer) receiverPlayer.is_trading = false;

            activeTrades.delete(trade.id);
        }
    }

    // ✅ פונקציה חדשה להורדת פריטים לבושים מהדמות
    async function removeEquippedItemsFromCharacter(trade) {
        try {
            console.log(`🔄 Checking equipped items for trade ${trade.id}`);

            // ✅ שליפת פרטי הפריטים שהוחלפו
            const [player1Items, player2Items] = await Promise.all([
                getItemDetails(trade.initiator_offer.items || []),
                getItemDetails(trade.receiver_offer.items || [])
            ]);

            // ✅ בדיקה אילו פריטים היו לבושים על Player 1
            const player1Updates = {};
            player1Items.forEach(item => {
                const equippedField = `equipped_${item.type}`;
                if (trade.initiator.equipment && trade.initiator.equipment[equippedField] === item.item_code) {
                    player1Updates[equippedField] = null;
                    console.log(`   ⬇️ Removing ${item.item_code} from ${trade.initiator.username}`);
                }
            });

            // ✅ בדיקה אילו פריטים היו לבושים על Player 2
            const player2Updates = {};
            player2Items.forEach(item => {
                const equippedField = `equipped_${item.type}`;
                if (trade.receiver.equipment && trade.receiver.equipment[equippedField] === item.item_code) {
                    player2Updates[equippedField] = null;
                    console.log(`   ⬇️ Removing ${item.item_code} from ${trade.receiver.username}`);
                }
            });

            // ✅ עדכון הדאטאבייס אם יש פריטים להוריד
            if (Object.keys(player1Updates).length > 0) {
                await updatePlayerEquipment(trade.initiator.id, player1Updates);
            }

            if (Object.keys(player2Updates).length > 0) {
                await updatePlayerEquipment(trade.receiver.id, player2Updates);
            }

            console.log(`✅ Equipped items removed successfully`);
        } catch (error) {
            console.error(`❌ Error removing equipped items:`, error);
        }
    }

    // ✅ פונקציית עזר לשליפת פרטי פריטים
    async function getItemDetails(inventoryIds) {
        if (!inventoryIds || inventoryIds.length === 0) return [];

        try {
            const response = await fetch(`${BASE44_API_URL}/apps/${APP_ID}/entities/PlayerInventory/records`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${SERVICE_KEY}`
                }
            });

            if (!response.ok) return [];

            const { data: inventory } = await response.json();
            const relevantItems = inventory.filter(inv => inventoryIds.includes(inv.id));

            const itemIds = relevantItems.map(inv => inv.item_id).filter(Boolean);
            if (itemIds.length === 0) return [];

            const itemsResponse = await fetch(`${BASE44_API_URL}/apps/${APP_ID}/entities/Item/records`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${SERVICE_KEY}`
                }
            });

            if (!itemsResponse.ok) return [];

            const { data: items } = await itemsResponse.json();
            return items.filter(item => itemIds.includes(item.id));
        } catch (error) {
            console.error('Error fetching item details:', error);
            return [];
        }
    }

    // ✅ פונקציית עזר לעדכון הציוד של השחקן
    async function updatePlayerEquipment(playerId, updates) {
        try {
            const response = await fetch(`${BASE44_API_URL}/apps/${APP_ID}/functions/secureUpdatePlayer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SERVICE_KEY}`
                },
                body: JSON.stringify({
                    player_id: playerId,
                    updates: updates
                })
            });

            if (!response.ok) {
                const error = await response.text();
                console.error(`Failed to update player equipment:`, error);
            }
        } catch (error) {
            console.error('Error updating player equipment:', error);
        }
    }
});

const MOVE_SPEED = 3;
const MOVEMENT_INTERVAL = 16;

setInterval(() => {
    const updates = [];

    players.forEach((p) => {
        if (!p.is_moving || p.destination_x === undefined || p.destination_y === undefined) {
            if (p.is_moving) {
                p.is_moving = false;
                p.animation_frame = 'idle';
                updates.push({
                    id: p.playerId,
                    playerId: p.playerId,
                    socketId: p.socketId,
                    position_x: p.position_x,
                    position_y: p.position_y,
                    direction: p.direction,
                    is_moving: false,
                    animation_frame: 'idle'
                });
            }
            return;
        }

        const dx = p.destination_x - p.position_x;
        const dy = p.destination_y - p.position_y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < MOVE_SPEED) {
            p.position_x = p.destination_x;
            p.position_y = p.destination_y;
            p.is_moving = false;
            p.animation_frame = 'idle';
            p.destination_x = undefined;
            p.destination_y = undefined;

            updates.push({
                id: p.playerId,
                playerId: p.playerId,
                socketId: p.socketId,
                position_x: p.position_x,
                position_y: p.position_y,
                direction: p.direction,
                is_moving: false,
                animation_frame: 'idle'
            });
        } else {
            const moveX = (dx / distance) * MOVE_SPEED;
            const moveY = (dy / distance) * MOVE_SPEED;

            p.position_x += moveX;
            p.position_y += moveY;
            p.animation_frame = p.animation_frame === 'walk1' ? 'walk2' : 'walk1';

            updates.push({
                id: p.playerId,
                playerId: p.playerId,
                socketId: p.socketId,
                position_x: p.position_x,
                position_y: p.position_y,
                direction: p.direction,
                is_moving: true,
                animation_frame: p.animation_frame
            });
        }
    });

    if (updates.length > 0) {
        io.emit('players_moved', updates);
    }
}, MOVEMENT_INTERVAL);

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        players: players.size,
        activeTrades: activeTrades.size,
        uptime: process.uptime()
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Touch World Server running on port ${PORT}`);
    console.log(`📡 WebSocket server ready`);
});
