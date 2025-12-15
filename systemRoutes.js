// systemRoutes.js - Potion System Handler

module.exports = {
  setupRoutes: function(app, io, players, getSocketIdByPlayerId, BASE44_SERVICE_KEY) {
    // ✅ Endpoint to fetch online players
    app.get("/system/online_players", (req, res) => {
      const authHeader = req.headers.authorization;
      const key = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null;
      
      if (key !== BASE44_SERVICE_KEY) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const onlinePlayers = Array.from(players.values()).map(p => ({
        id: p.playerId,
        username: p.username,
        area: p.current_area,
      }));

      return res.json({ success: true, players: onlinePlayers });
    });

    app.post("/system/update_player", (req, res) => {
      const authHeader = req.headers.authorization;
      const key = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null;
      
      if (key !== BASE44_SERVICE_KEY) {
        console.error("❌ Unauthorized");
        return res.status(403).json({ error: "Unauthorized" });
      }

      const { playerId, data } = req.body;
      if (!playerId || !data) {
        console.error("❌ Missing params");
        return res.status(400).json({ error: "Missing playerId or data" });
      }

      const sid = getSocketIdByPlayerId(playerId);
      if (sid) {
        const p = players.get(sid);
        if (p) {
          // Update in-memory
          if (data.active_transformation_image_url !== undefined) p.active_transformation_image_url = data.active_transformation_image_url;
          if (data.active_transformation_settings !== undefined) p.active_transformation_settings = data.active_transformation_settings;
          if (data.active_transformation_expires_at !== undefined) p.active_transformation_expires_at = data.active_transformation_expires_at;
          if (data.visual_override_data !== undefined) p.visual_override_data = data.visual_override_data;
          if (data.visual_override_expires_at !== undefined) p.visual_override_expires_at = data.visual_override_expires_at;
          if (data.is_invisible !== undefined) p.is_invisible = data.is_invisible;
          
          // Broadcast
          io.to(p.current_area).emit("player_update", {
            id: p.playerId,
            playerId: p.playerId,
            socketId: p.socketId,
            ...data
          });
          
          console.log(`🧪 Potion applied to ${p.username}`);
          return res.json({ success: true, updated: true });
        }
      }
      
      return res.json({ success: true, updated: false, message: "Player offline" });
    });
  },
  
  initialize: function() {
    console.log('✅ System Routes ready');
  },
  
  setupSocketHandlers: function() {
    // Future socket handlers
  }
};
