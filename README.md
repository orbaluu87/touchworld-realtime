# 🌍 Touch World Realtime Server v2

גרסה משופרת של שרת Socket.IO לעולם Touch World.

## 📦 התקנה מקומית
```bash
npm install
npm start
```

השרת יעלה בכתובת:
```
http://localhost:3000
```

---

## 🚀 העלאה ל-Render

1. היכנס ל-[render.com](https://render.com)
2. לחץ **New → Web Service**
3. חבר את ה-GitHub שלך
4. העלה את הקבצים האלו (server.js + package.json + README.md)
5. בחר:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
6. לחץ **Create Web Service**
7. כשתקבל "Live", השרת שלך יהיה זמין ב:
```
https://touchworld-realtime.onrender.com
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
