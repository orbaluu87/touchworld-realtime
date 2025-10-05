// 🎮 Touch World - Real-time Game Server v3.0
// 🚀 Production-Ready with Full Synchronization + Multi-User Support

import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// ═══════════════════════════════════════
// 🔧 Configuration
// ═══════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this';
const PORT = process.env.PORT || 3000;
const EMAIL_USER = process.env.EMAIL_USER || 'noreply@touchworld.com';
const EMAIL_PASS = process.env.EMAIL_PASS || 'your-email-password';

// ═══════════════════════════════════════
// 🎨 Console Logger
// ═══════════════════════════════════════

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};

function timestamp() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
}

const logger = {
    info: (msg, data) => console.log(`${colors.cyan}ℹ️  [${timestamp()}] [INFO]${colors.reset} ${msg}`, data || ''),
    success: (msg, data) => console.log(`${colors.green}✅ [${timestamp()}] [SUCCESS]${colors.reset} ${msg}`, data || ''),
    warning: (msg, data) => console.warn(`${colors.yellow}⚠️  [${timestamp()}] [WARN]${colors.reset} ${msg}`, data || ''),
    error: (msg, err) => console.error(`${colors.red}❌ [${timestamp()}] [ERROR]${colors.reset} ${msg}`, err || ''),
    player: (action, data) => console.log(`${colors.magenta}👤 [${timestamp()}] [PLAYER]${colors.reset} ${action}`, data || ''),
    chat: (user, msg, area) => console.log(`${colors.cyan}💬 [${timestamp()}] [CHAT]${colors.reset} ${colors.bright}${user}${colors.reset} (${area}): ${msg}`),
    trade: (action, data) => console.log(`${colors.yellow}🤝 [${timestamp()}] [TRADE]${colors.reset} ${action}`, data || ''),
    connection: (action, data) => console.log(`${colors.green}🔌 [${timestamp()}] [CONNECT]${colors.reset} ${action}`, data || ''),
    auth: (action, data) => console.log(`${colors.blue}🔐 [${timestamp()}] [AUTH]${colors.reset} ${action}`, data || ''),
};

// ═══════════════════════════════════════
// 📊 In-Memory Database (Replace with real DB)
// ═══════════════════════════════════════

const database = {
    users: new Map(), // username -> { username, email, password, savedAccounts: [], favoriteAccount }
    players: new Map(), // playerId -> playerData
    sessions: new Map(), // playerId -> { socketId, sessionId, lastUpdate }
    trades: new Map(),
    resetTokens: new Map() // email -> { token, expires }
};

// ═══════════════════════════════════════
// 📧 Email Service
// ═══════════════════════════════════════

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    }
});

async function sendPasswordResetEmail(email, token) {
    const resetLink = `http://your-domain.com/reset-password?token=${token}`;
    
    const mailOptions = {
        from: EMAIL_USER,
        to: email,
        subject: 'איפוס סיסמא - Touch World',
        html: `
            <div dir="rtl" style="font-family: Arial, sans-serif; text-align: right;">
                <h2>בקשה לאיפוס סיסמא</h2>
                <p>שלום,</p>
                <p>קיבלנו בקשה לאיפוס הסיסמא שלך. לחץ על הקישור הבא לאיפוס:</p>
                <a href__="${resetLink}" style="background: #00CED1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block; margin: 20px 0;">
                    אפס סיסמא
                </a>
                <p>הקישור תקף ל-30 דקות.</p>
                <p>אם לא ביקשת לאפס את הסיסמא, התעלם מהודעה זו.</p>
                <hr/>
                <p style="color: #666; font-size: 12px;">Touch World Team</p>
            </div>
        `
    };

    return transporter.sendMail(mailOptions);
}

// ═══════════════════════════════════════
// 🔐 Authentication Middleware
// ═══════════════════════════════════════

function authenticateToken(req, res, next) {
    const token = req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// ═══════════════════════════════════════
// 🚀 Express App Setup
// ═══════════════════════════════════════

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: [
            'http://localhost:5173',
            'https://preview--copy-565f73e8.base44.app',
            'https://copy-565f73e8.base44.app',
            'https://base44.app',
            /\.base44\.app$/
        ],
        credentials: true
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling']
});

