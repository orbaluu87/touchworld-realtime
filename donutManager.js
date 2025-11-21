// ============================================================================
// DONUT SYSTEM MANAGER (Simplified & Robust)
// ============================================================================

const fetch = require("node-fetch");

const MAX_DONUTS_PER_AREA = 8;
const MIN_INTERVAL = 2000; // 2 seconds
const MAX_INTERVAL = 6000; // 6 seconds

let BASE44_SERVICE_KEY;
let BASE44_API_URL;
let io;

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

    // 4. Create
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
        is_collected: false
    };

    const created = await apiCall('/entities/DonutSpawn', 'POST', spawnData);

    if (created) {
        console.log(`🍩 New Donut: ${area.area_id} (${area.version_name}) (${created.position_x},${created.position_y})`);
        io.to(area.area_id).emit('donut_spawned', {
            area_id: area.area_id,
            spawn: created
        });
    }
}

async function maintainDonuts() {
    const areas = await apiCall('/entities/Area');
    if (!areas || !Array.isArray(areas)) return;

    const allSpawns = await apiCall('/entities/DonutSpawn') || [];

    // Group by area_id: ACTIVE areas take precedence.
    // This ensures we don't process "Default" (active) AND "Hanukkah" (inactive) as separate valid configs for same area_id.
    const activeAreaConfig = new Map();
    
    for (const area of areas) {
        if (area.is_active) {
            activeAreaConfig.set(area.area_id, area);
        }
    }
    
    // Identify all area_ids that need processing (active config OR existing spawns)
    const areaIdsToProcess = new Set([
        ...activeAreaConfig.keys(),
        ...allSpawns.map(s => s.area_id)
    ]);

    for (const areaId of areaIdsToProcess) {
        const area = activeAreaConfig.get(areaId);
        
        // If no active area config found, skip (don't crash, and don't delete donuts from inactive versions)
        if (!area) continue;

        const areaSpawns = allSpawns.filter(s => s.area_id === areaId);

        // 1. Parse templates (only if we have an active area config)
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

        // Filter spawns for THIS version
        const versionSpawns = areaSpawns.filter(s => s.version_name === area.version_name);

        // 2. If no system found (active area but no templates) -> DELETE donuts for this version
        if (templates.length === 0) {
            if (versionSpawns.length > 0) {
                console.log(`🧹 Cleaning up ${versionSpawns.length} donuts from ${areaId} version ${area.version_name} (system removed)`);
                for (const spawn of versionSpawns) {
                    await apiCall('/entities/DonutSpawn', 'DELETE', { id: spawn.id });
                    io.to(areaId).emit('donut_collected', {
                        area_id: areaId,
                        spawn_id: spawn.spawn_id,
                        collected_by_player_id: 'system'
                    });
                }
            }
            continue;
        }

        // 3. Sync existing donuts with current configuration
        let currentValidCount = 0;
        for (const spawn of versionSpawns) {
            // Cleanup: If marked collected but not deleted, remove it and don't count it
            if (spawn.is_collected) {
                await apiCall('/entities/DonutSpawn', 'DELETE', { id: spawn.id });
                continue;
            }

            const isValid = templates.some(t => 
                t.image_url === spawn.image_url && 
                (t.name || 'donut') === spawn.collectible_type
            );

            if (!isValid) {
                console.log(`🧹 Removing outdated donut ${spawn.spawn_id} from ${areaId} version ${area.version_name}`);
                await apiCall('/entities/DonutSpawn', 'DELETE', { id: spawn.id });
                io.to(areaId).emit('donut_collected', {
                    area_id: areaId,
                    spawn_id: spawn.spawn_id,
                    collected_by_player_id: 'system'
                });
            } else {
                currentValidCount++;
            }
        }

        // 4. Spawn new donuts if needed
        if (currentValidCount < MAX_DONUTS_PER_AREA) {
            await spawnDonutInArea(area, templates);
        }
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
    socket.on('client_collected_donut', (data) => {
        const p = players.get(socket.id);
        if (!p) return;

        // Verify area match
        if (p.current_area !== data.area_id) return;

        // Broadcast removal to everyone in area
        socket.to(p.current_area).emit('donut_collected', {
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
