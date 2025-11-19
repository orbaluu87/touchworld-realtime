import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { spawn_id, player_id, area_id } = await req.json();

        if (!spawn_id || !player_id || !area_id) {
            return Response.json({ error: 'נתונים חסרים' }, { status: 400 });
        }

        // בדיקה שהספאון קיים
        const spawns = await base44.asServiceRole.entities.DonutSpawn.filter({ 
            spawn_id,
            area_id
        });

        if (spawns.length === 0) {
            return Response.json({ error: 'הסופגניה כבר נאספה' }, { status: 400 });
        }

        const spawn = spawns[0];

        // ✅ מחיקה מיידית מה-DB
        await base44.asServiceRole.entities.DonutSpawn.delete(spawn.id);

        // עדכון counter של השחקן
        const existingCounters = await base44.asServiceRole.entities.CollectibleCounter.filter({
            player_id,
            collectible_type: spawn.collectible_type
        });

        if (existingCounters.length > 0) {
            await base44.asServiceRole.entities.CollectibleCounter.update(existingCounters[0].id, {
                quantity: (existingCounters[0].quantity || 0) + 1
            });
        } else {
            await base44.asServiceRole.entities.CollectibleCounter.create({
                player_id,
                collectible_type: spawn.collectible_type,
                quantity: 1,
                collectible_name: spawn.collectible_type,
                collectible_image: spawn.image_url
            });
        }

        console.log(`✅ ${user.username} collected ${spawn.collectible_type} in ${area_id}`);

        return Response.json({ 
            success: true,
            collected: spawn.collectible_type
        });

    } catch (error) {
        console.error('Collect donut error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});
