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
