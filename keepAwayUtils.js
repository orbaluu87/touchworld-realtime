// ============================================================================
// Touch World - Keep-Away Mechanics
// ============================================================================

const { KEEP_AWAY_RADIUS } = require('./config');
const { players } = require('./state');

function calculateDistance(x1, y1, x2, y2) {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
}

function calculateSafePosition(playerX, playerY, adminX, adminY, radius) {
  const dx = playerX - adminX;
  const dy = playerY - adminY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance === 0) {
    return { x: adminX + radius + 10, y: adminY };
  }

  const nx = dx / distance;
  const ny = dy / distance;

  return { x: adminX + nx * (radius + 20), y: adminY + ny * (radius + 20) };
}

function pushAwayNearbyPlayers(adminPlayer, areaId, io) {
  const playersInArea = Array.from(players.values()).filter(
    p => p.current_area === areaId && p.playerId !== adminPlayer.playerId && p.admin_level === 'user'
  );

  const movedPlayers = [];

  for (const player of playersInArea) {
    const distance = calculateDistance(
      player.position_x,
      player.position_y,
      adminPlayer.position_x,
      adminPlayer.position_y
    );

    if (distance < KEEP_AWAY_RADIUS) {
      const safePos = calculateSafePosition(
        player.position_x,
        player.position_y,
        adminPlayer.position_x,
        adminPlayer.position_y,
        KEEP_AWAY_RADIUS
      );

      player.position_x = safePos.x;
      player.position_y = safePos.y;
      player.is_moving = false;
      player.destination_x = undefined;
      player.destination_y = undefined;

      movedPlayers.push({
        id: player.playerId,
        playerId: player.playerId,
        socketId: player.socketId,
        position_x: player.position_x,
        position_y: player.position_y,
        is_moving: false,
        direction: player.direction,
        animation_frame: "idle",
      });

      console.log(`🚫 Pushed ${player.username} away from admin ${adminPlayer.username}`);
    }
  }

  if (movedPlayers.length > 0) {
    io.to(areaId).emit("players_moved", movedPlayers);
  }
}

module.exports = { calculateDistance, calculateSafePosition, pushAwayNearbyPlayers };
