const fetch = require("node-fetch");

// IN-MEMORY DONUT MANAGER
const ACTIVE_DONUTS = new Map();
let ioRef = null;
let serviceKey = null;
let apiUrl = null;

const MIN_INTERVAL = 6000;
const MAX_INTERVAL = 40000;

// ✅ Initialize
function initialize(io, key, url) {
    ioRef = io;
    serviceKey = key ? key.trim() : null;
    apiUrl = url;
    console.log("🍩 Donut Manager Initialized");
    startSpawnLoop();
}

// ✅ Get donuts for specific area (for sync)
function getDonutsForArea(areaId) {
    const list = [];
    for (const d of ACTIVE_DONUTS.values()) {
        if (d.area_id === areaId) list.push(d);
    }
    return list;
}

// ✅ Socket Handlers
function setupSocketHandlers(socket, players) {
    socket.on('collect_donut', async (data) => {
        const { spawn_id, player_id } = data;
        const player = players.get(socket.id);
        
        if (!player || !ACTIVE_DONUTS.has(spawn_id)) return;

        const donut = ACTIVE_DONUTS.get(spawn_id);
        
        // Remove & Broadcast
        ACTIVE_DONUTS.delete(spawn_id);
        ioRef.to(donut.area_id).emit('donut_collected', { spawn_id });
        if (donut.area_uuid !== donut.area_id) {
            ioRef.to(donut.area_uuid).emit('donut_collected', { spawn_id });
        }

        // Reward (async)
        rewardPlayer(player_id || player.playerId, player.username, donut);
    });
}

// ✅ Spawn Loop
function startSpawnLoop() {
    const delay = Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1)) + MIN_INTERVAL;
    setTimeout(async () => {
        await tick();
        startSpawnLoop();
    }, delay);
}

// ✅ Main Tick
async function tick() {
    if (!ioRef) return;

    const allAreas = await fetchEntities('Area');
    if (!allAreas || allAreas.length === 0) return;

    const activeAreas = allAreas.filter(a => a.is_active === true);
    console.log(`[DonutManager] 📊 Total: ${allAreas.length}, Active: ${activeAreas.length}`);

    if (activeAreas.length === 0) {
        console.log(`⚠️ Sample:`, allAreas.slice(0, 3).map(a => ({ area_id: a.area_id, is_active: a.is_active })));
        return;
    }

    for (const area of activeAreas) {
        await processArea(area);
    }
}

// ✅ Process Area
async function processArea(area) {
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

    if (templates.length === 0) return;

    // Clean old version donuts
    const validVersionDonuts = [];
    for (const [id, d] of ACTIVE_DONUTS.entries()) {
        if (d.area_id === area.area_id) {
            if (d.version_name === area.version_name) {
                validVersionDonuts.push(d);
            } else {
                ACTIVE_DONUTS.delete(id);
                ioRef.to(area.area_id).emit('donut_collected', { spawn_id: id });
            }
        }
    }
    
    // Spawn if needed (max 8 per area)
    if (validVersionDonuts.length < 8) {
        spawnDonut(area, templates);
    }
}

// ✅ Spawn Donut
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
    if (area.id !== area.area_id) ioRef.to(area.id).emit('donut_spawned', payload);
    
    console.log(`🍩 Spawned "${donut.collectible_type}" in ${area.area_id}`);
}

// ✅ Reward Player (calls collectDonut function)
async function rewardPlayer(playerId, username, donut) {
    try {
        const response = await fetch(`${apiUrl}/functions/collectDonut`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceKey}`
            },
            body: JSON.stringify({
                spawn_id: donut.spawn_id,
                player_id: playerId,
                collectible_type: donut.collectible_type,
                collectible_name: donut.collectible_type,
                image_url: donut.image_url
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log(`✅ Rewarded ${username}: ${result.quantity} total`);
        }
    } catch (e) {
        console.error("❌ Reward failed:", e);
    }
}

// Helper: Fetch entities
async function fetchEntities(entity) {
    const url = `${apiUrl}/entities/${entity}`;
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${serviceKey}` }
    });
    return res.ok ? await res.json() : [];
}

module.exports = { initialize, setupSocketHandlers, getDonutsForArea };
