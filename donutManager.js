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
// No limit on donuts as requested
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
    // 1. Handle Collection
    socket.on('collect_donut', async (data) => {
        const { spawn_id } = data;
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

        // BROADCAST REMOVAL IMMEDIATELY to everyone in the area (both logical and specific rooms)
        ioRef.to(donut.area_id).emit('donut_collected', { spawn_id });
        if (donut.area_uuid && donut.area_uuid !== donut.area_id) {
             ioRef.to(donut.area_uuid).emit('donut_collected', { spawn_id });
        }

        // Reward Player (Async - doesn't block game flow)
        rewardPlayer(player.playerId, player.username, donut);
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
        // 1. Fetch ALL Areas to debug active status issue
        const allAreas = await fetchEntities('Area');
        
        if (!allAreas || allAreas.length === 0) {
            console.log("[DonutManager] No areas found in DB at all.");
            return;
        }

        const activeAreas = allAreas.filter(a => a.is_active === true);

        if (activeAreas.length === 0) {
            console.log(`[DonutManager] Found ${allAreas.length} areas, but NONE are active. Check DB 'is_active' field.`);
            return;
        }

        // 2. Process each active area
        for (const area of activeAreas) {
            await processArea(area);
        }
    } catch (error) {
        console.error("🍩 Donut Tick Error:", error.message);
    }
}

async function processArea(area) {
    // 1. Parse templates (Check if donut system object exists)
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

    // User requirement: "only if there is a donut system object"
    if (templates.length === 0) {
        return;
    }

    // 2. Filter and Clean Donuts by version_name
    const validVersionDonuts = [];
    
    for (const [id, d] of ACTIVE_DONUTS.entries()) {
        if (d.area_id === area.area_id) {
            // User requirement: "pull by version_name"
            if (d.version_name === area.version_name) {
                validVersionDonuts.push(d);
            } else {
                // Cleanup old version donuts
                console.log(`[DonutManager] Removing mismatched version donut: ${id} (${d.version_name} != ${area.version_name})`);
                ACTIVE_DONUTS.delete(id);
                if (ioRef) {
                    ioRef.to(area.area_id).emit('donut_collected', { spawn_id: id });
                }
            }
        }
    }
    
    // Logic: Spawn always (No limit)
    spawnDonut(area, templates);
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
        area_uuid: area.id, // Store UUID for efficient broadcasting
        version_name: area.version_name, 
        collectible_type: template.name || 'donut',
        image_url: template.image_url,
        position_x: x,
        position_y: y,
        scale: template.scale || 1
    };

    // 4. Store in Memory
    ACTIVE_DONUTS.set(spawnId, donut);

    // 5. Broadcast (Wrap in payload to match client expectation)
    const payload = { area_id: area.area_id, spawn: donut };
    
    ioRef.to(area.area_id).emit('donut_spawned', payload);
    
    if (area.id && area.id !== area.area_id) {
        ioRef.to(area.id).emit('donut_spawned', payload);
    }
    
    console.log(`🍩 Spawned in ${area.area_id}: ${spawnId}`);
}

async function rewardPlayer(playerId, username, donut) {
    try {
        console.log(`[DonutManager] Rewarding user ${playerId} (${username}) for ${donut.collectible_type}`);
        
        // 1. Fetch ALL counters for this user to ensure reliable string matching in memory
        // (API filtering with Hebrew strings can sometimes be flaky)
        const allUserCounters = await fetchEntities('CollectibleCounter', { 
            user_id: playerId 
        }, 'limit=1000');
        
        // Filter in-memory which is 100% reliable for Unicode/Hebrew
        const existingCounters = allUserCounters.filter(c => c.collectible_type === donut.collectible_type);
        
        if (existingCounters && existingCounters.length > 0) {
            // Found existing record(s)
            const mainRecord = existingCounters[0];
            let totalQuantity = Number(mainRecord.quantity) || 0;

            // HEAL: If duplicates exist (from past bugs), sum them up and delete extra rows
            if (existingCounters.length > 1) {
                console.log(`[DonutManager] Found ${existingCounters.length} duplicate rows for ${donut.collectible_type}. Merging...`);
                
                for (let i = 1; i < existingCounters.length; i++) {
                    const dup = existingCounters[i];
                    totalQuantity += (Number(dup.quantity) || 0);
                    
                    // Delete duplicate asynchronously
                    deleteEntity('CollectibleCounter', dup.id).catch(err => 
                        console.error(`[DonutManager] Failed to delete duplicate ${dup.id}`, err)
                    );
                }
            }

            // Update the main record with new total + 1
            const newQuantity = totalQuantity + 1;
            console.log(`[DonutManager] Updating main counter ${mainRecord.id}. New Total: ${newQuantity}`);
            
            await updateEntity('CollectibleCounter', mainRecord.id, {
                quantity: newQuantity,
                username: username || mainRecord.username
            });
            
        } else {
            // No record exists - Create new one
            console.log(`[DonutManager] Creating FIRST counter for ${donut.collectible_type}`);
            
            await createEntity('CollectibleCounter', {
                user_id: playerId,
                username: username || 'Unknown',
                collectible_type: donut.collectible_type,
                collectible_name: donut.collectible_type,
                collectible_image: donut.image_url || '',
                quantity: 1
            });
        }
    } catch (e) {
        console.error("[DonutManager] Failed to reward player:", e);
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
            const text = await res.text();
            console.error(`[DonutManager] Response body: ${text}`);
            return [];
        }
        return await res.json();
    } catch (e) {
        console.error(`[DonutManager] Fetch error for ${entity}:`, e.message);
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
            console.error(`[DonutManager] Create ${entity} failed: ${text}`);
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
            console.error(`[DonutManager] Update ${entity} failed: ${text}`);
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
            console.error(`[DonutManager] Delete ${entity} failed: ${res.status}`);
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
