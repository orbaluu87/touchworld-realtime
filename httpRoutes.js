// ============================================================================
// Touch World - HTTP Routes (Health & Admin)
// ============================================================================

const { HEALTH_KEY, VERSION } = require('./config');
const { players } = require('./state');
const tradeManager = require('./tradeManager');

function setupHttpRoutes(app, io) {
  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, version: VERSION, players: players.size });
  });

  app.get("/health", (req, res) => {
    const key = req.headers["x-health-key"] || req.query.key;
    if (key !== HEALTH_KEY) return res.status(403).json({ ok: false });
    res.json({
      ok: true,
      version: VERSION,
      players: players.size,
      trades: tradeManager.getActiveTradesCount(),
      list: Array.from(players.values()).map(p => ({
        id: p.playerId,
        user: p.username,
        area: p.current_area,
        invisible: p.is_invisible,
        keepAway: p.keep_away_mode,
      })),
    });
  });

  app.post("/broadcast-config", (req, res) => {
    const key = req.headers["x-health-key"];
    if (key !== HEALTH_KEY) return res.status(403).json({ ok: false });

    const { type } = req.body;
    console.log(`⚙️ Broadcasting config update: ${type}`);

    io.emit("config_refresh_required", { type });

    res.json({ ok: true, broadcasted: true });
  });
}

module.exports = { setupHttpRoutes };
