// Logger Utility - Advanced Logging System
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// צבעים לקונסול
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
};

// יצירת תיקיית לוגים
const logsDir = './logs';
if (!existsSync(logsDir)) {
    mkdirSync(logsDir);
}

// פונקציה לשמירת לוג לקובץ
function saveToFile(filename, message) {
    const timestamp = new Date().toISOString();
    const logPath = join(logsDir, filename);
    const logMessage = `[${timestamp}] ${message}\n`;
    
    try {
        appendFileSync(logPath, logMessage);
    } catch (error) {
        console.error('Failed to write log to file:', error);
    }
}

// פונקציה לפורמט זמן
function getTimestamp() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
}

export const Logger = {
    // לוג רגיל
    info: (message, data = {}) => {
        const log = `${colors.cyan}ℹ️  [${getTimestamp()}] [INFO]${colors.reset} ${message}`;
        console.log(log, data);
        saveToFile('info.log', `${message} ${JSON.stringify(data)}`);
    },
    
    // הצלחה
    success: (message, data = {}) => {
        const log = `${colors.green}✅ [${getTimestamp()}] [SUCCESS]${colors.reset} ${message}`;
        console.log(log, data);
        saveToFile('info.log', `SUCCESS: ${message} ${JSON.stringify(data)}`);
    },
    
    // אזהרה
    warning: (message, data = {}) => {
        const log = `${colors.yellow}⚠️  [${getTimestamp()}] [WARNING]${colors.reset} ${message}`;
        console.warn(log, data);
        saveToFile('warnings.log', `${message} ${JSON.stringify(data)}`);
    },
    
    // שגיאה
    error: (message, error = null) => {
        const log = `${colors.red}❌ [${getTimestamp()}] [ERROR]${colors.reset} ${message}`;
        console.error(log, error);
        saveToFile('errors.log', `${message} ${error ? error.stack : ''}`);
    },
    
    // פעולות שחקן
    player: (action, data = {}) => {
        const log = `${colors.magenta}👤 [${getTimestamp()}] [PLAYER]${colors.reset} ${action}`;
        console.log(log, data);
        saveToFile('players.log', `${action} - Username: ${data.username || 'N/A'}, Area: ${data.area || 'N/A'}, PlayerID: ${data.playerId || 'N/A'}`);
    },
    
    // מסחר
    trade: (action, data = {}) => {
        const log = `${colors.yellow}🤝 [${getTimestamp()}] [TRADE]${colors.reset} ${action}`;
        console.log(log, data);
        saveToFile('trades.log', `${action} - TradeID: ${data.tradeId || 'N/A'}, Status: ${data.status || 'N/A'}, From: ${data.from || 'N/A'}, To: ${data.to || 'N/A'}`);
    },
    
    // צ'אט
    chat: (username, message, area = 'unknown') => {
        const log = `${colors.cyan}💬 [${getTimestamp()}] [CHAT]${colors.reset} ${colors.bright}${username}${colors.reset} (${area}): ${message}`;
        console.log(log);
        saveToFile('chat.log', `[${area}] ${username}: ${message}`);
    },
    
    // חיבור שחקן
    connection: (action, data = {}) => {
        const log = `${colors.green}🔌 [${getTimestamp()}] [CONNECTION]${colors.reset} ${action}`;
        console.log(log, data);
        saveToFile('connections.log', `${action} - SocketID: ${data.socketId || 'N/A'}, PlayerID: ${data.playerId || 'N/A'}`);
    },
    
    // ניתוק
    disconnection: (data = {}) => {
        const log = `${colors.red}🔌 [${getTimestamp()}] [DISCONNECT]${colors.reset} Player disconnected`;
        console.log(log, data);
        saveToFile('connections.log', `DISCONNECT - Username: ${data.username || 'N/A'}, SocketID: ${data.socketId || 'N/A'}`);
    },
    
    // תנועה (יותר מפורט)
    movement: (username, from, to, area) => {
        const log = `${colors.dim}🚶 [${getTimestamp()}] [MOVE]${colors.reset} ${username} moved in ${area}`;
        console.log(log, { from, to });
        saveToFile('movements.log', `${username} - Area: ${area}, From: (${from.x}, ${from.y}), To: (${to.x}, ${to.y})`);
    },
    
    // מתנות
    gift: (action, data = {}) => {
        const log = `${colors.magenta}🎁 [${getTimestamp()}] [GIFT]${colors.reset} ${action}`;
        console.log(log, data);
        saveToFile('gifts.log', `${action} - From: ${data.from || 'N/A'}, To: ${data.to || 'N/A'}, Items: ${JSON.stringify(data.items || [])}`);
    },
    
    // אבטחה
    security: (event, data = {}) => {
        const log = `${colors.bgRed}${colors.white}🛡️  [${getTimestamp()}] [SECURITY]${colors.reset} ${event}`;
        console.log(log, data);
        saveToFile('security.log', `${event} - ${JSON.stringify(data)}`);
    },
    
    // סטטיסטיקות
    stats: (message, data = {}) => {
        const log = `${colors.blue}📊 [${getTimestamp()}] [STATS]${colors.reset} ${message}`;
        console.log(log, data);
        saveToFile('stats.log', `${message} - ${JSON.stringify(data)}`);
    },
    
    // הדפסת קו מפריד
    separator: () => {
        console.log(`${colors.dim}${'─'.repeat(80)}${colors.reset}`);
    },
    
    // הדפסת כותרת
    header: (title) => {
        console.log(`\n${colors.bright}${colors.cyan}╔${'═'.repeat(78)}╗${colors.reset}`);
        console.log(`${colors.bright}${colors.cyan}║${colors.reset} ${title.padEnd(76)} ${colors.bright}${colors.cyan}║${colors.reset}`);
        console.log(`${colors.bright}${colors.cyan}╚${'═'.repeat(78)}╝${colors.reset}\n`);
    }
};
