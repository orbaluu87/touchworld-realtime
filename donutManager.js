// ============================================================================
// DONUT SYSTEM MANAGER (In-Memory & Fast)
// ============================================================================

const fetch = require("node-fetch");

const MAX_DONUTS_PER_AREA = 8;
const MIN_INTERVAL = 2000; // 2 seconds
const MAX_INTERVAL = 5000; // 5 seconds

let BASE44_SERVICE_KEY;
let BASE44_API_URL;
let io;

// IN-MEMORY STORAGE
// Map<area_id, Map<spawn_id, donut_data>>
const activeSpawns = new Map();

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
            if (res.status === 404) return null;
            // Ignore errors silently to keep log clean
            return null; 
        }
        return await res.json();
    } catch (err) {
        console.error(`❌ API Error [${endpoint}]:`, err.message);
        return null;
    }
}

// Helper to update user counter via API
async function giveRewardToPlayer(playerId, collectibleType, collectibleName, imageUrl) {
    try {
        // We need to find if counter exists, then update or create
        // Since we are in a raw node process, we use the REST API
        
        // 1. List counters for player & type
        const query = JSON.stringify({ player_id: playerId, collectible_type: collectibleType });
        const counters = await apiCall(`/entities/CollectibleCounter?query=${encodeURIComponent(query)}`);
        
        if (counters && counters.length > 0) {
            // Update
            const counter = counters[0];
            await apiCall(`/entities/CollectibleCounter`, 'PATCH', {
                query: { id: counter.id },
                data: { quantity: (counter.quantity || 0) + 1 }
            });
        } else {
            // Create
            await apiCall('/entities/CollectibleCounter', 'POST', [{
                player_id: playerId,
                collectible_type: collectibleType,
                collectible_name: collectibleName,
                collectible_image: imageUrl,
                quantity: 1
            }]);
        }
        return true;
    } catch (err) {
        console.error("Error giving reward:", err);
        return false;
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

function getAreaSpawns(areaId) {
    if (!activeSpawns.has(areaId)) {
        activeSpawns.set(areaId, new Map());
    }
    return activeSpawns.get(areaId);
}

function createDonutInMemory(area, templates) {
    const areaSpawns = getAreaSpawns(area.area_id);
    
    // 1. Get collision map
    let collisionMap = [];
    try {
        if (area.collision_map) {
            collisionMap = typeof area.collision_map === 'string' ? JSON.parse(area.collision_map) : area.collision_map;
        }
    } catch (e) {}

    // 2. Find position
    let pos = null;
    const PADDING = 100;
    const MAP_WIDTH = 1380;
    const MAP_HEIGHT = 770;

    // Increased attempts to ensure we find a spot
    for (let i = 0; i < 50; i++) {
        const x = PADDING + Math.floor(Math.random() * (MAP_WIDTH - (PADDING * 2)));
        const y = PADDING + Math.floor(Math.random() * (MAP_HEIGHT - (PADDING * 2)));
        
        if (!isPositionBlocked(x, y, collisionMap)) {
            pos = { x, y };
            break;
        }
    }

    if (!pos) return false;

    // 3. Create Object
    const template = templates[Math.floor(Math.random() * templates.length)];
    const spawnId = `donut_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const donutData = {
        area_id: area.area_id,
        version_name: area.version_name,
        spawn_id: spawnId,
        collectible_type: template.name || 'donut',
        collectible_name: template.name || 'donut',
        position_x: Math.round(pos.x),
        position_y: Math.round(pos.y),
        image_url: template.image_url,
        scale: template.scale || 1,
        created_at: Date.now()
    };

    // 4. Save to Memory
    areaSpawns.set(spawnId, donutData);

    // 5. Emit
    io.to(area.area_id).emit('donut_spawned', {
        area_id: area.area_id,
        spawn: donutData
    });
    
    return true;
}

async function maintainDonuts() {
    // Fetch areas to know active configs
    const areas = await apiCall('/entities/Area');
    if (!areas || !Array.isArray(areas)) return;

    const activeAreas = areas.filter(a => a.is_active);

    for (const area of activeAreas) {
        const areaSpawns = getAreaSpawns(area.area_id);
        
        // Filter out spawns from old versions if version changed
        for (const [id, donut] of areaSpawns.entries()) {
            if (donut.version_name !== area.version_name) {
                areaSpawns.delete(id);
            }
        }

        // Get templates
        let templates = [];
        try {
            if (area.decorations) {
                const decos = typeof area.decorations === 'string' ? JSON.parse(area.decorations) : area.decorations;
                if (Array.isArray(decos)) {
                    templates = decos.filter(d => d.action_type === 'donut_system');
                }
            }
        } catch (e) {}

        if (templates.length === 0) {
            // No system in this area version, clear memory
            if (areaSpawns.size > 0) areaSpawns.clear();
            continue;
        }

        // Clean up old donuts (older than 5 minutes)
        const now = Date.now();
        for (const [id, donut] of areaSpawns.entries()) {
            if (now - donut.created_at > 5 * 60 * 1000) {
                areaSpawns.delete(id);
                io.to(area.area_id).emit('donut_collected', {
                    area_id: area.area_id,
                    spawn_id: id,
                    collected_by_player_id: 'system_timeout'
                });
            }
        }

        // Spawn if needed - Try to fill up faster (spawn up to 3 per tick)
        let spawnedThisTick = 0;
        while (areaSpawns.size < MAX_DONUTS_PER_AREA && spawnedThisTick < 3) {
            const success = createDonutInMemory(area, templates);
            if (!success) break; // Failed to place (collision?), stop for now
            spawnedThisTick++;
        }
    }
}

function initialize(socketIo, serviceKey, apiUrl) {
    io = socketIo;
    BASE44_SERVICE_KEY = serviceKey;
    BASE44_API_URL = apiUrl;

    console.log('🍩 In-Memory Donut System Active');
    
    // Start loop
    scheduleNextSpawn();
}

function scheduleNextSpawn() {
    const delay = Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1)) + MIN_INTERVAL;
    
    setTimeout(async () => {
        await maintainDonuts();
        scheduleNextSpawn();
    }, delay);
}

function setupSocketHandlers(socket, players) {
    // 1. Sync on Join
    // When a player enters an area, send them all current donuts
    socket.on('request_area_donuts', (areaId) => {
        if (activeSpawns.has(areaId)) {
            const donuts = Array.from(activeSpawns.get(areaId).values());
            donuts.forEach(d => {
                socket.emit('donut_spawned', { area_id: areaId, spawn: d });
            });
        }
    });

    // 2. Handle Collection
    socket.on('client_try_collect_donut', async (data) => {
        const p = players.get(socket.id);
        if (!p) return;

        const { spawn_id, area_id } = data;
        
        // Validation
        if (p.current_area !== area_id) return; // Player not in area
        
        const areaSpawns = activeSpawns.get(area_id);
        if (!areaSpawns || !areaSpawns.has(spawn_id)) {
            // Donut doesn't exist or already taken
            return;
        }

        const donut = areaSpawns.get(spawn_id);

        // DELETE FIRST (Race condition prevention)
        areaSpawns.delete(spawn_id);

        // Broadcast immediately
        io.to(area_id).emit('donut_collected', {
            area_id: area_id,
            spawn_id: spawn_id,
            collected_by_player_id: p.playerId
        });

        // Give Reward (Async)
        await giveRewardToPlayer(p.playerId, donut.collectible_type, donut.collectible_name, donut.image_url);
        
        // Notify client specifically (so they can update counter UI)
        socket.emit('donut_collection_success', {
            collectible_type: donut.collectible_type,
            quantity_added: 1
        });
    });
}

module.exports = {
    initialize,
    setupSocketHandlers
};
