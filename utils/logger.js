// Logger Utility

export const Logger = {
    info: (message, data = {}) => {
        console.log(`ℹ️  [INFO] ${message}`, data);
    },
    
    success: (message, data = {}) => {
        console.log(`✅ [SUCCESS] ${message}`, data);
    },
    
    warning: (message, data = {}) => {
        console.warn(`⚠️  [WARNING] ${message}`, data);
    },
    
    error: (message, error = null) => {
        console.error(`❌ [ERROR] ${message}`, error);
    },
    
    player: (action, data = {}) => {
        console.log(`👤 [PLAYER] ${action}`, data);
    },
    
    trade: (action, data = {}) => {
        console.log(`🤝 [TRADE] ${action}`, data);
    },
    
    chat: (username, message) => {
        console.log(`💬 [CHAT] ${username}: ${message}`);
    }
};
