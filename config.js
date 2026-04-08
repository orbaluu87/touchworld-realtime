// ============================================================================
// Touch World - Configuration & Environment Variables
// ============================================================================

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const JWT_SECRET = process.env.JWT_SECRET;
const VERIFY_TOKEN_URL =
  process.env.VERIFY_TOKEN_URL ||
  "https://touch-world.online/api/functions/verifyWebSocketToken";
const BASE44_SERVICE_KEY = process.env.BASE44_SERVICE_KEY;
const BASE44_API_URL =
  process.env.BASE44_API_URL ||
  "https://touch-world.online/api";
const HEALTH_KEY = process.env.HEALTH_KEY || "secret-health";

if (!JWT_SECRET || !BASE44_SERVICE_KEY || !HEALTH_KEY) {
  console.error("❌ Missing security keys");
  throw new Error("Missing security keys");
}

const VERSION = "11.11.0";
const PORT = process.env.PORT || 10000;
const KEEP_AWAY_RADIUS = 200;

module.exports = {
  allowedOrigins,
  JWT_SECRET,
  VERIFY_TOKEN_URL,
  BASE44_SERVICE_KEY,
  BASE44_API_URL,
  HEALTH_KEY,
  VERSION,
  PORT,
  KEEP_AWAY_RADIUS,
};
