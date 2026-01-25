// ============================================================================
// Touch World - Moderation Manager
// מערכת מרכזית לניהול הרחקות, ניתוקים, השתקות ופעולות מודרציה
// ============================================================================

let io = null;
let BASE44_SERVICE_KEY = null;
let BASE44_API_URL = null;
let players = null;
let getSocketIdByPlayerId = null;

// ========== INITIALIZATION ==========
function initialize(ioInstance, serviceKey, apiUrl, playersMap, getSocketIdFunc) {
    io = ioInstance;
    BASE44_SERVICE_KEY = serviceKey;
    BASE44_API_URL = apiUrl;
    players = playersMap;
    getSocketIdByPlayerId = getSocketIdFunc;
    console.log('✅ Moderation Manager initialized');
}

// ========== KICK PLAYER ==========
async function kickPlayer(targetPlayerId, reason = null, adminUsername = null) {
    const targetSocketId = getSocketIdByPlayerId(targetPlayerId);
    if (!targetSocketId) {
        console.log(`⚠️ Target player ${targetPlayerId} not online`);
        return { success: false, error: 'Player not online' };
    }

    const targetPlayer = players.get(targetSocketId);
    if (!targetPlayer) {
        console.log(`⚠️ Target player ${targetPlayerId} not found in players map`);
        return { success: false, error: 'Player not found' };
    }

    console.log(`👢 ${adminUsername || 'Admin'} kicked ${targetPlayer.username} (${targetPlayerId})`);
    
    io.to(targetSocketId).emit("kicked_by_admin", { 
        reason: reason || 'הורחקת על ידי מנהל' 
    });
    
    setTimeout(() => {
        const socket = io.sockets.sockets.get(targetSocketId);
        if (socket) {
            socket.disconnect(true);
            console.log(`✅ Kicked and disconnected ${targetPlayer.username}`);
        }
        players.delete(targetSocketId);
    }, 1000);

    return { success: true, message: `${targetPlayer.username} נותק` };
}

// ========== BAN PLAYER ==========
async function banPlayer(targetPlayerId, durationMinutes, reason = null, adminUsername = null) {
    try {
        console.log(`🚫 Starting ban process for player: ${targetPlayerId}`);
        
        // עדכון ה-DB
        const updateUrl = `${BASE44_API_URL}/entities/Player/${targetPlayerId}`;
        
        const updateData = durationMinutes > 0 ? {
            is_banned: true,
            ban_expires_at: new Date(Date.now() + durationMinutes * 60000).toISOString(),
            ban_reason: reason || `הורחקת ל-${durationMinutes} דקות`
        } : {
            is_banned: true,
            ban_expires_at: null,
            ban_reason: reason || 'הורחקת על ידי מנהל'
        };

        const response = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            },
            body: JSON.stringify(updateData)
        });

        if (!response.ok) {
            throw new Error(`Failed to update player: ${response.statusText}`);
        }

        console.log(`✅ Database updated for player ${targetPlayerId}`);

        // ניתוק מיידי של השחקן
        const targetSocketId = getSocketIdByPlayerId(targetPlayerId);
        if (targetSocketId) {
            const targetPlayer = players.get(targetSocketId);
            console.log(`🚫 Disconnecting banned player ${targetPlayer?.username} immediately`);
            
            // שליחת אירוע banned_by_admin לפני ניתוק
            io.to(targetSocketId).emit("banned_by_admin", {
                reason: updateData.ban_reason,
                is_permanent: durationMinutes === 0,
                expires_at: updateData.ban_expires_at
            });
            
            // ניתוק מיידי
            setTimeout(() => {
                const socket = io.sockets.sockets.get(targetSocketId);
                if (socket) {
                    socket.disconnect(true);
                    console.log(`✅ Banned player ${targetPlayer?.username} disconnected`);
                }
                players.delete(targetSocketId);
            }, 1000);
        } else {
            console.log(`⚠️ Player ${targetPlayerId} not currently online`);
        }

        return { 
            success: true, 
            message: `שחקן הורחק ${durationMinutes > 0 ? `ל-${durationMinutes} דקות` : 'לצמיתות'} ונותק מהמשחק` 
        };

    } catch (error) {
        console.error('❌ Ban error:', error);
        return { success: false, error: error.message };
    }
}

