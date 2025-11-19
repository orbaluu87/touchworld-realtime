// ============================================================================
// DONUT SYSTEM MANAGER - מערכת ניהול סופגניות מלאה
// ============================================================================

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const MIN_DONUTS = 3;
const MAX_DONUTS = 8;
const SPAWN_MIN = 8000;
const SPAWN_MAX = 15000;
const AREA_WIDTH = 1380;
const AREA_HEIGHT = 770;
const MARGIN = 100;

let BASE44_SERVICE_KEY;
let BASE44_API_URL;
let io;

function randomDelay() {
    return SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
}

function isPointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function isPositionBlocked(x, y, collisionMap, buffer = 30) {
    if (!collisionMap || collisionMap.length === 0) return false;
    
    // בדוק את הנקודה המרכזית + 4 נקודות סביבה (buffer של 30px)
    const checkPoints = [
        { x, y },
        { x: x - buffer, y: y - buffer },
        { x: x + buffer, y: y - buffer },
        { x: x - buffer, y: y + buffer },
        { x: x + buffer, y: y + buffer }
    ];
    
    for (const collision of collisionMap) {
        if (collision.type === 'polygon' && collision.points && collision.points.length > 0) {
            for (const point of checkPoints) {
                if (isPointInPolygon(point, collision.points)) {
                    return true;
                }
            }
        }
    }
    return false;
}

function randomPosition(collisionMap, maxAttempts = 100) {
    for (let i = 0; i < maxAttempts; i++) {
        const pos = {
            x: MARGIN + Math.random() * (AREA_WIDTH - MARGIN * 2),
            y: MARGIN + Math.random() * (AREA_HEIGHT - MARGIN * 2)
        };
        
        if (!isPositionBlocked(pos.x, pos.y, collisionMap)) {
            console.log(`✅ Found valid position at (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}) after ${i + 1} attempts`);
            return pos;
        }
    }
    
    console.warn(`⚠️  Could not find valid position after ${maxAttempts} attempts`);
    // אם לא מצאנו מיקום פנוי, תחזיר null
    return null;
}

async function getDonutCount(areaId) {
    try {
        const response = await fetch(`${BASE44_API_URL}/entities/DonutSpawn/list`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            }
        });

        if (!response.ok) return 0;
        
        const allSpawns = await response.json();
        return allSpawns.filter(s => s.area_id === areaId).length;
    } catch (error) {
        console.error(`❌ Error counting donuts in ${areaId}:`, error.message);
        return 0;
    }
}

async function spawnDonut(areaId, templates, collisionMap) {
    try {
        const template = templates[Math.floor(Math.random() * templates.length)];
        const pos = randomPosition(collisionMap);
        
        if (!pos) {
            console.warn(`⚠️  Skipping spawn in ${areaId} - no valid position found`);
            return null;
        }
        
        const spawn = {
            area_id: areaId,
            spawn_id: `${areaId}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            collectible_type: template.name || template.image_url.split('/').pop(),
            position_x: pos.x,
            position_y: pos.y,
            image_url: template.image_url,
            scale: template.scale || 1,
            is_collected: false
        };

        const response = await fetch(`${BASE44_API_URL}/entities/DonutSpawn/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            },
            body: JSON.stringify(spawn)
        });

        if (!response.ok) {
            throw new Error(`Failed to create spawn: ${response.status}`);
        }

        const createdSpawn = await response.json();
        
        // שידור לכל השחקנים באזור
        io.to(areaId).emit("donut_spawned", {
            area_id: areaId,
            spawn: createdSpawn
        });
        
        console.log(`✅ Spawned donut in ${areaId} at (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)})`);
        
        return createdSpawn;
    } catch (error) {
        console.error(`❌ Spawn error in ${areaId}:`, error.message);
        return null;
    }
}

async function loadAreasWithDonuts() {
    try {
        const response = await fetch(`${BASE44_API_URL}/entities/Area/list`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            }
        });

        if (!response.ok) return [];
        
        const areas = await response.json();
        const areasWithDonuts = [];
        
        for (const area of areas) {
            if (!area.decorations) continue;
            
            try {
                const decorations = JSON.parse(area.decorations);
                const donutTemplates = decorations.filter(d => d.action_type === 'donut_system');
                
                if (donutTemplates.length > 0) {
                    let collisionMap = [];
                    try {
                        collisionMap = area.collision_map ? JSON.parse(area.collision_map) : [];
                    } catch (e) {
                        // אין מפת התנגשויות
                    }
                    
                    areasWithDonuts.push({
                        area_id: area.area_id,
                        area_name: area.area_name,
                        templates: donutTemplates,
                        collisionMap: collisionMap
                    });
                }
            } catch (e) {
                // שגיאת parsing - דלג
            }
        }
        
        return areasWithDonuts;
    } catch (error) {
        console.error('❌ Load areas error:', error.message);
        return [];
    }
}

async function spawnLoop() {
    const areas = await loadAreasWithDonuts();
    
    if (areas.length === 0) return;
    
    for (const areaConfig of areas) {
        const currentCount = await getDonutCount(areaConfig.area_id);
        const targetCount = MIN_DONUTS + Math.floor(Math.random() * (MAX_DONUTS - MIN_DONUTS + 1));
        
        if (currentCount < targetCount) {
            await spawnDonut(areaConfig.area_id, areaConfig.templates, areaConfig.collisionMap);
        }
    }
}

// מחיקת כל הסופגניות הקיימות
async function clearAllDonuts() {
    try {
        const response = await fetch(`${BASE44_API_URL}/entities/DonutSpawn/list`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            }
        });

        if (!response.ok) return;
        
        const allSpawns = await response.json();
        
        for (const spawn of allSpawns) {
            await fetch(`${BASE44_API_URL}/entities/DonutSpawn/${spawn.id}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
                }
            });
        }
        
        console.log(`🧹 Cleared ${allSpawns.length} existing donuts`);
    } catch (error) {
        console.error('❌ Clear donuts error:', error.message);
    }
}

async function initialize(socketIo, serviceKey, apiUrl) {
    io = socketIo;
    BASE44_SERVICE_KEY = serviceKey;
    BASE44_API_URL = apiUrl;
    
    console.log(`🍩 Donut System: MIN=${MIN_DONUTS} MAX=${MAX_DONUTS} DELAY=${SPAWN_MIN / 1000}s-${SPAWN_MAX / 1000}s`);
    
    // ✅ מחיקת כל הסופגניות הישנות
    await clearAllDonuts();
    
    // ריצה ראשונית עם מיקומים חדשים
    await spawnLoop();
    
    // לולאה אינסופית
    setInterval(spawnLoop, randomDelay());
}

function setupSocketHandlers(socket, players) {
    // ========== DONUT_COLLECTED ==========
    socket.on("donut_collected", (data = {}) => {
        const p = players.get(socket.id);
        if (!p) return;

        console.log(`🍩 Donut collected by ${p.username}: ${data.spawn_id}`);
        
        // שידור לשאר השחקנים באזור
        socket.to(p.current_area).emit("donut_collected", {
            area_id: p.current_area,
            spawn_id: data.spawn_id,
            collected_by: p.username
        });
    });
}

module.exports = {
    initialize,
    setupSocketHandlers
};
