// Player Socket Handlers
import { getPlayerById, getPlayersInArea, addPlayer, updatePlayer } from '../state/gameState.js';
import { Logger } from '../utils/logger.js';

export function setupPlayerHandlers(socket, io, gameState) {
    
    // Player Join Event
    socket.on('playerJoin', (data) => {
        const { playerId, areaId, playerData } = data;
        
        addPlayer(playerId, {
            ...playerData,
            socketId: socket.id,
            areaId: areaId
        });

        socket.join(areaId);
        
        const playersInArea = getPlayersInArea(areaId)
            .filter(p => p.id !== playerId);

        socket.emit('playersUpdate', { players: playersInArea });
        socket.to(areaId).emit('playerJoined', { player: playerData });
        
        Logger.player('joined', { username: playerData.username, area: areaId });
    });

    // Player Move Event
    socket.on('playerMove', (data) => {
        const { playerId, position, direction, animation_frame } = data;
        const player = getPlayerById(playerId);
        
        if (player) {
            updatePlayer(playerId, {
                position_x: position.x,
                position_y: position.y,
                direction,
                animation_frame
            });
            
            socket.to(player.areaId).emit('playerMoved', {
                playerId,
                position,
                direction,
                animation_frame
            });
        }
    });

    // Player State Update
    socket.on('playerState', (playerState) => {
        const player = getPlayerById(playerState.id);
        if (player) {
            updatePlayer(playerState.id, playerState);
            socket.to(player.areaId).emit('playerStateUpdate', playerState);
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
            
            updatePlayer(playerId, { areaId: newAreaId });
            
            socket.to(oldArea).emit('playerLeft', { playerId });
            socket.to(newAreaId).emit('playerJoined', { player });
            
            const playersInNewArea = getPlayersInArea(newAreaId)
                .filter(p => p.id !== playerId);
            
            socket.emit('playersUpdate', { players: playersInNewArea });
            
            Logger.player('changed area', { username: player.username, from: oldArea, to: newAreaId });
        }
    });
}
