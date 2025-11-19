// donutSpawn.js
const fetch = require("node-fetch");

module.exports = {
    async spawnRandomDonut(io, BASE44_API_URL, BASE44_SERVICE_KEY, area_id, templates) {
        if (!templates || templates.length === 0) return null;

        // 🔥 בחירת טמפלט רנדומלי
        const template = templates[Math.floor(Math.random() * templates.length)];

        // 🔥 מיקום רנדומלי
        const position_x = Math.floor(150 + Math.random() * 1000);
        const position_y = Math.floor(200 + Math.random() * 500);

        // 🔥 יצירת מזהה ייחודי
        const spawn_id = `donut_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

        // 🔥 שמירה ב־Base44
        const response = await fetch(`${BASE44_API_URL}/entities/DonutSpawn`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
            },
            body: JSON.stringify({
                spawn_id,
                area_id,
                image_url: template.image_url,
                scale: template.scale || 1,
                collectible_type: template.collectible_type || "donut",
                position_x,
                position_y
            })
        });

        const saved = await response.json();

        // 🔥 שידור לכל השחקנים באזור
        io.to(area_id).emit("donut_respawned", {
            area_id,
            spawn: saved
        });

        console.log(`🍩 Spawned new donut in area ${area_id}`);

        return saved;
    }
};
