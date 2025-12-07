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

        // Reward Player
        rewardPlayer(player_id || player.playerId, player.username, donut);
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

        const activeAreas = allAreas.filter(a => a.is_active === true);

        if (activeAreas.length === 0) {
            console.log(`[DonutManager] Found ${allAreas.length} areas, but NONE are active.`);
            return;
        }

        for (const area of activeAreas) {
            await processArea(area);
        }
    } catch (error) {
        console.error("🍩 Donut Tick Error:", error.message);
    }
}

async function processArea(area) {
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

    const validVersionDonuts = [];
    
    for (const [id, d] of ACTIVE_DONUTS.entries()) {
        if (d.area_id === area.area_id) {
            if (d.version_name === area.version_name) {
                validVersionDonuts.push(d);
            } else {
                console.log(`[DonutManager] Removing mismatched version donut: ${id}`);
                ACTIVE_DONUTS.delete(id);
                if (ioRef) {
                    ioRef.to(area.area_id).emit('donut_collected', { spawn_id: id });
                }
            }
        }
    }
    
    if (validVersionDonuts.length < 8) {
        spawnDonut(area, templates);
    }
}

function spawnDonut(area, templates) {
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    const PADDING = 100;
    const x = Math.floor(Math.random() * (1380 - PADDING * 2)) + PADDING;
    const y = Math.floor(Math.random() * (770 - PADDING * 2)) + PADDING;

    const spawnId = `donut_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    
    // CRITICAL FIX: Trim the name to match client-side expectations
    const collectibleType = (template.name || 'donut').trim();
    
    const donut = {
        spawn_id: spawnId,
        area_id: area.area_id,
        area_uuid: area.id,
        version_name: area.version_name, 
        collectible_type: collectibleType,
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
    
    console.log(`🍩 Spawned ${collectibleType} in ${area.area_id}: ${spawnId}`);
}

async function rewardPlayer(playerId, username, donut) {
    try {
        console.log(`[DonutManager] Rewarding ${playerId} (${username}) for ${donut.collectible_type}`);
        
        // CRITICAL: Trim and normalize the collectible_type
        const normalizedType = donut.collectible_type.trim();
        
        // Fetch counters with the NORMALIZED type
        const existingCounters = await fetchEntities('CollectibleCounter', { 
            user_id: playerId, 
            collectible_type: normalizedType 
        });
        
        if (existingCounters && existingCounters.length > 0) {
            const mainRecord = existingCounters[0];
            let totalQuantity = Number(mainRecord.quantity) || 0;

            // Merge duplicates if they exist
            if (existingCounters.length > 1) {
                console.log(`[DonutManager] ⚠️ Found ${existingCounters.length} duplicate rows! Merging...`);
                
                for (let i = 1; i < existingCounters.length; i++) {
                    const dup = existingCounters[i];
                    totalQuantity += (Number(dup.quantity) || 0);
                    
                    deleteEntity('CollectibleCounter', dup.id).catch(err => 
                        console.error(`[DonutManager] Failed to delete duplicate ${dup.id}`, err)
                    );
                }
            }

            const newQuantity = totalQuantity + 1;
            console.log(`[DonutManager] Updating counter ${mainRecord.id}: ${totalQuantity} → ${newQuantity}`);
            
            await updateEntity('CollectibleCounter', mainRecord.id, {
                quantity: newQuantity,
                username: username || mainRecord.username,
                collectible_type: normalizedType // Ensure it's normalized
            });
            
            console.log(`[DonutManager] ✅ Updated to ${newQuantity}`);
            
        } else {
            console.log(`[DonutManager] Creating first counter for ${normalizedType}`);
            
            await createEntity('CollectibleCounter', {
                user_id: playerId,
                username: username || 'Unknown',
                collectible_type: normalizedType,
                collectible_name: normalizedType,
                collectible_image: donut.image_url || '',
                quantity: 1
            });
            
            console.log(`[DonutManager] ✅ Created first counter`);
        }
    } catch (e) {
        console.error("[DonutManager] ❌ Reward failed:", e);
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
            console.error(`[DonutManager] Fetch ${entity} failed: ${res.status}`);
            return [];
        }
        return await res.json();
    } catch (e) {
        console.error(`[DonutManager] Fetch error:`, e.message);
        return [];
    }
}

async function createEntity(entity, data) {
    const url = `${apiUrl}/entities/${entity}`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceKey}` 
            },
            body: JSON.stringify(data)
        });
        
        if (!res.ok) {
            const text = await res.text();
            console.error(`[DonutManager] Create failed: ${text}`);
            throw new Error(`Create failed: ${res.statusText}`);
        }
        return await res.json();
    } catch (e) {
        console.error(`[DonutManager] Create error:`, e);
        throw e;
    }
}

async function updateEntity(entity, id, data) {
    const url = `${apiUrl}/entities/${entity}/${id}`;
    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceKey}` 
            },
            body: JSON.stringify(data)
        });
        
        if (!res.ok) {
            const text = await res.text();
            console.error(`[DonutManager] Update failed: ${text}`);
            throw new Error(`Update failed: ${res.statusText}`);
        }
        return await res.json();
    } catch (e) {
        console.error(`[DonutManager] Update error:`, e);
        throw e;
    }
}

async function deleteEntity(entity, id) {
    const url = `${apiUrl}/entities/${entity}/${id}`;
    try {
        const res = await fetch(url, {
            method: 'DELETE',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceKey}` 
            }
        });
        
        if (!res.ok) {
            console.error(`[DonutManager] Delete failed: ${res.status}`);
        }
    } catch (e) {
        console.error(`[DonutManager] Delete error:`, e);
    }
}

module.exports = {
    initialize,
    setupSocketHandlers,
    getDonutsForArea
};