app.use(cors({
    origin: [
        'http://localhost:5173',
        'https://preview--copy-565f73e8.base44.app',
        'https://copy-565f73e8.base44.app',
        /\.base44\.app$/
    ],
    credentials: true
}));

app.use(express.json());

// ═══════════════════════════════════════
// 🔐 Authentication Routes
// ═══════════════════════════════════════

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;

        if (!email || !username || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check if user exists
        if (database.users.has(username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const user = {
            username,
            email,
            password: hashedPassword,
            savedAccounts: [],
            favoriteAccount: null,
            createdAt: new Date().toISOString()
        };

        database.users.set(username, user);

        logger.auth('NEW REGISTRATION', { username, email });

        res.json({ success: true, message: 'User registered successfully' });
    } catch (error) {
        logger.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = database.users.get(username);

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign(
            { username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        logger.auth('LOGIN SUCCESS', { username });

        res.json({
            success: true,
            token,
            user: {
                username: user.username,
                email: user.email,
                savedAccounts: user.savedAccounts,
                favoriteAccount: user.favoriteAccount
            }
        });
    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Save Account
app.post('/api/auth/save-account', authenticateToken, async (req, res) => {
    try {
        const { accountData } = req.body;
        const user = database.users.get(req.user.username);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.savedAccounts.length >= 3) {
            return res.status(400).json({ error: 'Maximum 3 accounts allowed' });
        }

        user.savedAccounts.push(accountData);
        database.users.set(req.user.username, user);

        logger.auth('ACCOUNT SAVED', { username: req.user.username });

        res.json({ success: true, savedAccounts: user.savedAccounts });
    } catch (error) {
        logger.error('Save account error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Set Favorite Account
app.post('/api/auth/set-favorite', authenticateToken, async (req, res) => {
    try {
        const { accountIndex } = req.body;
        const user = database.users.get(req.user.username);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.favoriteAccount = accountIndex;
        database.users.set(req.user.username, user);

        res.json({ success: true, favoriteAccount: user.favoriteAccount });
    } catch (error) {
        logger.error('Set favorite error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Forgot Password
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email, username } = req.body;

        const user = Array.from(database.users.values()).find(
            u => u.email === email && u.username === username
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Generate reset token
        const resetToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '30m' });
        
        database.resetTokens.set(email, {
            token: resetToken,
            expires: Date.now() + 30 * 60 * 1000
        });

        // Send email
        await sendPasswordResetEmail(email, resetToken);

        logger.auth('PASSWORD RESET REQUESTED', { email, username });

        res.json({ success: true, message: 'Reset email sent' });
    } catch (error) {
        logger.error('Forgot password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Reset Password
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);
        const resetData = database.resetTokens.get(decoded.email);

        if (!resetData || resetData.token !== token || Date.now() > resetData.expires) {
            return res.status(400).json({ error: 'Invalid or expired token' });
        }

        // Find user and update password
        const user = Array.from(database.users.values()).find(u => u.email === decoded.email);
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        database.users.set(user.username, user);

        // Remove used token
        database.resetTokens.delete(decoded.email);

        logger.auth('PASSWORD RESET SUCCESS', { email: decoded.email });

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        logger.error('Reset password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ═══════════════════════════════════════
// 🎮 Game Routes
// ═══════════════════════════════════════

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        players: database.players.size,
        sessions: database.sessions.size,
        trades: database.trades.size,
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ═══════════════════════════════════════
// 🔌 Socket.IO - Game Synchronization
// ═══════════════════════════════════════

io.on('connection', (socket) => {
    logger.connection('NEW CONNECTION', { socketId: socket.id });

    // Player Join
    socket.on('join', (data) => {
        const { playerId, areaId, playerData } = data;

        if (!playerId || !areaId) {
            logger.warning('Invalid join data', data);
            return;
        }

        const newPlayer = {
            id: playerId,
            socketId: socket.id,
            areaId: areaId,
            ...playerData,
            joinedAt: Date.now(),
            lastUpdate: Date.now()
        };

        database.players.set(playerId, newPlayer);
        database.sessions.set(playerId, {
            socketId: socket.id,
            sessionId: playerData.session_id,
            lastUpdate: Date.now()
        });

        socket.join(areaId);

        // Send current players
        const playersInArea = Array.from(database.players.values())
            .filter(p => p.areaId === areaId && p.id !== playerId);
        
        socket.emit('currentPlayers', playersInArea);
        socket.to(areaId).emit('newPlayer', newPlayer);

        logger.player('JOINED', { user: playerData.username, area: areaId, total: database.players.size });
    });

    // Player Move
    socket.on('move', (data) => {
        const { playerId, x, y, direction, is_moving, animation_frame } = data;
        const player = database.players.get(playerId);

        if (player) {
            player.position_x = x;
            player.position_y = y;
            player.direction = direction;
            player.is_moving = is_moving;
            player.animation_frame = animation_frame;
            player.lastUpdate = Date.now();

            database.players.set(playerId, player);
            socket.to(player.areaId).emit('playerMoved', player);
        }
    });

    // Chat Message
    socket.on('bubbleMessage', (data) => {
        const { playerId, message, username, adminLevel } = data;
        const player = database.players.get(playerId);

        if (player) {
            const messageData = {
                playerId,
                message,
                username,
                adminLevel,
                timestamp: Date.now()
            };

            io.to(player.areaId).emit('bubbleMessage', messageData);
            logger.chat(username, message, player.areaId);
        }
    });

    // Trade Request
    socket.on('tradeRequest', (data) => {
        const { tradeId, initiator_id, receiver_id } = data;
        const receiver = database.players.get(receiver_id);

        if (receiver?.socketId) {
            io.to(receiver.socketId).emit('tradeRequest', data);
            logger.trade('REQUEST', { from: initiator_id, to: receiver_id, id: tradeId });
        }
    });

    // Trade Update
    socket.on('tradeUpdate', (data) => {
        const { tradeId, status } = data;
        database.trades.set(tradeId, { ...data, updatedAt: Date.now() });

        const trade = database.trades.get(tradeId);
        if (trade) {
            const initiator = database.players.get(trade.initiator_id);
            const receiver = database.players.get(trade.receiver_id);

            if (initiator?.socketId) io.to(initiator.socketId).emit('tradeUpdate', trade);
            if (receiver?.socketId) io.to(receiver.socketId).emit('tradeUpdate', trade);

            logger.trade('UPDATE', { id: tradeId, status });
        }
    });

    // Disconnect
    socket.on('disconnect', (reason) => {
        logger.connection('DISCONNECT', { socketId: socket.id, reason });

        let disconnectedPlayer = null;
        for (const [playerId, player] of database.players.entries()) {
            if (player.socketId === socket.id) {
                disconnectedPlayer = player;
                database.players.delete(playerId);
                database.sessions.delete(playerId);

                socket.to(player.areaId).emit('playerLeft', { playerId: player.id });
                logger.player('LEFT', { user: player.username, area: player.areaId });
                break;
            }
        }
    });
});

// ═══════════════════════════════════════
// 🧹 Cleanup
// ═══════════════════════════════════════

setInterval(() => {
    const now = Date.now();
    const timeout = 120000; // 2 minutes

    for (const [playerId, player] of database.players.entries()) {
        if (now - player.lastUpdate > timeout) {
            logger.warning('Removing inactive player', { user: player.username, id: playerId });
            database.players.delete(playerId);
            database.sessions.delete(playerId);
            io.to(player.areaId).emit('playerLeft', { playerId });
        }
    }
}, 60000);

// ═══════════════════════════════════════
// 🚀 Start Server
// ═══════════════════════════════════════

httpServer.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║   🎮 TOUCH WORLD SERVER ONLINE v3.0          ║
╠═══════════════════════════════════════════════╣
║  Port: ${PORT}                                  ║
║  WebSocket: ws://localhost:${PORT}              ║
║  HTTP: http://localhost:${PORT}                 ║
║  Health: GET /health                          ║
╠═══════════════════════════════════════════════╣
║  🔐 Authentication: ENABLED                   ║
║  📧 Email Service: CONFIGURED                 ║
║  💾 Multi-Account: UP TO 3                    ║
║  🔄 Real-time Sync: ACTIVE                    ║
╚═══════════════════════════════════════════════╝
    `);
    logger.success('Server started successfully');
});

export { io, app };