// ========== UNBAN PLAYER ==========
async function unbanPlayer(targetPlayerId) {
    try {
        const updateUrl = `${BASE44_API_URL}/entities/Player/${targetPlayerId}`;
        
        const response = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            },
            body: JSON.stringify({
                is_banned: false,
                ban_expires_at: null,
                ban_reason: null
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to unban: ${response.statusText}`);
        }

        console.log(`✅ Player ${targetPlayerId} unbanned`);
        
        return { success: true, message: 'שחקן שוחרר מהרחקה' };

    } catch (error) {
        console.error('❌ Unban error:', error);
        return { success: false, error: error.message };
    }
}

// ========== MUTE PLAYER ==========
async function mutePlayer(targetPlayerId, durationMinutes, reason = null) {
    try {
        // קבלת UserChatStatus
        const chatStatusUrl = `${BASE44_API_URL}/entities/UserChatStatus?user_id=${targetPlayerId}`;
        
        const getResponse = await fetch(chatStatusUrl, {
            headers: {
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            }
        });

        let chatStatus = null;
        if (getResponse.ok) {
            const results = await getResponse.json();
            chatStatus = results.length > 0 ? results[0] : null;
        }

        // עדכון או יצירה
        const updateData = durationMinutes > 0 ? {
            user_id: targetPlayerId,
            is_chat_blocked: true,
            chat_blocked_until: new Date(Date.now() + durationMinutes * 60000).toISOString()
        } : {
            user_id: targetPlayerId,
            is_permanently_blocked: true,
            permanent_block_reason: reason || 'הושתקת על ידי מנהל',
            permanently_blocked_at: new Date().toISOString()
        };

        let response;
        if (chatStatus) {
            response = await fetch(`${BASE44_API_URL}/entities/UserChatStatus/${chatStatus.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
                },
                body: JSON.stringify(updateData)
            });
        } else {
            response = await fetch(`${BASE44_API_URL}/entities/UserChatStatus`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
                },
                body: JSON.stringify(updateData)
            });
        }

        if (!response.ok) {
            throw new Error(`Failed to mute: ${response.statusText}`);
        }

        console.log(`🔇 Muted player ${targetPlayerId} - ${durationMinutes > 0 ? `${durationMinutes} minutes` : 'PERMANENT'}`);
        
        return { 
            success: true, 
            message: `שחקן הושתק ${durationMinutes > 0 ? `ל-${durationMinutes} דקות` : 'לצמיתות'}` 
        };

    } catch (error) {
        console.error('❌ Mute error:', error);
        return { success: false, error: error.message };
    }
}

// ========== UNMUTE PLAYER ==========
async function unmutePlayer(targetPlayerId) {
    try {
        const chatStatusUrl = `${BASE44_API_URL}/entities/UserChatStatus?user_id=${targetPlayerId}`;
        
        const getResponse = await fetch(chatStatusUrl, {
            headers: {
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            }
        });

        if (!getResponse.ok) {
            return { success: false, error: 'Chat status not found' };
        }

        const results = await getResponse.json();
        if (results.length === 0) {
            return { success: true, message: 'שחקן לא מושתק' };
        }

        const chatStatus = results[0];
        
        const response = await fetch(`${BASE44_API_URL}/entities/UserChatStatus/${chatStatus.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            },
            body: JSON.stringify({
                is_chat_blocked: false,
                chat_blocked_until: null,
                is_permanently_blocked: false,
                permanent_block_reason: null,
                permanently_blocked_at: null
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to unmute: ${response.statusText}`);
        }

        console.log(`🔊 Unmuted player ${targetPlayerId}`);
        
        return { success: true, message: 'שחקן שוחרר מהשתקה' };

    } catch (error) {
        console.error('❌ Unmute error:', error);
        return { success: false, error: error.message };
    }
}

// ========== LOG ADMIN ACTION ==========
async function logAdminAction(adminPlayerId, adminUsername, action, targetPlayerId, details) {
    try {
        await fetch(`${BASE44_API_URL}/entities/SecurityLog`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BASE44_SERVICE_KEY}`
            },
            body: JSON.stringify({
                user_id: adminPlayerId,
                username: adminUsername,
                action: `admin_${action}`,
                details: details || '',
                severity: 'info'
            })
        });
    } catch (error) {
        console.error('❌ Failed to log admin action:', error);
    }
}

// ========== SETUP SOCKET HANDLERS ==========
function setupSocketHandlers(socket, playersMap) {
    // 👢 KICK
    socket.on("admin_kick_player", async (data = {}) => {
        const admin = playersMap.get(socket.id);
        if (!admin || admin.admin_level !== 'admin') return;

        const result = await kickPlayer(data.target_player_id, data.reason, admin.username);
        
        if (result.success) {
            await logAdminAction(admin.playerId, admin.username, 'kick', data.target_player_id, result.message);
        }
    });

    // 🚫 BAN
    socket.on("admin_ban_player", async (data = {}) => {
        const admin = playersMap.get(socket.id);
        if (!admin || admin.admin_level !== 'admin') return;

        const durationMinutes = data.is_permanent ? 0 : (data.duration_minutes || 0);
        const result = await banPlayer(data.target_player_id, durationMinutes, data.reason, admin.username);
        
        if (result.success) {
            await logAdminAction(admin.playerId, admin.username, 'ban', data.target_player_id, result.message);
        }
    });
}

module.exports = {
    initialize,
    setupSocketHandlers,
    kickPlayer,
    banPlayer,
    unbanPlayer,
    mutePlayer,
    unmutePlayer,
    logAdminAction
};
