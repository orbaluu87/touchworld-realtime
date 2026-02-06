// ============================================================================
// Mishloach Manot Manager - Real-time Gift Notifications
// ============================================================================

let io = null;
let BASE44_SERVICE_KEY = null;
let BASE44_API_URL = null;
let players = null;
let getSocketIdByPlayerId = null;

function initialize(_io, _serviceKey, _apiUrl, _players, _getSocketIdByPlayerId) {
    io = _io;
    BASE44_SERVICE_KEY = _serviceKey;
    BASE44_API_URL = _apiUrl;
    players = _players;
    getSocketIdByPlayerId = _getSocketIdByPlayerId;
    console.log('✅ Mishloach Manot Manager initialized');
}

function setupSocketHandlers(socket, playersMap) {
    // 🎁 שליחת משלוח מנות - שידור בזמן אמת למקבל
    socket.on("send_mishloach_manot", async (data = {}) => {
        const sender = playersMap.get(socket.id);
        if (!sender) return;

        const { 
            receiverPlayerId, 
            receiverUsername,
            giftCoins, 
            giftGems, 
            itemsCount,
            giftItems,
            message,
            giftId 
        } = data;

        if (!receiverPlayerId) {
            socket.emit("mishloach_manot_error", { error: "missing_receiver" });
            return;
        }

        console.log(`🎁 ${sender.username} sent mishloach manot to ${receiverUsername}`, { giftItems });

        // 📡 שידור למקבל אם הוא מחובר
        const receiverSocketId = getSocketIdByPlayerId(receiverPlayerId);
        
        const giftNotification = {
            type: "mishloach_manot",
            gift_id: giftId,
            from_username: sender.username,
            from_player_id: sender.playerId,
            gift_coins: giftCoins || 0,
            gift_gems: giftGems || 0,
            items_count: itemsCount || 0,
            gift_items: giftItems || [],
            message: message || "",
            timestamp: Date.now()
        };

        if (receiverSocketId) {
            // המקבל מחובר - שלח לו התראה בזמן אמת
            io.to(receiverSocketId).emit("mishloach_manot_received", giftNotification);
            console.log(`📬 Real-time notification sent to ${receiverUsername}`);
        }

        // אישור לשולח
        socket.emit("mishloach_manot_sent_ok", {
            success: true,
            receiver_online: !!receiverSocketId,
            receiver_username: receiverUsername
        });
    });

    // 🔔 אישור קבלת משלוח מנות
    socket.on("acknowledge_mishloach_manot", async (data = {}) => {
        const player = playersMap.get(socket.id);
        if (!player) return;

        const { giftId } = data;
        if (!giftId) return;

        console.log(`✅ ${player.username} acknowledged mishloach manot ${giftId}`);

        // עדכון סטטוס המתנה ל-received בדאטהבייס
        try {
            await fetch(`${BASE44_API_URL}/entities/Gift/${giftId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
                },
                body: JSON.stringify({ status: "received" }),
            });
        } catch (error) {
            console.error("❌ Error updating gift status:", error);
        }
    });

    // 📋 בקשה לרשימת משלוחי מנות ממתינים
    socket.on("get_pending_mishloach_manot", async () => {
        const player = playersMap.get(socket.id);
        if (!player) return;

        try {
            const response = await fetch(
                `${BASE44_API_URL}/entities/Gift?to_player_id=${player.playerId}&status=sent`,
                {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
                    },
                }
            );

            if (response.ok) {
                const gifts = await response.json();
                socket.emit("pending_mishloach_manot", { gifts });
            }
        } catch (error) {
            console.error("❌ Error fetching pending gifts:", error);
        }
    });
}

// 🔔 פונקציה לשליחת התראה על משלוח מנות חדש (נקראת מבחוץ)
function notifyNewMishloachManot(receiverPlayerId, giftData) {
    if (!io || !getSocketIdByPlayerId) {
        console.error('❌ Mishloach Manot Manager not initialized');
        return false;
    }

    const receiverSocketId = getSocketIdByPlayerId(receiverPlayerId);
    if (receiverSocketId) {
        io.to(receiverSocketId).emit("mishloach_manot_received", {
            type: "mishloach_manot",
            ...giftData,
            timestamp: Date.now()
        });
        console.log(`📬 Mishloach manot notification sent to ${receiverPlayerId}`);
        return true;
    }
    
    console.log(`ℹ️ Player ${receiverPlayerId} not online - will see on next login`);
    return false;
}

// 🎉 שידור הודעת מערכת על משלוח מנות (לכולם באזור)
function broadcastMishloachManotToArea(areaId, senderUsername, receiverUsername) {
    if (!io) return;

    io.to(areaId).emit("area_announcement", {
        type: "mishloach_manot_sent",
        message: `🎁 ${senderUsername} שלח/ה משלוח מנות ל-${receiverUsername}! 🎭`,
        timestamp: Date.now()
    });
}

module.exports = {
    initialize,
    setupSocketHandlers,
    notifyNewMishloachManot,
    broadcastMishloachManotToArea
};
