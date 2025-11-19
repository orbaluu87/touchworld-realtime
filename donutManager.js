// ============================================================================
// DONUT SYSTEM MANAGER (Server Side - Robust Version)
// ============================================================================

const fetch = require("node-fetch");

// --- קונפיגורציה ---
const MIN_DONUTS_PER_AREA = 3;
const MAX_DONUTS_PER_AREA = 8;
const SPAWN_CHECK_INTERVAL = 10000; // בדיקה כל 10 שניות

let BASE44_SERVICE_KEY;
let BASE44_API_URL;
let io;

// --- פונקציות עזר ---

// עטיפה לקריאות API מול Base44
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
            const text = await res.text();
            throw new Error(`API Error ${res.status}: ${text}`);
        }
        return await res.json();
    } catch (err) {
        console.error(`❌ DonutManager API Error [${endpoint}]:`, err.message);
        return null;
    }
}

// בדיקת התנגשות עם אזורים חסומים (פוליגונים)
function isPositionBlocked(x, y, collisionMap) {
    if (!collisionMap || !Array.isArray(collisionMap) || collisionMap.length === 0) return false;
    
    for (const shape of collisionMap) {
        if (shape.type === 'polygon' && Array.isArray(shape.points)) {
            // אלגוריתם Ray Casting לבדיקה אם נקודה בתוך פוליגון
            let inside = false;
            for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
                const xi = shape.points[i].x, yi = shape.points[i].y;
                const xj = shape.points[j].x, yj = shape.points[j].y;
                
                const intersect = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            if (inside) return true; // הנקודה בתוך אזור חסום
        }
    }
    return false;
}

