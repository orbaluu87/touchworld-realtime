// ============================================================================
// DONUT SYSTEM MANAGER (Simplified & Robust)
// ============================================================================

const fetch = require("node-fetch");

const MAX_DONUTS_PER_AREA = 50;
const MIN_INTERVAL = 2000; // 2 seconds
const MAX_INTERVAL = 6000; // 6 seconds

let BASE44_SERVICE_KEY;
let BASE44_API_URL;
let io;

// IN-MEMORY STORAGE (No DB persistence for spawns)
const ACTIVE_DONUTS = new Map(); // spawn_id -> donut object

// Export for server usage
module.exports.getDonutsForArea = (areaId) => {
    const list = [];
    for (const donut of ACTIVE_DONUTS.values()) {
        if (donut.area_id === areaId) {
            list.push(donut);
        }
    }
    return list;
};

// --- Helper Functions ---

async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const url = `${BASE44_API_URL}${endpoint}`;
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            }
        };
        if (body) options.body = JSON.stringify(body);
        
        const res = await fetch(url, options);
        if (!res.ok) {
            // Handle 404s silently if needed
            if (res.status === 404) return null;
            const text = await res.text();
            throw new Error(`API Error ${res.status}: ${text}`);
        }
        return await res.json();
    } catch (err) {
        console.error(`❌ DonutManager API Error [${endpoint}]:`, err.message);
        return null;
    }
}

function isPositionBlocked(x, y, collisionMap) {
    if (!collisionMap || !Array.isArray(collisionMap) || collisionMap.length === 0) return false;
    
    for (const shape of collisionMap) {
        if (!shape) continue;
        
        if (typeof shape.x === 'number' && typeof shape.y === 'number' && 
            typeof shape.width === 'number' && typeof shape.height === 'number') {
            
            if (x >= shape.x && x <= shape.x + shape.width &&
                y >= shape.y && y <= shape.y + shape.height) {
                return true;
            }
        }
    }
    return false;
}

