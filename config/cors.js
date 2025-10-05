// 🔧 CORS Configuration
export const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://preview--copy-565f73e8.base44.app',
    'https://copy-565f73e8.base44.app',
    'https://base44.app',
    /\.base44\.app$/
];

export const corsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        
        const isAllowed = allowedOrigins.some(allowed =>
            typeof allowed === 'string' ? allowed === origin : allowed.test(origin)
        );
        
        if (isAllowed) {
            callback(null, true);
        } else {
            console.warn('⚠️  CORS blocked:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
};
