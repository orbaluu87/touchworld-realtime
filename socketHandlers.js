// ============================================================================
// Touch World - Socket.IO Event Handlers
// ============================================================================

const { BASE44_API_URL, BASE44_SERVICE_KEY, KEEP_AWAY_RADIUS } = require('./config');
const { players, chatRateLimit } = require('./state');
const { safePlayerView, verifyTokenWithBase44 } = require('./playerUtils');
const { calculateDistance, pushAwayNearbyPlayers } = require('./keepAwayUtils');
const donutManager = require('./donutManager');
const tradeManager = require('./tradeManager');
const systemRoutes = require('./systemRoutes');
const moderationManager = require('./moderationManager');
const mishloachManotManager = require('./mishloachManotManager');

const now = () => Date.now();

function setupSocketHandlers(io) {
  io.on("connection", async (socket) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.emit("disconnect_reason", "no_token");
      socket.disconnect(true);
      return;
    }

    const playerData = await verifyTokenWithBase44(token);
    if (!playerData) {
      socket.emit("disconnect_reason", "invalid_token");
      socket.disconnect(true);
      return;
    }

    for (const [sid, p] of players.entries()) {
      if (p.playerId === playerData.playerId && sid !== socket.id) {
        console.log(`⚠️ Kicking duplicate session for ${p.username} (token refresh)`);
        io.to(sid).emit("disconnect_reason", "logged_in_elsewhere");
        io.sockets.sockets.get(sid)?.disconnect();
        players.delete(sid);
      }
    }

    const player = {
      socketId: socket.id,
      playerId: playerData.playerId,
      user_id: playerData.user_id || playerData.playerId,
      username: playerData.username,
      display_name: playerData.display_name,
      admin_level: playerData.admin_level,
      current_area: playerData.current_area || "betach",
      equipment: playerData.equipment || {},
      position_x: playerData.position_x ?? 600,
      position_y: playerData.position_y ?? 400,
      direction: playerData.direction || "front",
      is_moving: false,
      animation_frame: "idle",
      destination_x: undefined,
      destination_y: undefined,
      is_invisible: playerData.is_invisible ?? false,
      keep_away_mode: playerData.keep_away_mode ?? false,
      active_subscription_tier: playerData.active_subscription_tier || 'none',
      subscription_expires_at: playerData.subscription_expires_at,
      active_transformation_image_url: playerData.active_transformation_image_url,
      active_transformation_settings: playerData.active_transformation_settings,
      active_transformation_expires_at: playerData.active_transformation_expires_at,
      visual_override_data: playerData.visual_override_data,
      visual_override_expires_at: playerData.visual_override_expires_at,
      _lastMoveLogAt: 0,
    };

    players.set(socket.id, player);
    socket.join(player.current_area);

    const areaPeers = Array.from(players.values())
      .filter(p => p.current_area === player.current_area && p.socketId !== socket.id)
      .map(safePlayerView);

    socket.emit("identify_ok", safePlayerView(player));
    socket.emit("current_players", areaPeers);

    const currentDonuts = donutManager.getDonutsForArea(player.current_area);
    socket.emit("donuts_sync", currentDonuts);

    socket.to(player.current_area).emit("player_joined", safePlayerView(player));

    console.log(`🟢 Connected: ${player.username} (${player.current_area})`);

    if (donutManager && typeof donutManager.setupSocketHandlers === 'function') {
      donutManager.setupSocketHandlers(socket, players);
    }
    if (tradeManager && typeof tradeManager.setupSocketHandlers === 'function') {
      tradeManager.setupSocketHandlers(socket);
    }
    if (systemRoutes && typeof systemRoutes.setupSocketHandlers === 'function') {
      systemRoutes.setupSocketHandlers(socket, players);
    }
    if (moderationManager && typeof moderationManager.setupSocketHandlers === 'function') {
      moderationManager.setupSocketHandlers(socket, players);
    }
    if (mishloachManotManager && typeof mishloachManotManager.setupSocketHandlers === 'function') {
      mishloachManotManager.setupSocketHandlers(socket, players);
    }

    socket.on("refresh_token", async (data = {}) => {
      const { newToken } = data;
      if (!newToken) {
        socket.emit("token_refresh_failed", { error: "no_token_provided" });
        return;
      }

      const newPlayerData = await verifyTokenWithBase44(newToken);
      if (!newPlayerData) {
        socket.emit("token_refresh_failed", { error: "invalid_token" });
        return;
      }

      if (newPlayerData.playerId !== player.playerId) {
        console.error(`⚠️ SECURITY: ${player.username} tried to refresh with different player token!`);
        socket.emit("token_refresh_failed", { error: "player_mismatch" });
        socket.disconnect(true);
        return;
      }

      Object.assign(player, {
        equipment: newPlayerData.equipment,
        active_transformation_image_url: newPlayerData.active_transformation_image_url,
        active_transformation_settings: newPlayerData.active_transformation_settings,
        active_transformation_expires_at: newPlayerData.active_transformation_expires_at,
        visual_override_data: newPlayerData.visual_override_data,
        visual_override_expires_at: newPlayerData.visual_override_expires_at,
        active_subscription_tier: newPlayerData.active_subscription_tier,
        subscription_expires_at: newPlayerData.subscription_expires_at,
      });

      console.log(`🔄 Token refreshed for ${player.username}`);
      socket.emit("token_refresh_ok", { success: true });

      io.to(player.current_area).emit("player_update", {
        id: player.playerId,
        playerId: player.playerId,
        socketId: player.socketId,
        equipment: player.equipment,
        active_transformation_image_url: player.active_transformation_image_url,
        active_transformation_settings: player.active_transformation_settings,
        visual_override_data: player.visual_override_data,
      });
    });

    socket.on("move_to", (data = {}) => {
      const p = players.get(socket.id);
      if (!p) return;

      const { x, y } = data;
      if (typeof x !== "number" || typeof y !== "number") return;

      if (p.admin_level === 'user') {
        const adminsInArea = Array.from(players.values()).filter(
          admin => admin.current_area === p.current_area &&
                   admin.admin_level === 'admin' &&
                   admin.keep_away_mode === true
        );

        for (const admin of adminsInArea) {
          if (calculateDistance(x, y, admin.position_x, admin.position_y) < KEEP_AWAY_RADIUS) {
            socket.emit("keep_away_blocked", {
              message: `לא ניתן להתקרב למנהל ${admin.username}`,
              admin_username: admin.username,
            });
            return;
          }
        }
      }

      p.destination_x = x;
      p.destination_y = y;
      p.is_moving = true;

      const dx = x - p.position_x;
      const dy = y - p.position_y;
      if (Math.abs(dx) > Math.abs(dy)) {
        p.direction = dx > 0 ? "e" : "w";
      } else if (Math.abs(dy) > 0) {
        p.direction = dy > 0 ? "s" : "n";
      }
    });

    socket.on("player_update", (data = {}) => {
      const p = players.get(socket.id);
      if (!p) return;

      if (data.playerId && data.playerId !== p.playerId) {
        console.error(`⚠️ SECURITY: ${p.username} tried to update another player!`);
        return;
      }

      if (Number.isFinite(data.x)) p.position_x = data.x;
      if (Number.isFinite(data.y)) p.position_y = data.y;
      if (typeof data.direction === "string") p.direction = data.direction;
      if (typeof data.is_moving === "boolean") p.is_moving = data.is_moving;
      if (typeof data.animation_frame === "string") p.animation_frame = data.animation_frame;
      if (data.equipment && typeof data.equipment === "object") p.equipment = data.equipment;

      if (typeof data.is_invisible === "boolean" && p.admin_level === 'admin') {
        p.is_invisible = data.is_invisible;
      }

      if (typeof data.keep_away_mode === "boolean" && p.admin_level === 'admin') {
        p.keep_away_mode = data.keep_away_mode;
        if (data.keep_away_mode) {
          pushAwayNearbyPlayers(p, p.current_area, io);
        }
      }

      io.to(p.current_area).emit("player_update", {
        id: p.playerId,
        playerId: p.playerId,
        socketId: p.socketId,
        equipment: p.equipment,
        is_invisible: p.is_invisible,
      });
    });

    socket.on("chat_message", async (data = {}) => {
      const p = players.get(socket.id);
      if (!p) return;

      const msg = (data.message ?? data.text ?? "").toString().trim();
      if (!msg) return;

      const key = `chat_${p.playerId}`;
      const last = chatRateLimit.get(key) || 0;
      if (now() - last < 1000) {
        socket.emit("chat_rate_limited");
        return;
      }
      chatRateLimit.set(key, now());

      try {
        const bannedWordsResponse = await fetch(`${BASE44_API_URL}/entities/BannedWord`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
          },
        });

        if (bannedWordsResponse.ok) {
          const bannedWords = await bannedWordsResponse.json();
          const bannedWordsList = bannedWords.map(w => w.word.toLowerCase().trim());

          const messageToCheck = msg.toLowerCase().replace(/\s+/g, '').replace(/[^\u0590-\u05FFa-z0-9]/g, '');

          for (const bannedWord of bannedWordsList) {
            const bannedWordNoSpaces = bannedWord.replace(/\s+/g, '').replace(/[^\u0590-\u05FFa-z0-9]/g, '');
            if (messageToCheck.includes(bannedWordNoSpaces)) {
              console.log(`🚫 BLOCKED: "${msg}" contains "${bannedWord}"`);
              return;
            }
          }
        }
      } catch (error) {
        console.error('❌ Error checking banned words:', error);
      }

      io.to(p.current_area).emit("chat_message", {
        id: p.playerId,
        playerId: p.playerId,
        username: p.username,
        admin_level: p.admin_level,
        message: msg,
        timestamp: Date.now(),
      });
    });

    socket.on("admin_config_updated", (data = {}) => {
      const adminPlayer = players.get(socket.id);
      if (!adminPlayer) return;
      if (!["admin", "senior_touch"].includes(adminPlayer.admin_level)) return;

      console.log(`⚙️ Admin ${adminPlayer.username} updated config: ${data.type}`);
      io.emit("config_refresh_required", { type: data.type });
    });

    socket.on("admin_system_message", (messageData = {}) => {
      const adminPlayer = players.get(socket.id);
      if (!adminPlayer) return;
      if (!["admin", "senior_touch"].includes(adminPlayer.admin_level)) return;

      const payload = {
        id: "system",
        username: messageData.sender_name || adminPlayer.username,
        admin_level: adminPlayer.admin_level,
        message: String(messageData.message || "").slice(0, 300),
        timestamp: Date.now(),
      };

      const target = messageData.target_area || "all";
      if (target === "current") {
        io.to(adminPlayer.current_area).emit("chat_message", payload);
      } else {
        io.emit("chat_message", payload);
      }
    });

    socket.on("change_area", (data = {}) => {
      const p = players.get(socket.id);
      if (!p) return;

      const newArea = data.newArea;
      if (!newArea || newArea === p.current_area) return;

      const oldArea = p.current_area;
      socket.leave(oldArea);
      p.current_area = newArea;
      socket.join(newArea);

      socket.to(oldArea).emit("player_area_changed", { id: p.playerId, playerId: p.playerId });

      const peers = Array.from(players.values())
        .filter(pp => pp.current_area === newArea && pp.socketId !== socket.id)
        .map(safePlayerView);

      socket.emit("current_players", peers);
      socket.to(newArea).emit("player_joined", safePlayerView(p));

      const newAreaDonuts = donutManager.getDonutsForArea(newArea);
      socket.emit("donuts_sync", newAreaDonuts);
    });

    socket.on("disconnect", (reason) => {
      const p = players.get(socket.id);
      if (!p) return;

      console.log(`🔴 Disconnect: ${p.username} | ${reason}`);
      socket.to(p.current_area).emit("player_disconnected", p.playerId);

      if (tradeManager && typeof tradeManager.handleDisconnect === 'function') {
        tradeManager.handleDisconnect(socket.id);
      }

      players.delete(socket.id);
    });
  });
}

module.exports = { setupSocketHandlers };
