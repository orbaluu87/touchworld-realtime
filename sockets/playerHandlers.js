// 👤 Player Socket Handlers
import { logger } from '../utils/logger.js';
import { addPlayer, getPlayer, removePlayer, getPlayersInArea } from '../state/gameState.js';

export function setupPlayerHandlers(socket, io, gameState) {
    
    // Player Join
    socket.on('join', (data) => {
        const { playerId, areaId, playerData } = data;

        if (!playerId || !areaId || !playerData) {
            logger.warning('Invalid join data', data);
            return;
        }

        const newPlayer = {
            id: playerId,
            socketId: socket.id,
            areaId,
            x: playerData.position_x || 960,
            y: playerData.position_y || 540,
            direction: playerData.direction || 'front',
            username: playerData.username,
            admin_level: playerData.admin_level || 'user',
            skin_code: playerData.skin_code || 'blue',
            equipped_hair: playerData.equipped_hair,
            equipped_top: playerData.equipped_top,
            equipped_pants: playerData.equipped_pants,
            equipped_hat: playerData.equipped_hat,
            equipped_halo: playerData.equipped_halo,
            equipped_necklace: playerData.equipped_necklace,
            equipped_accessories: playerData.equipped_accessories || [],
            is_invisible: playerData.is_invisible || false,
            animation_frame: 'idle',
            is_moving: false,
            joinedAt: Date.now(),
            lastUpdate: Date.now()
        };

        addPlayer(playerId, newPlayer);
        socket.join(areaId);

        const playersInArea = getPlayersInArea(areaId)
            .filter(p => p.id !== playerId);

        socket.emit('currentPlayers', playersInArea);
        socket.to(areaId).emit('newPlayer', newPlayer);

        logger.player('JOINED', { 
            user: playerData.username, 
            area: areaId, 
            total: gameState.players.size 
        });
    });

    // Player Movement
    socket.on('move', (data) => {
        const { playerId, x, y, direction, is_moving, animation_frame } = data;
        const player = getPlayer(playerId);

        if (player) {
            player.x = x;
            player.y = y;
            player.direction = direction;
            player.is_moving = is_moving;
            player.animation_frame = animation_frame;
            player.lastUpdate = Date.now();

            socket.to(player.areaId).emit('playerMoved', {
                id: playerId,
                x,
                y,
                direction,
                is_moving,
                animation_frame
            });
        }
    });

    // Change Area
    socket.on('changeArea', (data) => {
        const { playerId, newAreaId } = data;
        const player = getPlayer(playerId);

        if (player) {
            const oldArea = player.areaId;
            
            socket.leave(oldArea);
            socket.join(newAreaId);
            
            player.areaId = newAreaId;
            player.lastUpdate = Date.now();

            socket.to(oldArea).emit('playerLeft', { playerId });
            socket.to(newAreaId).emit('playerJoined', player);

            const playersInNewArea = getPlayersInArea(newAreaId)
                .filter(p => p.id !== playerId);

            socket.emit('currentPlayers', playersInNewArea);

            logger.player('AREA CHANGE', { 
                user: player.username, 
                from: oldArea, 
                to: newAreaId 
            });
        }
    });

    // Ping/Pong
    socket.on('ping', () => {
        socket.emit('pong');
    });
}
