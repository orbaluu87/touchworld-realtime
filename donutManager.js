const fetch = require("node-fetch");

// ==========================================
// IN-MEMORY DONUT MANAGER (No DB Persistence)
// ==========================================

// State
const ACTIVE_DONUTS = new Map(); // spawn_id -> Donut Object
let ioRef = null;
let serviceKey = null;
let apiUrl = null;

// Constants
const MAX_DONUTS_PER_AREA = 30;
const MIN_INTERVAL = 2000;
const MAX_INTERVAL = 6000;

// --- Public API ---

function initialize(io, key, url) {
    ioRef = io;
    serviceKey = key;
    apiUrl = url;
    
    console.log("🍩 Donut Manager Initialized (In-Memory Mode)");
    startSpawnLoop();
}

function getDonutsForArea(areaId) {
    const list = [];
    for (const d of ACTIVE_DONUTS.values()) {
        if (d.area_id === areaId) {
            list.push(d);
        }
    }
    return list;
}

function setupSocketHandlers(socket, players) {
    // 1. Handle Collection
    socket.on('collect_donut', async (data) => {
        const { spawn_id } = data;
        const player = players.get(socket.id);
        
        if (!player || !ACTIVE_DONUTS.has(spawn_id)) return;

        const donut = ACTIVE_DONUTS.get(spawn_id);
        
        // REMOVE IMMEDIATELY from memory
        ACTIVE_DONUTS.delete(spawn_id);

        // BROADCAST REMOVAL IMMEDIATELY to everyone in the area
        ioRef.to(donut.area_id).emit('donut_collected', { spawn_id });

        // Reward Player (Async - doesn't block game flow)
        rewardPlayer(player.playerId, donut);
    });
}

// --- Internal Logic ---

function startSpawnLoop() {
    const delay = Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1)) + MIN_INTERVAL;
    
    setTimeout(async () => {
        await tick();
        startSpawnLoop();
    }, delay);
}

async function tick() {
    if (!ioRef) return;

    try {
        // 1. Fetch Active Areas (We need config for positions/types)
        const areas = await fetchEntities('Area', { is_active: true });
        if (!areas || areas.length === 0) return;

        // 2. Process each area
        for (const area of areas) {
            await processArea(area);
        }
    } catch (error) {
        console.error("🍩 Donut Tick Error:", error.message);
    }
}

async function processArea(area) {
    // Parse templates
    let templates = [];
    try {
        if (area.decorations) {
            const decos = typeof area.decorations === 'string' ? JSON.parse(area.decorations) : area.decorations;
            if (Array.isArray(decos)) {
                templates = decos.filter(d => d.action_type === 'donut_system');
            }
        }
    } catch (e) {}

    if (templates.length === 0) return;

    // Count current donuts
    const currentDonuts = getDonutsForArea(area.area_id);
    
    // Logic: Spawn if below max
    if (currentDonuts.length < MAX_DONUTS_PER_AREA) {
        spawnDonut(area, templates);
    }
}

function spawnDonut(area, templates) {
    // 1. Pick Template
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    // 2. Find Position (Simple Random for now, skipping complex collision for speed unless vital)
    // Using basic map bounds padding
    const PADDING = 100;
    const x = Math.floor(Math.random() * (1380 - PADDING * 2)) + PADDING;
    const y = Math.floor(Math.random() * (770 - PADDING * 2)) + PADDING;

    // 3. Create Object
    const spawnId = `donut_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const donut = {
        spawn_id: spawnId,
        area_id: area.area_id,
        collectible_type: template.name || 'donut',
        image_url: template.image_url,
        position_x: x,
        position_y: y,
        scale: template.scale || 1
    };

    // 4. Store in Memory
    ACTIVE_DONUTS.set(spawnId, donut);

    // 5. Broadcast
    ioRef.to(area.area_id).emit('donut_spawned', donut);
    
    // Also broadcast to the specific version ID room if it's different
    if (area.id && area.id !== area.area_id) {
        ioRef.to(area.id).emit('donut_spawned', donut);
    }
    
    console.log(`🍩 Spawned in ${area.area_id}: ${spawnId}`);
}

async function rewardPlayer(playerId, donut) {
    try {
        // Check existing counter
        const query = JSON.stringify({ 
            player_id: playerId, 
            collectible_type: donut.collectible_type 
        });
        
        const counters = await fetchEntities('CollectibleCounter', null, `query=${query}`);
        
        if (counters && counters.length > 0) {
            // Update
            await updateEntity('CollectibleCounter', counters[0].id, {
                quantity: counters[0].quantity + 1
            });
        } else {
            // Create
            await createEntity('CollectibleCounter', {
                player_id: playerId,
                collectible_type: donut.collectible_type,
                collectible_name: donut.collectible_type,
                collectible_image: donut.image_url,
                quantity: 1
            });
        }
    } catch (e) {
        console.error("Failed to reward player:", e);
    }
}

// --- API Helpers ---

async function fetchEntities(entity, filter = null, queryParam = null) {
    let url = `${apiUrl}/entities/${entity}`;
    if (filter) {
        url += `?query=${JSON.stringify(filter)}`;
    } else if (queryParam) {
        url += `?${queryParam}`;
    }
    
    const res = await fetch(url, {
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}` 
        }
    });
    if (!res.ok) return [];
    return await res.json();
}

async function createEntity(entity, data) {
    await fetch(`${apiUrl}/entities/${entity}`, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}` 
        },
        body: JSON.stringify(data)
    });
}

async function updateEntity(entity, id, data) {
    await fetch(`${apiUrl}/entities/${entity}/${id}`, {
        method: 'PATCH',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}` 
        },
        body: JSON.stringify(data)
    });
}

module.exports = {
    initialize,
    setupSocketHandlers,
    getDonutsForArea
};
