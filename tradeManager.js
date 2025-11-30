const fetch = require("node-fetch");

let activeTrades = new Map();
let BASE44_API_URL;
let BASE44_SERVICE_KEY;
let io;
let players;
let getSocketIdByPlayerId;

async function getEquippedItemsFromOffer(playerId, offerItems) {
  if (!offerItems || offerItems.length === 0) return [];

  try {
    const itemsResponse = await fetch(`${BASE44_API_URL}/entities/Item`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
    });

    if (!itemsResponse.ok) return [];
    
    const allItems = await itemsResponse.json();
    const itemsMap = new Map(allItems.map(item => [item.id, item]));

    const socketId = getSocketIdByPlayerId(playerId);
    if (!socketId) return [];
    
    const player = players.get(socketId);
    if (!player) return [];

    const equippedItems = [];

    for (const inventoryItemId of offerItems) {
      const invResponse = await fetch(`${BASE44_API_URL}/entities/PlayerInventory/${inventoryItemId}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
        },
      });

      if (!invResponse.ok) continue;
      
      const invItem = await invResponse.json();
      const itemDetails = itemsMap.get(invItem.item_id);
      
      if (!itemDetails) continue;

      const itemCode = itemDetails.item_code;
      const itemType = itemDetails.type;

      let isEquipped = false;
      let equipmentSlot = null;

      switch (itemType) {
        case 'hair':
          if (player.equipment.equipped_hair === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_hair';
          }
          break;
        case 'top':
          if (player.equipment.equipped_top === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_top';
          }
          break;
        case 'pants':
          if (player.equipment.equipped_pants === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_pants';
          }
          break;
        case 'gloves':
          if (player.equipment.equipped_gloves === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_gloves';
          }
          break;
        case 'hat':
          if (player.equipment.equipped_hat === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_hat';
          }
          break;
        case 'face':
          if (player.equipment.equipped_face === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_face';
          }
          break;
        case 'necklace':
          if (player.equipment.equipped_necklace === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_necklace';
          }
          break;
        case 'halo':
          if (player.equipment.equipped_halo === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_halo';
          }
          break;
        case 'shoes':
          if (player.equipment.equipped_shoes === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_shoes';
          }
          break;
        case 'accessory':
          if (player.equipment.equipped_accessory === itemCode) {
            isEquipped = true;
            equipmentSlot = 'equipped_accessory';
          }
          break;
      }

      if (isEquipped) {
        equippedItems.push({
          inventoryItemId,
          itemCode,
          itemType,
          equipmentSlot,
        });
      }
    }

    return equippedItems;
  } catch (error) {
    console.error("Error checking equipped items:", error);
    return [];
  }
}

async function removeEquippedItems(playerId, equippedItems) {
  const socketId = getSocketIdByPlayerId(playerId);
  if (!socketId) return;

  const player = players.get(socketId);
  if (!player) return;

  const updates = {};
  
  for (const item of equippedItems) {
    if (item.equipmentSlot && player.equipment[item.equipmentSlot]) {
      console.log(`🔧 Removing ${item.equipmentSlot} (${item.itemCode}) from ${player.username}`);
      player.equipment[item.equipmentSlot] = null;
      updates[item.equipmentSlot] = null;
    }
  }

  if (Object.keys(updates).length > 0) {
    try {
      await fetch(`${BASE44_API_URL}/entities/Player/${playerId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
        },
        body: JSON.stringify(updates),
      });
      console.log(`💾 Updated DB for ${player.username}:`, updates);
    } catch (error) {
      console.error(`❌ Failed to update DB for ${player.username}:`, error);
    }
  }
}

