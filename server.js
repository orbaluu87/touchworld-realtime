// ============================================================================
// Touch World - Socket Server v11.11.0 - MISHLOACH MANOT MANAGER INTEGRATION
// ============================================================================

const { createServer } = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { Server } = require("socket.io");

const { allowedOrigins, PORT, VERSION, KEEP_AWAY_RADIUS, BASE44_SERVICE_KEY, BASE44_API_URL } = require('./config');
const { players } = require('./state');
const { getSocketIdByPlayerId } = require('./playerUtils');
const { setupHttpRoutes } = require('./httpRoutes');
const { setupSocketHandlers } = require('./socketHandlers');
const { startMovementLoop } = require('./movementLoop');

const donutManager = require('./donutManager');
const tradeManager = require('./tradeManager');
const systemRoutes = require('./systemRoutes');
const moderationManager = require('./moderationManager');
const mishloachManotManager = require('./mishloachManotManager');

// ---------- Express ----------
const app = express();
app.use(express.json());
app.use(helmet());

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// ---------- HTTP Server ----------
const httpServer = createServer(app);

// ---------- Socket.IO ----------
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ---------- HTTP Routes ----------
setupHttpRoutes(app, io);

// ---------- Initialize Managers ----------
systemRoutes.setupRoutes(app, io, players, getSocketIdByPlayerId, BASE44_SERVICE_KEY);
console.log('✅ System Routes (Potion System) initialized');

moderationManager.initialize(io, BASE44_SERVICE_KEY, BASE44_API_URL, players, getSocketIdByPlayerId);
console.log('✅ Moderation Manager initialized');

mishloachManotManager.initialize(io, BASE44_SERVICE_KEY, BASE44_API_URL, players, getSocketIdByPlayerId);
console.log('✅ Mishloach Manot Manager initialized');

// ---------- Socket Handlers ----------
setupSocketHandlers(io);

// ---------- Movement Loop ----------
startMovementLoop(io);

// ---------- Start ----------
httpServer.listen(PORT, () => {
  console.log(`\n${"★".repeat(60)}`);
  console.log(`🚀 Touch World Server v${VERSION} - Port ${PORT}`);
  console.log(`✅ PLAYER-ONLY SYSTEM - NO BASE44 USERS!`);
  console.log(`✅ CUSTOM JWT AUTHENTICATION!`);
  console.log(`🔄 TOKEN REFRESH SYSTEM - LIVE TOKEN UPDATES!`);
  console.log(`✅ TRADE SYSTEM with EQUIPMENT REMOVAL + DB UPDATE!`);
  console.log(`🚫 MODERATION SYSTEM (moderationManager.js)!`);
  console.log(`🎁 MISHLOACH MANOT SYSTEM (mishloachManotManager.js)!`);
  console.log(`👻 STEALTH MODE enabled!`);
  console.log(`🚫 KEEP-AWAY MODE: ${KEEP_AWAY_RADIUS}px!`);
  console.log(`💬 CHAT BUBBLE SYNC enabled!`);
  console.log(`🍩 Donut System Integration!`);
  console.log(`🧪 Potion System Integration!`);
  console.log(`🚫 Server-Side Banned Words Check!`);
  console.log(`👁️  TAB VISIBILITY SYNC enabled!`);
  console.log(`${"★".repeat(60)}\n`);

  if (donutManager && typeof donutManager.initialize === 'function') {
    donutManager.initialize(io, BASE44_SERVICE_KEY, BASE44_API_URL);
  } else {
    console.error('❌ Donut Manager Initialize function NOT FOUND!');
  }

  if (tradeManager && typeof tradeManager.initialize === 'function') {
    tradeManager.initialize(io, BASE44_API_URL, BASE44_SERVICE_KEY, players, getSocketIdByPlayerId);
  } else {
    console.error('❌ Trade Manager Initialize function NOT FOUND!');
  }

  if (systemRoutes && typeof systemRoutes.initialize === 'function') {
    systemRoutes.initialize(io, BASE44_SERVICE_KEY, BASE44_API_URL);
  }
});
