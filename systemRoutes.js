export default function setupSystemRoutes(app, io, players, BASE44_SERVICE_KEY, getSocketIdByPlayerId) {
  // ---------- System Updates ----------
  app.post("/system/update_player", (req, res) => {
    const authHeader = req.headers.authorization;
    const key = authHeader && authHeader.startsWith("Bearer ") ? authHeader.substring(7) : null;
    
    if (key !== BASE44_SERVICE_KEY) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const { playerId, data } = req.body;
    if (!playerId || !data) {
      return res.status(400).json({ error: "Missing playerId or data" });
    }

    const sid = getSocketIdByPlayerId(playerId);
    if (sid) {
      const p = players.get(sid);
      if (p) {
        // Update local state
        if (data.active_transformation_image_url !== undefined) p.active_transformation_image_url = data.active_transformation_image_url;
        if (data.active_transformation_settings !== undefined) p.active_transformation_settings = data.active_transformation_settings;
        if (data.active_transformation_expires_at !== undefined) p.active_transformation_expires_at = data.active_transformation_expires_at;
        
        // Broadcast specific update
        io.to(p.current_area).emit("player_update", {
          id: p.playerId,
          playerId: p.playerId,
          socketId: p.socketId,
          ...data
        });
        
        console.log(`🔄 System updated player ${p.username}:`, data);
        return res.json({ success: true, updated: true });
      }
    }
    
    return res.json({ success: true, updated: false, message: "Player not connected" });
  });
}