async function spawnDonutInArea(area, templates) {
    if (!templates || templates.length === 0) return;

    // 2. Get collision map
    let collisionMap = [];
    try {
        if (area.collision_map) {
            collisionMap = typeof area.collision_map === 'string' ? JSON.parse(area.collision_map) : area.collision_map;
        }
    } catch (e) {}

    // 3. Find position
    let pos = null;
    const PADDING = 100;
    const MAP_WIDTH = 1380;
    const MAP_HEIGHT = 770;

    for (let i = 0; i < 20; i++) {
        const x = PADDING + Math.floor(Math.random() * (MAP_WIDTH - (PADDING * 2)));
        const y = PADDING + Math.floor(Math.random() * (MAP_HEIGHT - (PADDING * 2)));
        
        if (!isPositionBlocked(x, y, collisionMap)) {
            pos = { x, y };
            break;
        }
    }

    if (!pos) return;

    // 4. Create IN MEMORY
    const template = templates[Math.floor(Math.random() * templates.length)];

    const spawnData = {
    area_id: area.area_id,
    version_name: area.version_name,
    spawn_id: `donut_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    collectible_type: template.name || 'donut',
    collectible_name: template.name || 'donut',
    position_x: Math.round(pos.x),
    position_y: Math.round(pos.y),
    image_url: template.image_url,
    scale: template.scale || 1,
    created_at: Date.now()
    };

    ACTIVE_DONUTS.set(spawnData.spawn_id, spawnData);

    console.log(`🍩 [SPAWN] Area: ${area.area_id} | Type: ${spawnData.collectible_type} | Pos: (${spawnData.position_x}, ${spawnData.position_y})`);

    const payload = { 
    area_id: area.area_id, 
    spawn: spawnData 
    };

    const cache = module.exports.areaRoomsCache;

    // Broadcast to all linked rooms
    if (cache && cache.has(area.area_id)) {
    const rooms = cache.get(area.area_id);
    for (const room of rooms) {
        io.to(room).emit('donut_spawned', payload);
    }
    } else {
    // Fallback
    io.to(area.area_id).emit('donut_spawned', payload);
    if (area.id && area.id !== area.area_id) {
        io.to(area.id).emit('donut_spawned', payload);
    }
    }
}

async function maintainDonuts() {
    const areas = await apiCall('/entities/Area');
    if (!areas || !Array.isArray(areas)) return;

    // Group by area_id: ACTIVE areas take precedence.
    const activeAreaConfig = new Map();
    
    for (const area of areas) {
        if (area.is_active) {
            activeAreaConfig.set(area.area_id, area);
        }
    }
    
    // Populate cache for broadcasting (Bidirectional mapping)
    if (activeAreaConfig.size > 0) {
        const newCache = new Map();
        for (const area of activeAreaConfig.values()) {
            const rooms = [area.area_id];
            if (area.id && area.id !== area.area_id) {
                rooms.push(area.id);
            }
            
            for (const roomId of rooms) {
                newCache.set(roomId, rooms);
            }
        }
        module.exports.areaRoomsCache = newCache;
    }

    for (const [areaId, area] of activeAreaConfig.entries()) {
        // 1. Parse templates
        let templates = [];
        try {
            if (area.decorations) {
                const decos = typeof area.decorations === 'string' ? JSON.parse(area.decorations) : area.decorations;
                if (Array.isArray(decos)) {
                    templates = decos.filter(d => d.action_type === 'donut_system');
                }
            }
        } catch (e) {
            console.error(`Error parsing decorations for area ${area.area_id}`, e);
        }

        if (templates.length === 0) continue;

        // 2. Get current donuts from MEMORY
        const areaDonuts = [];
        for (const d of ACTIVE_DONUTS.values()) {
            if (d.area_id === areaId) areaDonuts.push(d);
        }
        
        // 3. Recycle if needed
        if (areaDonuts.length >= MAX_DONUTS_PER_AREA) {
            // Find oldest (simple sort)
            areaDonuts.sort((a, b) => a.created_at - b.created_at);
            const oldest = areaDonuts[0];
            
            // Remove from Memory
            ACTIVE_DONUTS.delete(oldest.spawn_id);
            
            // Notify clients
            const payload = { 
                spawn_id: oldest.spawn_id, 
                area_id: areaId, 
                collected_by_player_id: 'system' 
            };
            
            const cache = module.exports.areaRoomsCache;
            if (cache && cache.has(areaId)) {
                const rooms = cache.get(areaId);
                for (const room of rooms) {
                    io.to(room).emit('donut_collected', payload);
                }
            } else {
                io.to(areaId).emit('donut_collected', payload);
            }
        }

        // 4. Always spawn a new one
        await spawnDonutInArea(area, templates);
    }
}

function initialize(socketIo, serviceKey, apiUrl) {
    io = socketIo;
    BASE44_SERVICE_KEY = serviceKey;
    BASE44_API_URL = apiUrl;

    console.log('🍩 Donut System Manager - Random Interval Mode Active');
    
    // Start the random loop
    scheduleNextSpawn();
}

function scheduleNextSpawn() {
    const delay = Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1)) + MIN_INTERVAL;
    console.log(`⏰ Donut Cycle: Ticking in ${delay}ms...`);

    setTimeout(async () => {
        try {
            await maintainDonuts();
        } catch (err) {
            console.error("❌ Error in donut maintenance loop:", err);
        }
        scheduleNextSpawn();
    }, delay);
}

function setupSocketHandlers(socket, players) {
    // Handle real-time collection events
    socket.on('client_collected_donut', async (data) => {
        const p = players.get(socket.id);
        if (!p) return;

        const { spawn_id, area_id } = data;

        // 1. Verify in MEMORY
        if (!ACTIVE_DONUTS.has(spawn_id)) {
            return; // Already collected or doesn't exist
        }

        const donut = ACTIVE_DONUTS.get(spawn_id);

        // 2. Remove from MEMORY
        ACTIVE_DONUTS.delete(spawn_id);

        // 3. Reward Player (API Call)
        try {
            // Check if counter exists
            const counters = await apiCall(`/entities/CollectibleCounter?query=${JSON.stringify({
                player_id: p.playerId,
                collectible_type: donut.collectible_type
            })}`);
            
            if (counters && counters.length > 0) {
                // Update
                await apiCall(`/entities/CollectibleCounter/${counters[0].id}`, 'PATCH', {
                    quantity: counters[0].quantity + 1
                });
            } else {
                // Create
                await apiCall(`/entities/CollectibleCounter`, 'POST', {
                    player_id: p.playerId,
                    collectible_type: donut.collectible_type,
                    collectible_name: donut.collectible_name || donut.collectible_type,
                    collectible_image: donut.image_url,
                    quantity: 1
                });
            }
            
            // Notify success
            socket.emit('collect_success', { type: donut.collectible_type });
            
        } catch (dbErr) {
            console.error("Failed to reward player:", dbErr);
        }

        // 4. Broadcast removal
        const payload = {
            area_id: donut.area_id,
            spawn_id: spawn_id,
            collected_by_player_id: p.playerId
        };

        const cache = module.exports.areaRoomsCache;
        const lookupKey = cache && cache.has(p.current_area) ? p.current_area : donut.area_id;
        
        if (cache && cache.has(lookupKey)) {
            const rooms = cache.get(lookupKey);
            for (const room of rooms) {
                io.to(room).emit('donut_collected', payload);
            }
        } else {
            io.to(donut.area_id).emit('donut_collected', payload);
        }
    });
}

module.exports = {
    initialize,
    setupSocketHandlers
};
