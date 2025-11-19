// ============================================================================
// DONUT SYSTEM MANAGER — Smooth Random Spawning (10–40s intervals)
// ============================================================================

const fetch = require("node-fetch");

const MAX_DONUTS_PER_AREA = 8;
const MIN_INTERVAL = 10000;  // 10 seconds
const MAX_INTERVAL = 40000;  // 40 seconds

let BASE44_SERVICE_KEY;
let BASE44_API_URL;
let io;

// ============================================================================
// BASE44 API HELPER
// ============================================================================

async function apiCall(endpoint, method = "GET", body = null) {
    try {
        const url = `${BASE44_API_URL}${endpoint}`;
        const opts = {
            method,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${BASE44_SERVICE_KEY}`
            }
        };

        if (body) opts.body = JSON.stringify(body);

        const res = await fetch(url, opts);

        if (!res.ok) {
            if (res.status === 404) return null;
            throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }

        return await res.json();

    } catch (err) {
        console.error(`❌ API Error ${endpoint}:`, err.message);
        return null;
    }
}

// ============================================================================
// POSITION VALIDATION
// ============================================================================
function isPositionBlocked(x, y, collisionMap) {
    if (!collisionMap) return false;

    for (const shape of collisionMap) {
        if (!shape) continue;
        if (
            x >= shape.x &&
            x <= shape.x + shape.width &&
            y >= shape.y &&
            y <= shape.y + shape.height
        ) {
            return true;
        }
    }
    return false;
}

// ============================================================================
// SPAWN DONUT
// ============================================================================
async function spawnDonutInArea(area, templates) {
    if (!templates || templates.length === 0) return;

    // Collision map
    let collisionMap = [];
    try {
        if (area.collision_map) {
            collisionMap = typeof area.collision_map === "string"
                ? JSON.parse(area.collision_map)
                : area.collision_map;
        }
    } catch (e) {}

    const MAP_WIDTH = 1380;
    const MAP_HEIGHT = 770;
    const PADDING = 100;

    let pos = null;

    for (let i = 0; i < 20; i++) {
        const x = PADDING + Math.random() * (MAP_WIDTH - PADDING * 2);
        const y = PADDING + Math.random() * (MAP_HEIGHT - PADDING * 2);

        if (!isPositionBlocked(x, y, collisionMap)) {
            pos = { x: Math.round(x), y: Math.round(y) };
            break;
        }
    }

    if (!pos) return;

    const template = templates[Math.floor(Math.random() * templates.length)];

    const spawnData = {
        area_id: area.area_id,
        version_name: area.version_name,
        spawn_id: `donut_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        collectible_type: template.name || "donut",
        collectible_name: template.name || "donut",
        position_x: pos.x,
        position_y: pos.y,
        image_url: template.image_url,
        scale: template.scale || 1,
        is_collected: false
    };

    const created = await apiCall("/entities/DonutSpawn", "POST", spawnData);

    if (created) {
        console.log(
            `🍩 Spawned donut at ${area.area_id} (${created.position_x},${created.position_y})`
        );
        io.to(area.area_id).emit("donut_spawned", {
            area_id: area.area_id,
            spawn: created
        });
    }
}

// ============================================================================
// MAIN LOGIC — ONE DONUT PER CHECK
// ============================================================================
async function maintainDonuts() {
    const areas = await apiCall("/entities/Area");
    if (!areas) return;

    const allSpawns = await apiCall("/entities/DonutSpawn") || [];

    // Keep only ACTIVE version of each area
    const activeConfig = new Map();
    for (const a of areas) {
        if (a.is_active) activeConfig.set(a.area_id, a);
    }

    const areaIds = new Set([
        ...activeConfig.keys(),
        ...allSpawns.map(s => s.area_id)
    ]);

    for (const areaId of areaIds) {
        const area = activeConfig.get(areaId);
        const areaSpawns = allSpawns.filter(s => s.area_id === areaId);

        let templates = [];

        if (area) {
            try {
                const dec = typeof area.decorations === "string"
                    ? JSON.parse(area.decorations)
                    : area.decorations;

                if (Array.isArray(dec)) {
                    templates = dec.filter(d => d.action_type === "donut_system");
                }
            } catch (e) {}
        }

        const versionSpawns = areaSpawns.filter(
            s => !area || s.version_name === area.version_name
        );

        // No decorations → clean all donuts in that area/version
        if (templates.length === 0) {
            for (const spawn of versionSpawns) {
                await apiCall("/entities/DonutSpawn", "DELETE", { id: spawn.id });
                io.to(areaId).emit("donut_collected", {
                    area_id: areaId,
                    spawn_id: spawn.spawn_id,
                    collected_by_player_id: "system"
                });
            }
            continue;
        }

        // Count valid donuts
        let valid = 0;

        for (const spawn of versionSpawns) {
            const ok = templates.some(t =>
                t.image_url === spawn.image_url &&
                (t.name || "donut") === spawn.collectible_type
            );

            if (!ok) {
                await apiCall("/entities/DonutSpawn", "DELETE", { id: spawn.id });
                io.to(areaId).emit("donut_collected", {
                    area_id: areaId,
                    spawn_id: spawn.spawn_id,
                    collected_by_player_id: "system"
                });
            } else {
                valid++;
            }
        }

        // Missing donuts? → spawn ONE ONLY
        if (valid < MAX_DONUTS_PER_AREA) {
            await spawnDonutInArea(area, templates);
        }
    }
}

// ============================================================================
// RANDOM LOOP
// ============================================================================
function scheduleNextSpawn() {
    const delay = Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1)) + MIN_INTERVAL;

    setTimeout(async () => {
        await maintainDonuts();
        scheduleNextSpawn(); // continue loop
    }, delay);
}

// ============================================================================
// INITIALIZER
// ============================================================================
function initialize(socketIo, serviceKey, apiUrl) {
    io = socketIo;
    BASE44_SERVICE_KEY = serviceKey;
    BASE44_API_URL = apiUrl;

    console.log("🍩 Donut Manager Loaded (random 10–40s spawn mode)");
    scheduleNextSpawn();
}

// ============================================================================
// SOCKET EVENTS (COLLECTION)
// ============================================================================
function setupSocketHandlers(socket, players) {
    socket.on("client_collected_donut", data => {
        const p = players.get(socket.id);
        if (!p) return;

        if (p.current_area !== data.area_id) return;

        socket.to(p.current_area).emit("donut_collected", {
            area_id: p.current_area,
            spawn_id: data.spawn_id,
            collected_by_player_id: p.playerId
        });
    });
}

module.exports = {
    initialize,
    setupSocketHandlers
};
