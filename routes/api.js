// 🛣️ API Routes
import express from 'express';
import { gameState } from '../state/gameState.js';

const router = express.Router();

// Root
router.get('/', (req, res) => {
    res.status(200).send('🎮 Touch World Server Running!\n');
});

// Health Check
router.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        players: gameState.players.size,
        trades: gameState.trades.size,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Statistics
router.get('/stats', (req, res) => {
    const areaStats = {};
    
    for (const player of gameState.players.values()) {
        areaStats[player.areaId] = (areaStats[player.areaId] || 0) + 1;
    }
    
    res.json({
        totalPlayers: gameState.players.size,
        areaStats,
        activeTrades: gameState.trades.size,
        timestamp: new Date().toISOString()
    });
});

export default router;
