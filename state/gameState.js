// Game State Management

export const gameState = {
    players: new Map(),
    areas: new Map(),
    trades: new Map()
};

// Helper Functions
export function getPlayerById(playerId) {
    return gameState.players.get(playerId);
}

export function getPlayersInArea(areaId) {
    return Array.from(gameState.players.values())
        .filter(p => p.areaId === areaId);
}

export function addPlayer(playerId, playerData) {
    gameState.players.set(playerId, playerData);
}

export function removePlayer(playerId) {
    gameState.players.delete(playerId);
}

export function updatePlayer(playerId, updates) {
    const player = gameState.players.get(playerId);
    if (player) {
        Object.assign(player, updates);
    }
}

export function getTrade(tradeId) {
    return gameState.trades.get(tradeId);
}

export function setTrade(tradeId, tradeData) {
    gameState.trades.set(tradeId, {
        ...tradeData,
        updatedAt: Date.now()
    });
}

export function removeTrade(tradeId) {
    gameState.trades.delete(tradeId);
}
