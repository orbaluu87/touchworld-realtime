// API Routes

export function handleHealthCheck(req, res, gameState) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        players: gameState.players.size,
        uptime: process.uptime()
    }));
}

export function handleStats(req, res, gameState) {
    const areaStats = {};
    
    for (const player of gameState.players.values()) {
        areaStats[player.areaId] = (areaStats[player.areaId] || 0) + 1;
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        totalPlayers: gameState.players.size,
        areaStats,
        activeTrades: gameState.trades.size,
        timestamp: new Date().toISOString()
    }));
}
