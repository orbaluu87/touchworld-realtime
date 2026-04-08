// ============================================================================
// Touch World - Player Utility Functions
// ============================================================================

const { VERIFY_TOKEN_URL, BASE44_SERVICE_KEY } = require('./config');
const { players } = require('./state');

function safePlayerView(p) {
  if (!p) return null;
  return {
    id: p.playerId,
    playerId: p.playerId,
    user_id: p.user_id,
    socketId: p.socketId,
    username: p.username,
    current_area: p.current_area,
    admin_level: p.admin_level,
    equipment: p.equipment || {},
    position_x: p.position_x,
    position_y: p.position_y,
    direction: p.direction || "front",
    is_moving: !!p.is_moving,
    animation_frame: p.animation_frame || "idle",
    move_speed: 120,
    is_invisible: !!p.is_invisible,
    active_transformation_image_url: p.active_transformation_image_url,
    active_transformation_settings: p.active_transformation_settings,
    active_transformation_expires_at: p.active_transformation_expires_at,
    visual_override_data: p.visual_override_data,
    visual_override_expires_at: p.visual_override_expires_at,
    active_subscription_tier: p.active_subscription_tier || 'none',
    subscription_expires_at: p.subscription_expires_at,
  };
}

function getSocketIdByPlayerId(playerId) {
  for (const [sid, p] of players.entries()) {
    if (p.playerId === playerId) return sid;
  }
  return null;
}

function normalizePlayerShape(playerData) {
  const playerId = playerData?.id ?? playerData?.playerId;

  return {
    playerId,
    user_id: playerData?.user_id || playerId,
    username: playerData?.username ?? "Guest",
    display_name: playerData?.display_name,
    current_area: playerData?.current_area ?? "betach",
    admin_level: playerData?.admin_level ?? "user",
    equipment: {
      skin_code: playerData?.skin_code,
      equipped_hair: playerData?.equipped_hair,
      equipped_top: playerData?.equipped_top,
      equipped_pants: playerData?.equipped_pants,
      equipped_hat: playerData?.equipped_hat,
      equipped_necklace: playerData?.equipped_necklace,
      equipped_halo: playerData?.equipped_halo,
      equipped_shoes: playerData?.equipped_shoes,
      equipped_gloves: playerData?.equipped_gloves,
      equipped_face: playerData?.equipped_face,
      equipped_accessory: playerData?.equipped_accessory,
      ...(playerData?.equipment || {}),
    },
    position_x: Number.isFinite(playerData?.position_x) ? playerData.position_x : 600,
    position_y: Number.isFinite(playerData?.position_y) ? playerData.position_y : 400,
    direction: playerData?.direction ?? "front",
    keep_away_mode: !!playerData?.keep_away_mode,
    is_invisible: !!playerData?.is_invisible,
    level: playerData?.level || 1,
    xp: playerData?.xp || 0,
    coins: playerData?.coins || 500,
    gems: playerData?.gems || 10,
    active_subscription_tier: playerData?.active_subscription_tier || 'none',
    subscription_expires_at: playerData?.subscription_expires_at,
    active_transformation_image_url: playerData?.active_transformation_image_url,
    active_transformation_settings: playerData?.active_transformation_settings,
    active_transformation_expires_at: playerData?.active_transformation_expires_at,
    visual_override_data: playerData?.visual_override_data,
    visual_override_expires_at: playerData?.visual_override_expires_at,
  };
}

async function verifyTokenWithBase44(token) {
  try {
    const response = await fetch(VERIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`HTTP ${response.status}: ${txt}`);
    }

    const result = await response.json();
    if (!result?.success || !result?.player) {
      throw new Error(result?.error || "verifyWebSocketToken failed");
    }

    const normalized = normalizePlayerShape(result.player);
    if (!normalized.playerId) {
      throw new Error("normalized playerId missing");
    }

    if (result.sessionId && result.player.session_id) {
      if (result.sessionId !== result.player.session_id) {
        throw new Error("Session mismatch - possible token hijacking");
      }
    }

    console.log(`✅ Token OK: ${normalized.username} (${normalized.playerId})`);
    return normalized;
  } catch (err) {
    console.error("❌ Token Error:", err.message);
    return null;
  }
}

module.exports = {
  safePlayerView,
  getSocketIdByPlayerId,
  normalizePlayerShape,
  verifyTokenWithBase44,
};
