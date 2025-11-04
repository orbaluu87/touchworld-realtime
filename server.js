import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const httpServer = createServer(app);

// --- הגדרות Socket.IO ---
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(",") || ["*"],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e8,
});

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.WSS_JWT_SECRET;
const SHARED_SECRET_KEY = process.env.SHARED_SECRET_KEY;
const HEALTH_KEY = process.env.HEALTH_KEY;

// בדיקה ראשונית
if (!JWT_SECRET || !process.env.BASE44_SERVICE_KEY) {
  console.error("❌ חסרים משתני סביבה קריטיים (.env)!");
  process.exit(1);
}

console.log("✅ TouchWorld Realtime Server מחובר בהצלחה!");
console.log("🌍 רץ על פורט:", PORT);

// =========================
//  מבנה נתונים
// =========================
const connectedPlayers = new Map();
const connectionCounts = new Map();

// =========================
//  הגדרות Middleware
// =========================
app.use(express.json());
app.use(cors());

// =========================
//  Endpoint בריאות השרת
// =========================
app.get("/health", (req, res) => {
  const key = req.query.key;
  if (key !== HEALTH_KEY)
    return res.status(403).json({ status: "forbidden" });
  res.json({ status: "ok", uptime: process.uptime() });
});

// =========================
//  Proxy מאובטח ל-Base44
// =========================
app.get("/api/player", async (req, res) => {
  try {
    const url = `${process.env.BASE44_API_URL}/entities/Player`;
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${process.env.BASE44_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("❌ שגיאה בשליפת נתוני Player:", err);
    res.status(500).json({ error: "Failed to fetch Player data" });
  }
});

// =========================
//  אימות WebSocket (JWT)
// =========================
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("Authentication error: Missing token"));
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    console.error("❌ Invalid JWT:", err.message);
    next(new Error("Authentication error: Invalid token"));
  }
});

// =========================
//  Socket.IO לוגיקה
// =========================
io.on("connection", (socket) => {
  const user = socket.user || { username: "Unknown" };
  console.log(`👤 ${user.username} התחבר`);

  connectedPlayers.set(user.username, socket);

  // תנועת שחקן
  socket.on("playerMove", (data) => {
    socket.broadcast.emit("playerMove", {
      username: user.username,
      ...data,
    });
  });

  // הודעות צ'אט
  socket.on("chatMessage", (msg) => {
    if (typeof msg === "string" && msg.trim() !== "") {
      io.emit("chatMessage", {
        username: user.username,
        message: msg.trim(),
      });
    }
  });

  // ניתוק
  socket.on("disconnect", () => {
    connectedPlayers.delete(user.username);
    socket.broadcast.emit("playerDisconnect", user.username);
    console.log(`❌ ${user.username} התנתק`);
  });
});

// =========================
//  הרצת השרת
// =========================
httpServer.listen(PORT, () => {
  console.log(`🚀 Server Online at: https://touchworld-realtime.onrender.com`);
});
