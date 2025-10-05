// Player Socket Handlers - Enhanced Logging
import { getPlayerById, getPlayersInArea, addPlayer, updatePlayer } from '../state/gameState.js';
import { Logger } from '../utils/logger.js';

export function setupPlayerHandlers(socket, io, gameState) {
    
    // Player Join Event
    socket.on('playerJoin', (data) => {
        const { playerId, areaId, playerData } = data;
        
        addPlayer(playerId, {
            ...playerData,
            socketId: socket.id,
            areaId: areaId,
            joinedAt: Date.now()
        });

        socket.join(areaId);
        
        const playersInArea = getPlayersInArea(areaId).filter(p => p.id !== playerId);
        socket.emit('playersUpdate', { players: playersInArea });
        socket.to(areaId).emit('playerJoined', { player: playerData });
        
        Logger.player('JOINED GAME', { 
            username: playerData.username, 
            playerId,
            area: areaId,
            socketId: socket.id,
            adminLevel: playerData.admin_level || 'user',
            totalPlayers: gameState.players.size
        });
        
        Logger.stats('Active players', { count: gameState.players.size });
    });

    // Player Move Event
    socket.on('playerMove', (data) => {
        const { playerId, position, direction, animation_frame } = data;
        const player = getPlayerById(playerId);
        
        if (player) {
            const oldPosition = { x: player.position_x, y: player.position_y };
            
            updatePlayer(playerId, {
                position_x: position.x,
                position_y: position.y,
                direction,
                animation_frame,
                lastMoveAt: Date.now()
            });
            
            socket.to(player.areaId).emit('playerMoved', {
                playerId,
                position,
                direction,
                animation_frame
            });
            
            // לוג תנועה (רק אם השחקן זז מרחק משמעותי)
            const distance = Math.sqrt(
                Math.pow(position.x - oldPosition.x, 2) + 
                Math.pow(position.y - oldPosition.y, 2)
            );
            
            if (distance > 50) { // רק תנועות משמעותיות
                Logger.movement(player.username, oldPosition, position, player.areaId);
            }
        }
    });

    // Player State Update
    socket.on('playerState', (playerState) => {
        const player = getPlayerById(playerState.id);
        if (player) {
            updatePlayer(playerState.id, { 
                ...playerState,
                lastUpdateAt: Date.now()
            });
            socket.to(player.areaId).emit('playerStateUpdate', playerState);
            
            Logger.info('Player state updated', {
                username: player.username,
                updates: Object.keys(playerState)
            });
        }
    });

    // Change Area Event
    socket.on('changeArea', (data) => {
        const { playerId, newAreaId } = data;
        const player = getPlayerById(playerId);
        
        if (player) {
            const oldArea = player.areaId;
            socket.leave(oldArea);
            socket.join(newAreaId);
            
            updatePlayer(playerId, { areaId: newAreaId, areaChangedAt: Date.now() });
            
            socket.to(oldArea).emit('playerLeft', { playerId });
            socket.to(newAreaId).emit('playerJoined', { player });
            
            const playersInNewArea = getPlayersInArea(newAreaId).filter(p => p.id !== playerId);
            socket.emit('playersUpdate', { players: playersInNewArea });
            
            Logger.player('CHANGED AREA', { 
                username: player.username, 
                from: oldArea, 
                to: newAreaId,
                playersInNewArea: playersInNewArea.length
            });
        }
    });
}
}
