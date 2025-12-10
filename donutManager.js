const fetch = require("node-fetch");

// ==========================================
// IN-MEMORY DONUT MANAGER
// ==========================================

const ACTIVE_DONUTS = new Map(); // spawn_id -> Donut Object
let ioRef = null;
let serviceKey = null;
let apiUrl = null;

// Constants
const MIN_INTERVAL = 6000;
const MAX_INTERVAL = 40000;

// --- Public API ---

function initialize(io, key, url) {
    ioRef = io;
    serviceKey = key ? key.trim() : null;
    apiUrl = url;
    
    console.log("🍩 Donut Manager Initialized");
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
    socket.on('collect_donut', async (data) => {
        const { spawn_id, player_id } = data;
        const player = players.get(socket.id);
        
        if (!player) {
             console.log(`[DonutManager] Collection failed - Player not found for socket ${socket.id}`);
             return;
        }

        if (!ACTIVE_DONUTS.has(spawn_id)) {
            console.log(`[DonutManager] Collection failed - Donut ${spawn_id} not found or already collected`);
            return;
        }

        const donut = ACTIVE_DONUTS.get(spawn_id);
        
        console.log(`[DonutManager] Donut ${spawn_id} collected by ${player.username} in ${donut.area_id}`);

        // REMOVE IMMEDIATELY from memory
        ACTIVE_DONUTS.delete(spawn_id);

        // BROADCAST REMOVAL IMMEDIATELY
        ioRef.to(donut.area_id).emit('donut_collected', { spawn_id });
        if (donut.area_uuid && donut.area_uuid !== donut.area_id) {
             ioRef.to(donut.area_uuid).emit('donut_collected', { spawn_id });
        }

        // Reward Player (Async)
        await rewardPlayer(player_id || player.playerId, player.username, donut);
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
        const allAreas = await fetchEntities('Area');
        
        if (!allAreas || allAreas.length === 0) {
            console.log("[DonutManager] No areas found in DB.");
            return;
        }

        // 🔥 Group by area_id and find the active version for each
        const areaGroups = new Map();
        for (const area of allAreas) {
            const areaId = area.area_id;
            if (!areaGroups.has(areaId)) {
                areaGroups.set(areaId, []);
            }
            areaGroups.get(areaId).push(area);
        }

        const activeAreas = [];
        for (const [areaId, versions] of areaGroups.entries()) {
            const activeVersion = versions.find(v => v.is_active === true);
            if (activeVersion) {
                activeAreas.push(activeVersion);
            }
        }

        if (activeAreas.length === 0) {
            return;
        }

        // Process each active area
        for (const area of activeAreas) {
            processArea(area);
        }
    } catch (error) {
        console.error("🍩 Donut Tick Error:", error.message);
    }
}

function processArea(area) {
    let templates = [];
    try {
        if (area.decorations) {
            const decos = typeof area.decorations === 'string' ? JSON.parse(area.decorations) : area.decorations;
            if (Array.isArray(decos)) {
                templates = decos.filter(d => d.action_type === 'donut_system');
            }
        }
    } catch (e) {
        console.error(`[DonutManager] Error parsing decorations for ${area.area_id}:`, e.message);
    }

    if (templates.length === 0) {
        return;
    }

    // 🧹 Clean up donuts from old/different versions
    for (const [id, d] of ACTIVE_DONUTS.entries()) {
        if (d.area_id === area.area_id && d.version_name !== area.version_name) {
            console.log(`[DonutManager] 🧹 Removing mismatched version donut: ${id}`);
            ACTIVE_DONUTS.delete(id);
            if (ioRef) {
                ioRef.to(area.area_id).emit('donut_collected', { spawn_id: id });
            }
        }
    }
    
    // ✅ Spawn a new donut (Unlimited!)
    spawnDonut(area, templates);
}

function spawnDonut(area, templates) {
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    const PADDING = 100;
    const x = Math.floor(Math.random() * (1380 - PADDING * 2)) + PADDING;
    const y = Math.floor(Math.random() * (770 - PADDING * 2)) + PADDING;

    const spawnId = `donut_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const donut = {
        spawn_id: spawnId,
        area_id: area.area_id,
        area_uuid: area.id,
        version_name: area.version_name, 
        collectible_type: (template.name || 'donut').trim(),
        image_url: template.image_url,
        position_x: x,
        position_y: y,
        scale: template.scale || 1
    };

    ACTIVE_DONUTS.set(spawnId, donut);

    const payload = { area_id: area.area_id, spawn: donut };
    
    ioRef.to(area.area_id).emit('donut_spawned', payload);
    if (area.id && area.id !== area.area_id) {
        ioRef.to(area.id).emit('donut_spawned', payload);
    }
}

async function rewardPlayer(playerId, username, donut) {
    try {
        console.log(`[DonutManager] 🎁 Rewarding ${username} for ${donut.collectible_type}`);
        
        // Call the secure backend function
        const url = `${apiUrl}/functions/collectDonut`;
        
        const res = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceKey}`
            },
            body: JSON.stringify({
                player_id: playerId,
                collectible_type: donut.collectible_type,
                collectible_name: donut.collectible_type,
                image_url: donut.image_url
            })
        });

        if (!res.ok) {
            const errorText = await res.text();
            console.error(`[DonutManager] ❌ Reward failed (HTTP ${res.status}): ${errorText}`);
        } else {
            const data = await res.json();
            console.log(`[DonutManager] ✅ Reward success. New Quantity: ${data.quantity}`);
        }
    } catch (e) {
        console.error("[DonutManager] ❌ Reward error:", e);
    }
}

// --- API Helpers ---

async function fetchEntities(entity, filter = null, queryParam = null) {
    let url = `${apiUrl}/entities/${entity}`;
    const params = [];
    if (filter) {
        params.push(`query=${encodeURIComponent(JSON.stringify(filter))}`);
    }
    if (queryParam) {
        params.push(queryParam);
    }
    
    if (params.length > 0) {
        url += `?${params.join('&')}`;
    }
    
    try {
        const res = await fetch(url, {
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceKey}` 
            }
        });
        
        if (!res.ok) {
            console.error(`[DonutManager] Fetch ${entity} failed: ${res.status} ${res.statusText}`);
            return [];
        }
        return await res.json();
    } catch (e) {
        console.error(`[DonutManager] Fetch error for ${entity}:`, e.message);
        return [];
    }
}

module.exports = {
    initialize,
    setupSocketHandlers,
    getDonutsForArea
};