async function executeTradeOnBase44(trade) {
  try {
    const resp = await fetch(`${BASE44_API_URL}/functions/executeTrade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BASE44_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        initiator_id: trade.initiatorId,
        receiver_id: trade.receiverId,
        initiator_offer_items: trade.initiator_offer.items || [],
        initiator_offer_coins: trade.initiator_offer.coins || 0,
        initiator_offer_gems: trade.initiator_offer.gems || 0,
        receiver_offer_items: trade.receiver_offer.items || [],
        receiver_offer_coins: trade.receiver_offer.coins || 0,
        receiver_offer_gems: trade.receiver_offer.gems || 0,
      }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json?.error || `HTTP ${resp.status}`);
    return { success: true, data: json };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function broadcastTradeUpdate(tradeId) {
  const trade = activeTrades.get(tradeId);
  if (!trade) return;
  
  const initSid = getSocketIdByPlayerId(trade.initiatorId);
  const recvSid = getSocketIdByPlayerId(trade.receiverId);
  
  const initiatorPlayer = players.get(initSid);
  const receiverPlayer = players.get(recvSid);
  
  const payload = {
    id: tradeId,
    status: trade.status,
    initiator: {
      id: trade.initiatorId,
      username: initiatorPlayer?.username || "Unknown",
      locked: trade.initiator_locked || false,
      ready: trade.initiator_ready || false,
      equipment: initiatorPlayer?.equipment || {},
    },
    receiver: {
      id: trade.receiverId,
      username: receiverPlayer?.username || "Unknown",
      locked: trade.receiver_locked || false,
      ready: trade.receiver_ready || false,
      equipment: receiverPlayer?.equipment || {},
    },
    initiator_offer: trade.initiator_offer,
    receiver_offer: trade.receiver_offer,
  };
  
  if (initSid) {
    io.to(initSid).emit("trade_status_updated", payload);
  }
  if (recvSid) {
    io.to(recvSid).emit("trade_status_updated", payload);
  }
}

module.exports = {
  initialize: (ioInstance, apiUrl, serviceKey, playersMap, getSocketIdFn) => {
    io = ioInstance;
    BASE44_API_URL = apiUrl;
    BASE44_SERVICE_KEY = serviceKey;
    players = playersMap;
    getSocketIdByPlayerId = getSocketIdFn;
    console.log("✅ Trade Manager Initialized");
  },

  getActiveTradesCount: () => activeTrades.size,

  handleDisconnect: (socketId) => {
    const p = players.get(socketId);
    if (!p) return;

    if (p.activeTradeId) {
      const trade = activeTrades.get(p.activeTradeId);
      if (trade) {
        const otherPlayerId = trade.initiatorId === p.playerId ? trade.receiverId : trade.initiatorId;
        const otherSid = getSocketIdByPlayerId(otherPlayerId);
        
        if (otherSid) {
          const otherPlayer = players.get(otherSid);
          if (otherPlayer) otherPlayer.activeTradeId = null;
          
          io.to(otherSid).emit("trade_status_updated", {
            id: p.activeTradeId,
            status: "cancelled",
            reason: "participant_disconnected"
          });
        }
        
        activeTrades.delete(p.activeTradeId);
      }
    }
  },

  setupSocketHandlers: (socket) => {
    // ========== TRADE REQUEST ==========
    socket.on("trade_request", (data = {}) => {
      const initiator = players.get(socket.id);
      if (!initiator) return;

      const receiverId = data?.receiver?.id;
      if (!receiverId) return;

      const recvSid = getSocketIdByPlayerId(receiverId);
      if (!recvSid) return;

      const receiver = players.get(recvSid);
      if (!receiver) return;

      const tradeId = `trade_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      
      const trade = {
        id: tradeId,
        initiatorId: initiator.playerId,
        receiverId: receiver.playerId,
        initiator_offer: { items: [], coins: 0, gems: 0 },
        receiver_offer: { items: [], coins: 0, gems: 0 },
        initiator_locked: false,
        receiver_locked: false,
        initiator_ready: false,
        receiver_ready: false,
        status: "pending",
      };
      
      activeTrades.set(tradeId, trade);
      initiator.activeTradeId = tradeId;
      receiver.activeTradeId = tradeId;

      console.log(`🔄 Trade Request: ${initiator.username} → ${receiver.username} (${tradeId})`);

      io.to(recvSid).emit("trade_request_received", {
        trade_id: tradeId,
        initiator: {
          id: initiator.playerId,
          username: initiator.username,
          equipment: initiator.equipment,
        },
      });
    });

    // ========== TRADE ACCEPT ==========
    socket.on("trade_accept", (data = {}) => {
      const trade = activeTrades.get(data.trade_id);
      if (!trade) return;

      trade.status = "started";
      console.log(`✅ Trade Accepted: ${data.trade_id}`);
      broadcastTradeUpdate(data.trade_id);
    });

    // ========== TRADE OFFER UPDATE ==========
    socket.on("trade_offer_update", (data = {}) => {
      const p = players.get(socket.id);
      if (!p) return;

      const trade = activeTrades.get(data.trade_id);
      if (!trade) return;

      // SECURITY: If anyone changes the offer, reset ALL locks and confirmations
      trade.initiator_locked = false;
      trade.receiver_locked = false;
      trade.initiator_ready = false;
      trade.receiver_ready = false;

      if (trade.initiatorId === p.playerId) {
        trade.initiator_offer = {
          items: data.offer?.items || [],
          coins: data.offer?.coins || 0,
          gems: data.offer?.gems || 0,
        };
        console.log(`🔄 ${p.username} updated offer: ${trade.initiator_offer.items.length} items, ${trade.initiator_offer.coins} coins`);
      } else if (trade.receiverId === p.playerId) {
        trade.receiver_offer = {
          items: data.offer?.items || [],
          coins: data.offer?.coins || 0,
          gems: data.offer?.gems || 0,
        };
        console.log(`🔄 ${p.username} updated offer: ${trade.receiver_offer.items.length} items, ${trade.receiver_offer.coins} coins`);
      }

      broadcastTradeUpdate(data.trade_id);
    });

    // ========== TRADE LOCK UPDATE ==========
    socket.on("trade_lock_update", (data = {}) => {
      const p = players.get(socket.id);
      if (!p) return;

      const trade = activeTrades.get(data.trade_id);
      if (!trade) return;

      const isLocked = !!data.locked;

      if (trade.initiatorId === p.playerId) {
        trade.initiator_locked = isLocked;
        // If unlocking, also remove ready status
        if (!isLocked) trade.initiator_ready = false;
        console.log(`🔒 ${p.username} locked: ${isLocked}`);
      } else if (trade.receiverId === p.playerId) {
        trade.receiver_locked = isLocked;
        // If unlocking, also remove ready status
        if (!isLocked) trade.receiver_ready = false;
        console.log(`🔒 ${p.username} locked: ${isLocked}`);
      }

      broadcastTradeUpdate(data.trade_id);
    });

    // ========== TRADE READY UPDATE ==========
    socket.on("trade_ready_update", async (data = {}) => {
      const p = players.get(socket.id);
      if (!p) return;

      const trade = activeTrades.get(data.trade_id);
      if (!trade) return;

      // SECURITY: Can only confirm if BOTH parties are locked
      if (!trade.initiator_locked || !trade.receiver_locked) {
        console.log(`⚠️ ${p.username} tried to confirm but trade is not fully locked.`);
        return;
      }

      if (trade.initiatorId === p.playerId) {
        trade.initiator_ready = data.ready;
        console.log(`${data.ready ? '✅' : '❌'} ${p.username} confirmed: ${data.ready}`);
      } else if (trade.receiverId === p.playerId) {
        trade.receiver_ready = data.ready;
        console.log(`${data.ready ? '✅' : '❌'} ${p.username} confirmed: ${data.ready}`);
      }

      broadcastTradeUpdate(data.trade_id);

      if (trade.initiator_ready && trade.receiver_ready) {
        console.log(`🎉 Executing trade ${data.trade_id}...`);
        
        trade.status = "executing";
        broadcastTradeUpdate(data.trade_id);

        const [initiatorEquipped, receiverEquipped] = await Promise.all([
          getEquippedItemsFromOffer(trade.initiatorId, trade.initiator_offer.items),
          getEquippedItemsFromOffer(trade.receiverId, trade.receiver_offer.items),
        ]);

        console.log(`👕 Initiator equipped items:`, initiatorEquipped.length);
        console.log(`👕 Receiver equipped items:`, receiverEquipped.length);

        executeTradeOnBase44(trade).then(async (result) => {
          if (result.success) {
            console.log(`✅ Trade Completed: ${data.trade_id}`);
            
            const initSid = getSocketIdByPlayerId(trade.initiatorId);
            const recvSid = getSocketIdByPlayerId(trade.receiverId);
            
            await Promise.all([
              removeEquippedItems(trade.initiatorId, initiatorEquipped),
              removeEquippedItems(trade.receiverId, receiverEquipped),
            ]);

            const initiatorPlayer = players.get(initSid);
            const receiverPlayer = players.get(recvSid);
            
            if (initSid) {
              if (initiatorPlayer) {
                initiatorPlayer.activeTradeId = null;
                
                if (initiatorEquipped.length > 0) {
                  io.to(initSid).emit("items_unequipped", {
                    items: initiatorEquipped.map(i => i.equipmentSlot),
                    equipment: initiatorPlayer.equipment,
                  });
                }
              }
              io.to(initSid).emit("trade_completed_successfully", { trade_id: data.trade_id });
            }
            
            if (recvSid) {
              if (receiverPlayer) {
                receiverPlayer.activeTradeId = null;
                
                if (receiverEquipped.length > 0) {
                  io.to(recvSid).emit("items_unequipped", {
                    items: receiverEquipped.map(i => i.equipmentSlot),
                    equipment: receiverPlayer.equipment,
                  });
                }
              }
              io.to(recvSid).emit("trade_completed_successfully", { trade_id: data.trade_id });
            }

            if (initiatorPlayer && initiatorEquipped.length > 0) {
              io.to(initiatorPlayer.current_area).emit("player_update", {
                id: initiatorPlayer.playerId,
                playerId: initiatorPlayer.playerId,
                socketId: initSid,
                equipment: initiatorPlayer.equipment,
              });
            }

            if (receiverPlayer && receiverEquipped.length > 0) {
              io.to(receiverPlayer.current_area).emit("player_update", {
                id: receiverPlayer.playerId,
                playerId: receiverPlayer.playerId,
                socketId: recvSid,
                equipment: receiverPlayer.equipment,
              });
            }
            
            activeTrades.delete(data.trade_id);
          } else {
            console.error(`❌ Trade Failed: ${data.trade_id} - ${result.error}`);
            
            trade.status = "failed";
            const initSid = getSocketIdByPlayerId(trade.initiatorId);
            const recvSid = getSocketIdByPlayerId(trade.receiverId);
            
            const errorPayload = {
              id: data.trade_id,
              status: "failed",
              reason: result.error
            };
            
            if (initSid) {
              const initPlayer = players.get(initSid);
              if (initPlayer) initPlayer.activeTradeId = null;
              io.to(initSid).emit("trade_status_updated", errorPayload);
            }
            
            if (recvSid) {
              const recvPlayer = players.get(recvSid);
              if (recvPlayer) recvPlayer.activeTradeId = null;
              io.to(recvSid).emit("trade_status_updated", errorPayload);
            }
            
            activeTrades.delete(data.trade_id);
          }
        });
      }
    });

    // ========== TRADE CANCEL ==========
    socket.on("trade_cancel", (data = {}) => {
      const trade = activeTrades.get(data.trade_id);
      if (!trade) return;

      const p = players.get(socket.id);
      console.log(`❌ Trade Cancelled: ${data.trade_id} by ${p?.username || 'unknown'}`);

      const initSid = getSocketIdByPlayerId(trade.initiatorId);
      const recvSid = getSocketIdByPlayerId(trade.receiverId);
      
      if (initSid) {
        const initPlayer = players.get(initSid);
        if (initPlayer) initPlayer.activeTradeId = null;
        io.to(initSid).emit("trade_status_updated", {
          id: data.trade_id,
          status: "cancelled",
          reason: data.reason || "cancelled"
        });
      }
      
      if (recvSid) {
        const recvPlayer = players.get(recvSid);
        if (recvPlayer) recvPlayer.activeTradeId = null;
        io.to(recvSid).emit("trade_status_updated", {
          id: data.trade_id,
          status: "cancelled",
          reason: data.reason || "cancelled"
        });
      }
      
      activeTrades.delete(data.trade_id);
    });

    // ========== TRADE CHAT ==========
    socket.on("trade_chat", (data = {}) => {
      const p = players.get(socket.id);
      if (!p) return;

      const trade = activeTrades.get(data.trade_id);
      if (!trade) return;

      // Validate participant
      if (trade.initiatorId !== p.playerId && trade.receiverId !== p.playerId) return;

      const message = (data.message || "").toString().trim().slice(0, 100);
      if (!message) return;

      const chatPayload = {
        trade_id: trade.id,
        sender_id: p.playerId,
        sender_name: p.username,
        message: message,
        timestamp: Date.now()
      };

      const initSid = getSocketIdByPlayerId(trade.initiatorId);
      const recvSid = getSocketIdByPlayerId(trade.receiverId);

      if (initSid) io.to(initSid).emit("trade_chat_message", chatPayload);
      if (recvSid) io.to(recvSid).emit("trade_chat_message", chatPayload);
    });
  }
};
