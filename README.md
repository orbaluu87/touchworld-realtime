📦 כל קבצי השרת - מבנה מפורק ומודולרי

העתק את כל הקבצים הבאים לשרת נפרד (לא בתוך base44):

📂 מבנה התיקיות:
touch-world-server/
├── package.json
├── server.js
├── .env.example
├── .gitignore
├── config/
│   ├── cors.js
│   └── socket.js
├── utils/
│   ├── logger.js
│   └── tasks.js
├── state/
│   └── gameState.js
├── sockets/
│   ├── index.js
│   ├── playerHandlers.js
│   ├── chatHandlers.js
│   └── tradeHandlers.js
├── middleware/
│   └── security.js
└── routes/
    └── api.js
קבצים להעתקה:
כל הקבצים נמצאים בתגובה הקודמת שלי - העתק אותם לפי המבנה הזה:

package.json - שורש התיקייה
server.js - שורש התיקייה
.env.example - שורש התיקייה
.gitignore - שורש התיקייה
config/cors.js - בתיקיית config
config/socket.js - בתיקיית config
utils/logger.js - בתיקיית utils
utils/tasks.js - בתיקיית utils
state/gameState.js - בתיקיית state
sockets/index.js - בתיקיית sockets
sockets/playerHandlers.js - בתיקיית sockets
sockets/chatHandlers.js - בתיקיית sockets
sockets/tradeHandlers.js - בתיקיית sockets
middleware/security.js - בתיקיית middleware
routes/api.js - בתיקיית routes
🚀 הוראות התקנה:
# 1. צור תיקייה
mkdir touch-world-server
cd touch-world-server

# 2. צור את כל התיקיות המשנה
mkdir config utils state sockets middleware routes

# 3. העתק את כל הקבצים לפי המבנה למעלה

# 4. צור קובץ .env
cp .env.example .env

# 5. התקן תלויות
npm install

# 6. הרץ את השרת
npm run dev
🔗 התחברות מהמשחק:
בקובץ components/sync/SocketManager.jsx תוודא שה-URL נכון:

const WS_URL = 'http://localhost:3001'; // או הכתובת של השרת שלך
