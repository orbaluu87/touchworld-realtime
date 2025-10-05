// 📊 Game State Management
export const gameState = {
    players: new Map(),
    trades: new Map()
};

// Player Management
export function addPlayer(playerId, playerData) {
    gameState.players.set(playerId, playerData);
}

export function getPlayer(playerId) {
    return gameState.players.get(playerId);
}

export function removePlayer(playerId) {
    return gameState.players.delete(playerId);
}

export function getPlayersInArea(areaId) {
    return Array.from(gameState.players.values())
        .filter(p => p.areaId === areaId);
}

// Trade Management
export function addTrade(tradeId, tradeData) {
    gameState.trades.set(tradeId, {
        ...tradeData,
        createdAt: Date.now(),
        updatedAt: Date.now()
    });
}

export function getTrade(tradeId) {
    return gameState.trades.get(tradeId);
}

export function updateTrade(tradeId, updates) {
    const trade = gameState.trades.get(tradeId);
    if (trade) {
        gameState.trades.set(tradeId, {
            ...trade,
            ...updates,
            updatedAt: Date.now()
        });
    }
}

export function removeTrade(tradeId) {
    return gameState.trades.delete(tradeId);
}
