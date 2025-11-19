// ============================================================================
// DONUT SYSTEM MANAGER (Server Side)
// ============================================================================

const fetch = require("node-fetch");

// קונפיגורציה
const MIN_DONUTS_PER_AREA = 3;
const MAX_DONUTS_PER_AREA = 8;
const SPAWN_CHECK_INTERVAL = 10000; // בדיקה כל 10 שניות

let BASE44_SERVICE_KEY;
let BASE44_API_URL;
let io;

// פונקציית עזר לקריאות API
async function apiCall(endpoint, method = 'GET', body = null) {
    try {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            }
        };
        if (body) options.body = JSON.stringify(body);
        
        const res = await fetch(`${BASE44_API_URL}${endpoint}`, options);
        if (!res.ok) throw new Error(`API Error ${res.status}: ${await res.text()}`);
        return await res.json();
    } catch (err) {
        console.error(`API Call Failed [${endpoint}]:`, err.message);
        return null;
    }
}

// בדיקת חסימות
function isPositionBlocked(x, y, collisionMap) {
    if (!collisionMap || !Array.isArray(collisionMap)) return false;
    
    const point = { x, y };
    
    for (const shape of collisionMap) {
        if (shape.type === 'polygon' && shape.points) {
            // Ray casting algorithm
            let inside = false;
            for (let i = 0, j = shape.points.length - 1; i < shape.points.length; j = i++) {
                const xi = shape.points[i].x, yi = shape.points[i].y;
                const xj = shape.points[j].x, yj = shape.points[j].y;
                
                const intersect = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            if (inside) return true;
        }
    }
    return false;
}

async function spawnDonutInArea(area) {
    if (!area.decorations) return;
    
    let templates = [];
    try {
        const decos = JSON.parse(area.decorations);
        templates = decos.filter(d => d.action_type === 'donut_system');
    } catch (e) { return; }

    if (templates.length === 0) return;

    // טעינת מפת התנגשויות
    let collisionMap = [];
    try {
        collisionMap = area.collision_map ? JSON.parse(area.collision_map) : [];
    } catch (e) {}

    // מציאת מיקום פנוי
    let pos = null;
    for (let i = 0; i < 20; i++) {
        const x = 100 + Math.random() * (1380 - 200);
        const y = 100 + Math.random() * (770 - 200);
        if (!isPositionBlocked(x, y, collisionMap)) {
            pos = { x, y };
            break;
        }
    }

    if (!pos) return; // לא נמצא מיקום

    const template = templates[Math.floor(Math.random() * templates.length)];
    
    const spawnData = {
        area_id: area.area_id,
        spawn_id: `donut_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        collectible_type: template.name || 'donut',
        position_x: Math.round(pos.x),
        position_y: Math.round(pos.y),
        image_url: template.image_url,
        scale: template.scale || 1
    };

    // שמירה במסד נתונים
    // שינוי נתיב: הסרת /create כי השרת מפרש אותו כ-ID
    const created = await apiCall('/entities/DonutSpawn', 'POST', spawnData);

    if (created) {
        console.log(`🍩 Spawned ${created.collectible_type} in ${area.area_id}`);
        io.to(area.area_id).emit('donut_spawned', {
            area_id: area.area_id,
            spawn: created
        });
    }
}

async function maintainDonutCount() {
    // שינוי נתיב: הסרת /list כי השרת מפרש אותו כ-ID
    const areas = await apiCall('/entities/Area');
    if (!areas || !Array.isArray(areas)) {
        console.error('Invalid areas response:', areas);
        return;
    }

    // קבלת כל הסופגניות הקיימות כרגע
    const allSpawns = await apiCall('/entities/DonutSpawn');
    if (!allSpawns || !Array.isArray(allSpawns)) {
        console.error('Invalid spawns response:', allSpawns);
        return;
    }

    for (const area of areas) {
        // בדיקה אם האזור תומך בסופגניות
        if (!area.decorations || !area.decorations.includes('donut_system')) continue;

        const areaSpawns = allSpawns.filter(s => s.area_id === area.area_id);
        
        if (areaSpawns.length < MIN_DONUTS_PER_AREA) {
            // צריך לייצר
            const missing = MIN_DONUTS_PER_AREA - areaSpawns.length;
            // מייצרים אחד בכל מחזור כדי לא להעמיס
            if (missing > 0) {
                await spawnDonutInArea(area);
            }
        } else if (areaSpawns.length < MAX_DONUTS_PER_AREA) {
            // סיכוי קטן לייצר עוד אחד אם לא הגענו למקסימום
            if (Math.random() > 0.7) {
                await spawnDonutInArea(area);
            }
        }
    }
}

function initialize(socketIo, serviceKey, apiUrl) {
    io = socketIo;
    BASE44_SERVICE_KEY = serviceKey;
    BASE44_API_URL = apiUrl;

    console.log('🍩 Donut System Initialized (Robust Mode)');
    
    // ניקוי ראשוני (אופציונלי, כרגע לא מפעיל כדי לא למחוק באמצע משחק)
    // clearAllSpawns();

    // התחלת הלולאה
    setInterval(maintainDonutCount, SPAWN_CHECK_INTERVAL);
    
    // הרצה מיידית
    maintainDonutCount();
}

function setupSocketHandlers(socket, players) {
    // הלקוח לא אמור לשדר אירועי איסוף ישירות לסוקט, אלא לקרוא ל-API
    // ה-API ישדר לכולם דרך הסוקט (אבל כרגע השרת לא מאזין ל-API events)
    // אז נשאיר את זה כאן למקרה שרוצים אופטימיזציה, אבל ה-Source of Truth הוא ה-API
    
    // בעצם, ה-collectDonut function צריכה לשדר לסוקט... אבל היא רצה בסביבה נפרדת (Deno Deploy)
    // אז השרת הזה (Node) צריך להאזין לשינויים או שהלקוח שביצע את האיסוף ישדר 'אני אספתי'
    // הפתרון הכי פשוט: הלקוח שקיבל תשובה חיובית מה-API ישדר 'collected' לכולם
    
    socket.on('client_collected_donut', (data) => {
        // אימות בסיסי
        const p = players.get(socket.id);
        if (!p) return;

        // הפצה לכולם באזור
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
