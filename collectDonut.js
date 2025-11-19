// ============================================================================
// Touch World - Donut Auto-Spawn System (Hanukkah Event)
// Creates random donut spawns every X seconds for each area.
// ============================================================================

require("dotenv").config();
const fetch = require("node-fetch");

// ---------- CONFIG ----------
const SERVER_URL = process.env.SERVER_URL; // לדוגמה: https://touchworld-realtime.onrender.com
const HEALTH_KEY = process.env.HEALTH_KEY;

// כל כמה זמן לייצר סופגניה (טווח רנדומלי)
const MIN_INTERVAL = 6000;  // 6 שניות
const MAX_INTERVAL = 10000; // 10 שניות

// רשימת אזורים – אתה יכול לערוך
const AREAS = [
  "beach",
  "hanukkah_square",
  "city_center",
  "winter_forest"
];

// טווח מיקומים למפה (עורך אזורים → גודל איזור)
const POSITION = {
  minX: 100,
  maxX: 1700,
  minY: 100,
  maxY: 900
};

// ---------- HELPERS ----------
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay() {
  return randomInt(MIN_INTERVAL, MAX_INTERVAL);
}

function generateSpawn(areaId) {
  return {
    spawn_id: "donut_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    x: randomInt(POSITION.minX, POSITION.maxX),
    y: randomInt(POSITION.minY, POSITION.maxY),
    area_id: areaId,
    created_at: Date.now()
  };
}

// ---------- MAIN LOOP ----------
async function spawnDonut(areaId) {
  const spawn = generateSpawn(areaId);

  console.log(`🍩 Spawning donut in ${areaId}: ${spawn.spawn_id} (${spawn.x}, ${spawn.y})`);

  try {
    await fetch(`${SERVER_URL}/broadcast-donut-respawn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-health-key": HEALTH_KEY
      },
      body: JSON.stringify({
        area_id: areaId,
        spawn
      })
    });

    console.log(`✅ Sent to server: donut_respawned → ${areaId}`);
  } catch (err) {
    console.error(`❌ Failed to notify server:`, err);
  }
}

function scheduleNext(areaId) {
  const delay = randomDelay();
  setTimeout(async () => {
    await spawnDonut(areaId);
    scheduleNext(areaId);
  }, delay);
}

// ---------- START ----------
console.log("🍩 Donut Auto-Spawn System Started!");

for (const area of AREAS) {
  console.log(`➡ Starting auto-spawn for area: ${area}`);
  scheduleNext(area);
}
