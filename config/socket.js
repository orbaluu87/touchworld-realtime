// 🔌 Socket.IO Configuration
export const socketConfig = (corsOptions) => ({
    cors: corsOptions,
    pingTimeout: 60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
    allowEIO3: true,
    maxHttpBufferSize: 1e6, // 1MB
    perMessageDeflate: true
});
