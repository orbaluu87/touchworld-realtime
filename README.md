# Touch World Server

## התקנה

```bash
npm install
הרצה
npm start
מבנה תיקיות
touch-world-server/
├── server.js              # קובץ ראשי
├── package.json           # הגדרות NPM
├── config/
│   └── cors.js           # הגדרות CORS
├── state/
│   └── gameState.js      # ניהול מצב המשחק
├── sockets/
│   ├── playerHandlers.js # אירועי שחקנים
│   ├── chatHandlers.js   # אירועי צ'אט
│   └── tradeHandlers.js  # אירועי מסחר
├── routes/
│   └── apiRoutes.js      # API endpoints
└── utils/
    └── logger.js         # מערכת לוגים
פורטים
HTTP: 3000
WebSocket: 3000
בדיקות
Health Check: http://localhost:3000/health
Statistics: http://localhost:3000/stats

---

## 📂 מבנה תיקיות לשרת:

touch-world-server/ ├── package.json ├── server.js ├── README.md ├── config/ │ └── cors.js ├── state/ │ └── gameState.js ├── sockets/ │ ├── playerHandlers.js │ ├── chatHandlers.js │ └── tradeHandlers.js ├── routes/ │ └── apiRoutes.js └── utils/ └── logger.js


## 🚀 הוראות הפעלה:

1. צור תיקייה בשם `touch-world-server`
2. העתק את כל הקבצים למקום המתאים
3. הרץ:
```bash
npm install
npm start
השרת מוכן לעבודה! 🎮
```

---

## 💬 בדיקה
פתח:
```
https://touchworld-realtime.onrender.com/socket.io/?EIO=4&transport=polling
```
אם אתה רואה תגובה (טקסט מוזר) → זה תקין ✅

---

## ⚙️ חיבור ל-Base44
בצד הלקוח:
```js
import { io } from "socket.io-client";
const socket = io("https://touchworld-realtime.onrender.com", {
  transports: ["websocket", "polling"]
});
```
















באופן ישיר בקונסול:
npm start
עם צבעים וסינון:
# כל הלוגים
npm start

# רק שחקנים
npm start | grep "PLAYER"

# רק צ'אט
npm start | grep "CHAT"

# רק מסחר
npm start | grep "TRADE"

# רק שגיאות
npm start | grep "ERROR"
צפייה בקבצי לוגים:
# צ'אט בזמן אמת
tail -f logs/chat.log

# שחקנים בזמן אמת
tail -f logs/players.log

# מסחר
tail -f logs/trades.log

# שגיאות
tail -f logs/errors.log

# כל הלוגים ביחד
tail -f logs/*.log
📁 קבצי הלוגים שיווצרו:
logs/
├── chat.log          # כל הודעות הצ'אט
├── players.log       # פעילות שחקנים
├── trades.log        # עסקאות מסחר
├── movements.log     # תנועות שחקנים
├── gifts.log         # מתנות
├── connections.log   # חיבורים וניתוקים
├── security.log      # אירועי אבטחה
├── warnings.log      # אזהרות
├── errors.log        # שגיאות
├── stats.log         # סטטיסטיקות
└── info.log          # מידע כללי
🎯 מה תראה בקונסול:
╔══════════════════════════════════════════════════════════════════════════════╗
║ TOUCH WORLD SERVER STARTED                                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝

✅ [14:23:15] [SUCCESS] Server is running { port: 3000, environment: 'development' }
ℹ️  [14:23:15] [INFO] Endpoints available { health: 'http://localhost:3000/health' }
────────────────────────────────────────────────────────────────────────────────

🔌 [14:23:20] [CONNECTION] NEW CONNECTION { socketId: 'abc123', totalConnections: 1 }
👤 [14:23:21] [PLAYER] JOINED GAME { username: 'שחקן1', area: 'city', adminLevel: 'user' }
💬 [14:23:25] [CHAT] שחקן1 (city): שלום לכולם!
🚶 [14:23:30] [MOVE] שחקן1 moved in city { from: { x: 100, y: 200 }, to: { x: 150, y: 220 } }
👤 [14:23:35] [PLAYER] CHANGED AREA { username: 'שחקן1', from: 'city', to: 'arcade' }
🤝 [14:24:00] [TRADE] REQUEST SENT { from: 'שחקן1', to: 'שחקן2', tradeId: 'trade_123' }
🤝 [14:24:15] [TRADE] COMPLETED { tradeId: 'trade_123' }
✅ [14:24:15] [SUCCESS] Trade successful

📊 [14:28:00] [STATS] Active players { count: 5 }
────────────────────────────────────────────────────────────────────────────────
עכשיו יש לך מעקב מלא על כל מה שקורה במשחק! 🎮📊
