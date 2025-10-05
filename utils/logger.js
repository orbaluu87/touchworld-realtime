// 📝 Logger Utility
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

export const logger = {
    info: (msg, data = '') => {
        console.log(`${colors.cyan}ℹ️  [${timestamp()}] [INFO]${colors.reset} ${msg}`, data);
    },
    
    success: (msg, data = '') => {
        console.log(`${colors.green}✅ [${timestamp()}] [SUCCESS]${colors.reset} ${msg}`, data);
    },
    
    warning: (msg, data = '') => {
        console.warn(`${colors.yellow}⚠️  [${timestamp()}] [WARN]${colors.reset} ${msg}`, data);
    },
    
    error: (msg, err = '') => {
        console.error(`${colors.red}❌ [${timestamp()}] [ERROR]${colors.reset} ${msg}`, err);
    },
    
    player: (action, data = '') => {
        console.log(`${colors.magenta}👤 [${timestamp()}] [PLAYER]${colors.reset} ${action}`, data);
    },
    
    chat: (user, msg, area) => {
        console.log(`${colors.cyan}💬 [${timestamp()}] [CHAT]${colors.reset} ${colors.bright}${user}${colors.reset} (${area}): ${msg}`);
    },
    
    trade: (action, data = '') => {
        console.log(`${colors.yellow}🤝 [${timestamp()}] [TRADE]${colors.reset} ${action}`, data);
    },
    
    connection: (action, data = '') => {
        console.log(`${colors.green}🔌 [${timestamp()}] [CONNECT]${colors.reset} ${action}`, data);
    }
};
