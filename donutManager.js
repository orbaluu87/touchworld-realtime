// ============================================================================
// DONUT SYSTEM MANAGER (Robust & Version-Aware)
// ============================================================================

const fetch = require("node-fetch");

const MAX_DONUTS_PER_AREA = 8;
// Interval for the maintenance loop
const MAINTENANCE_INTERVAL = 10000; // 10 seconds

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
        console.log(`🍩 New Donut: ${area.area_id} (${created.position_x},${created.position_y})`);
        io.to(area.area_id).emit('donut_spawned', {
            area_id: area.area_id,
            spawn: created
        });
    }
}

async function maintainDonuts() {
    // 1. Fetch ONLY active areas. The donuts must belong to the specific version.
    // DonutSpawn.area_id must match Area.area_id.
    // If an area version is replaced, the old area_id is no longer in this list.
    const areas = await apiCall('/entities/Area?is_active=true');
    if (!areas || !Array.isArray(areas)) return;

    const allSpawns = await apiCall('/entities/DonutSpawn') || [];
    const activeAreaIds = new Set(areas.map(a => a.area_id));

    // === CLEANUP STAGE 1: Remove donuts from inactive/deleted area versions ===
    // If a donut's area_id is not in the currently active areas list, delete it.
    const orphanedSpawns = allSpawns.filter(s => !activeAreaIds.has(s.area_id));
    
    if (orphanedSpawns.length > 0) {
        console.log(`🧹 Cleaning up ${orphanedSpawns.length} orphaned donuts (area version changed/deleted)`);
        for (const spawn of orphanedSpawns) {
            await apiCall('/entities/DonutSpawn', 'DELETE', { id: spawn.id });
            // Try to notify clients if they are still lingering on that ID (unlikely but safe)
            io.emit('donut_collected', {
                area_id: spawn.area_id,
                spawn_id: spawn.spawn_id,
                collected_by_player_id: 'system'
            });
        }
    }

    // === MAINTENANCE STAGE 2: Process active areas ===
    for (const area of areas) {
        // Parse templates
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

        const areaSpawns = allSpawns.filter(s => s.area_id === area.area_id);

        // If no system found in THIS active version -> DELETE ALL donuts for this area
        if (templates.length === 0) {
            if (areaSpawns.length > 0) {
                console.log(`🧹 Cleaning up ${areaSpawns.length} donuts from ${area.area_id} (feature disabled in this version)`);
                for (const spawn of areaSpawns) {
                    await apiCall('/entities/DonutSpawn', 'DELETE', { id: spawn.id });
                    io.to(area.area_id).emit('donut_collected', {
                        area_id: area.area_id,
                        spawn_id: spawn.spawn_id,
                        collected_by_player_id: 'system'
                    });
                }
            }
            continue;
        }

        // Sync existing donuts with current configuration (delete invalid types/images)
        let currentValidCount = 0;
        for (const spawn of areaSpawns) {
            const isValid = templates.some(t => 
                t.image_url === spawn.image_url && 
                (t.name || 'donut') === spawn.collectible_type
            );

            if (!isValid) {
                console.log(`🧹 Removing outdated donut ${spawn.spawn_id} from ${area.area_id}`);
                await apiCall('/entities/DonutSpawn', 'DELETE', { id: spawn.id });
                io.to(area.area_id).emit('donut_collected', {
                    area_id: area.area_id,
                    spawn_id: spawn.spawn_id,
                    collected_by_player_id: 'system'
                });
            } else {
                currentValidCount++;
            }
        }

        // Spawn new donuts if needed
        // LOGIC: Spawn ONE donut per cycle (10s) with a probability check to simulate 10-40s variability.
        // If we need donuts (currentValidCount < MAX), we roll the dice.
        // 0.5 probability -> Avg 2 cycles -> 20s. Range effectively 10s - infinity, but tightly bound around 20s.
        // This ensures we don't spawn all 8 instantly.
        if (currentValidCount < MAX_DONUTS_PER_AREA) {
            // 40% chance to spawn in this 10s window.
            // This gives a "feel" of randomness between 10s and ~40s on average.
            if (Math.random() < 0.4) { 
                await spawnDonutInArea(area, templates);
            }
        }
    }
}

function initialize(socketIo, serviceKey, apiUrl) {
    io = socketIo;
    BASE44_SERVICE_KEY = serviceKey;
    BASE44_API_URL = apiUrl;

    console.log('🍩 Donut System Manager - Robust Version-Aware Mode Active');
    
    // Run maintenance every 10 seconds
    setInterval(async () => {
        await maintainDonuts();
    }, MAINTENANCE_INTERVAL);
    
    // Initial run
    maintainDonuts();
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