// יצירת סופגניה באזור ספציפי
async function spawnDonutInArea(area) {
    // 1. חילוץ תבניות סופגניות מההגדרות של האזור
    let templates = [];
    try {
        if (!area.decorations) return;
        const decos = typeof area.decorations === 'string' ? JSON.parse(area.decorations) : area.decorations;
        templates = decos.filter(d => d.action_type === 'donut_system');
    } catch (e) {
        console.error(`Error parsing decorations for area ${area.area_id}`, e);
        return;
    }

    if (templates.length === 0) return;

    // 2. טעינת מפת התנגשויות
    let collisionMap = [];
    try {
        if (area.collision_map) {
            collisionMap = typeof area.collision_map === 'string' ? JSON.parse(area.collision_map) : area.collision_map;
        }
    } catch (e) {}

    // 3. ניסיון למצוא מיקום פנוי (עד 20 ניסיונות)
    let pos = null;
    const PADDING = 150; // שוליים מהקצוות
    const MAP_WIDTH = 1380;
    const MAP_HEIGHT = 770;

    for (let i = 0; i < 20; i++) {
        const x = PADDING + Math.random() * (MAP_WIDTH - (PADDING * 2));
        const y = PADDING + Math.random() * (MAP_HEIGHT - (PADDING * 2));
        
        if (!isPositionBlocked(x, y, collisionMap)) {
            pos = { x, y };
            break;
        }
    }

    if (!pos) {
        // console.log(`Could not find free position for donut in ${area.area_id}`);
        return;
    }

    // 4. בחירת סופגניה רנדומלית מהתבניות
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    const spawnData = {
        area_id: area.area_id,
        spawn_id: `donut_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        collectible_type: template.name || 'donut', // השם שיוצג
        collectible_name: template.name || 'donut',
        position_x: Math.round(pos.x),
        position_y: Math.round(pos.y),
        image_url: template.image_url,
        scale: template.scale || 1,
        is_collected: false
    };

    // 5. שמירה ב-DB
    // שים לב: משתמשים בנתיב הישיר ליצירת ישות
    const created = await apiCall('/entities/DonutSpawn', 'POST', spawnData);

    // 6. שידור לכל השחקנים באזור
    if (created) {
        console.log(`🍩 Spawned ${created.collectible_type} in ${area.area_id} at (${created.position_x},${created.position_y})`);
        io.to(area.area_id).emit('donut_spawned', {
            area_id: area.area_id,
            spawn: created
        });
    }
}

// הפונקציה הראשית שרצה בלולאה
async function maintainDonutCount() {
    // 1. שליפת כל האזורים
    const areas = await apiCall('/entities/Area');
    if (!areas || !Array.isArray(areas)) return;

    // 2. שליפת כל הסופגניות הפעילות
    const allSpawns = await apiCall('/entities/DonutSpawn');
    if (!allSpawns || !Array.isArray(allSpawns)) return;

    // 3. מעבר על כל אזור ובדיקה אם חסר סופגניות או שצריך לרענן
    for (const area of areas) {
        // דילוג על אזורים ללא הגדרת מערכת סופגניות
        if (!area.decorations || !area.decorations.includes('donut_system')) continue;

        const areaSpawns = allSpawns.filter(s => s.area_id === area.area_id);
        
        // א. רענון סופגניות ישנות - כדי שהמיקומים ישתנו גם אם לא אוספים
        // מוחקים סופגניה אחת ישנה (מעל 5 דקות) בכל סבב כדי לרענן מיקומים
        const staleTimestamp = Date.now() - (5 * 60 * 1000); 
        const staleDonut = areaSpawns.find(s => {
            // מנסים לחלץ זמן יצירה מה-ID אם אין שדה created_at
            const parts = s.spawn_id.split('_');
            const createdTime = parseInt(parts[1]) || 0;
            return createdTime < staleTimestamp;
        });

        if (staleDonut) {
            // מוחקים את הישנה
            console.log(`♻️ Recycling stale donut in ${area.area_id}`);
            await apiCall(`/entities/DonutSpawn`, 'DELETE', { id: staleDonut.id }); // או קריאה מתאימה למחיקה
            // השידור למחיקה יתבצע ע"י הסרתה ברשימה הבאה, או שאפשר לשדר יזום
            io.to(area.area_id).emit('donut_collected', { 
                area_id: area.area_id, 
                spawn_id: staleDonut.spawn_id,
                collected_by_player_id: 'system' // סימון שנמחק ע"י המערכת
            });
            // לא מייצרים חדשה מיד, ניתן ללוגיקה הרגילה למטה לעבוד
            continue; // נעבור לאזור הבא, ניתן ללופ הבא למלא את החסר
        }

        // ב. מילוי הדרגתי
        if (areaSpawns.length < MIN_DONUTS_PER_AREA) {
            // חסר כדי להגיע למינימום - מייצרים אחת בלבד בכל סבב כדי ליצור אפקט "טיפטוף"
            // ורק בסיכוי של 50% כדי שזה לא ירגיש רובוטי
            if (Math.random() > 0.5) {
                await spawnDonutInArea(area);
            }
        } else if (areaSpawns.length < MAX_DONUTS_PER_AREA) {
            // יש מינימום, רוצים עוד קצת גיוון? סיכוי נמוך יותר
            if (Math.random() > 0.85) { // 15% סיכוי
                await spawnDonutInArea(area);
            }
        }
    }
}

// אתחול המערכת
function initialize(socketIo, serviceKey, apiUrl) {
    io = socketIo;
    BASE44_SERVICE_KEY = serviceKey;
    BASE44_API_URL = apiUrl;

    console.log('🍩 Donut System Manager v3.0 (Perfect Sync) Initialized');
    
    // הפעלה ראשונית מיד
    maintainDonutCount();

    // הפעלת הלולאה
    setInterval(maintainDonutCount, SPAWN_CHECK_INTERVAL);
}

// הגדרת מאזיני סוקט (אם צריך)
function setupSocketHandlers(socket, players) {
    // כרגע האיסוף מתבצע דרך ה-API ואז משודר דרך הלקוח או השרת
    // הלקוח משדר 'client_collected_donut' לאחר הצלחה ב-API כדי לעדכן אחרים מיידית
    socket.on('client_collected_donut', (data) => {
        const p = players.get(socket.id);
        if (!p) return;

        // שידור לכל השחקנים האחרים באותו אזור שהסופגניה נאספה
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
