// ============================================================================
// Touch World - Server-Side Movement Loop
// ============================================================================

const { KEEP_AWAY_RADIUS } = require('./config');
const { players } = require('./state');
const { calculateDistance, calculateSafePosition } = require('./keepAwayUtils');

function startMovementLoop(io) {
  setInterval(() => {
    const updatesByArea = new Map();

    for (const [sid, player] of players) {
      if (!player.is_moving || player.destination_x === undefined || player.destination_y === undefined) {
        continue;
      }

      const dx = player.destination_x - player.position_x;
      const dy = player.destination_y - player.position_y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 5) {
        player.position_x = player.destination_x;
        player.position_y = player.destination_y;
        player.is_moving = false;
        player.destination_x = undefined;
        player.destination_y = undefined;
      } else {
        let moveSpeed = 10;
        if (player.active_transformation_settings?.speed) {
          moveSpeed *= Number(player.active_transformation_settings.speed) || 1;
        }

        player.position_x += (dx / distance) * moveSpeed;
        player.position_y += (dy / distance) * moveSpeed;
      }

      if (player.admin_level === 'user') {
        const adminsInArea = Array.from(players.values()).filter(
          admin => admin.current_area === player.current_area &&
                   admin.admin_level === 'admin' &&
                   admin.keep_away_mode === true
        );

        for (const admin of adminsInArea) {
          if (calculateDistance(player.position_x, player.position_y, admin.position_x, admin.position_y) < KEEP_AWAY_RADIUS) {
            const safePos = calculateSafePosition(
              player.position_x,
              player.position_y,
              admin.position_x,
              admin.position_y,
              KEEP_AWAY_RADIUS
            );

            player.position_x = safePos.x;
            player.position_y = safePos.y;
            player.is_moving = false;
            player.destination_x = undefined;
            player.destination_y = undefined;
          }
        }
      }

      const update = {
        id: player.playerId,
        playerId: player.playerId,
        socketId: sid,
        position_x: player.position_x,
        position_y: player.position_y,
        direction: player.direction,
        is_moving: player.is_moving,
        animation_frame: player.is_moving ? "walk" : "idle",
        is_invisible: player.is_invisible,
      };

      if (!updatesByArea.has(player.current_area)) {
        updatesByArea.set(player.current_area, []);
      }
      updatesByArea.get(player.current_area).push(update);
    }

    for (const [areaId, updates] of updatesByArea) {
      io.to(areaId).emit("players_moved", updates);
    }
  }, 50);
}

module.exports = { startMovementLoop };
