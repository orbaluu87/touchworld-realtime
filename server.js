// ===== Touch World Deno/Socket.IO Server (v2.0 - Direct SDK Integration) =====
import { Server } from "npm:socket.io@4.7.5";
import { createClient } from "npm:@base44/sdk@0.7.1";

// --- Base44 SDK Initialization ---
const BASE44_API_URL = Deno.env.get("BASE44_API_URL") || "https://api.base44.com";
const BASE44_SERVICE_KEY = Deno.env.get("BASE44_SERVICE_KEY");

if (!BASE44_SERVICE_KEY) {
    console.error("FATAL ERROR: Missing BASE44_SERVICE_KEY environment variable.");
    // In a real Deno deploy, this would cause a crash loop, which is desired.
}

const base44 = createClient(BASE44_API_URL, BASE44_SERVICE_KEY);
console.log("Base44 SDK Initialized for Deno server.");


// ===== In-Memory Storage =====
// Using Maps for better performance and easier manipulation vs Objects
let players = new Map(); // { socketId: { ...playerData, playerId: stableDbId } }
let activeTrades = new Map(); // { tradeId: { ...tradeData } }

// ===== Socket.IO Setup =====
const io = new Server({
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  transports: ["websocket"],
});


// ===== UTILITIES =====
function safePlayerView(playerObject) {
  if (!playerObject) return null;
  return {
    id: playerObject.playerId,
    username: playerObject.username,
    current_area: playerObject.current_area,
    admin_level: playerObject.admin_level,
    skin_code: playerObject.skin_code,
    equipment: playerObject.equipment || {},
    position_x: playerObject.position_x,
    position_y: playerObject.position_y,
    direction: playerObject.direction || "front",
    is_moving: playerObject.is_moving || false,
    animation_frame: playerObject.animation_frame || "idle",
    move_type: playerObject.move_type || "walk",
  };
}

function getSocketIdByPlayerId(playerId) {
    for (const [socketId, player] of players.entries()) {
        if (player.playerId === playerId) {
            return socketId;
        }
    }
    return null;
}

function broadcastTradeStatus(tradeId) {
    const trade = activeTrades.get(tradeId);
    if (!trade) return;

    const initiatorSocketId = getSocketIdByPlayerId(trade.initiatorId);
    const receiverSocketId = getSocketIdByPlayerId(trade.receiverId);
    
    const initiatorPlayer = initiatorSocketId ? players.get(initiatorSocketId) : null;
    const receiverPlayer = receiverSocketId ? players.get(receiverSocketId) : null;

    const tradeForClient = {
        id: trade.id,
        status: trade.status,
        initiatorId: trade.initiatorId,
        receiverId: trade.receiverId,
        initiator: initiatorPlayer ? safePlayerView(initiatorPlayer) : { id: trade.initiatorId, username: 'Disconnected' },
        receiver: receiverPlayer ? safePlayerView(receiverPlayer) : { id: trade.receiverId, username: 'Disconnected' },
        initiator_offer: trade.initiator_offer,
        receiver_offer: trade.receiver_offer,
        reason: trade.reason || null
    };

    if (initiatorSocketId) io.to(initiatorSocketId).emit('trade_status_updated', tradeForClient);
    if (receiverSocketId) io.to(receiverSocketId).emit('trade_status_updated', tradeForClient);
}

// --- REFACTORED TRADE EXECUTION (Now using SDK) ---
async function executeTradeOnDB(trade) {
    console.log(`[Trade DB] Attempting to execute trade ${trade.id} via Base44 SDK...`);
    try {
        const { initiatorId, receiverId, initiator_offer, receiver_offer } = trade;

        const payload = {
            initiator_id: initiatorId,
            receiver_id: receiverId,
            initiator_offer_items: initiator_offer.items || [],
            initiator_offer_coins: initiator_offer.coins || 0,
            initiator_offer_gems: initiator_offer.gems || 0,
            receiver_offer_items: receiver_offer.items || [],
            receiver_offer_coins: receiver_offer.coins || 0,
            receiver_offer_gems: receiver_offer.gems || 0,
        };

        console.log("[Trade DB] Invoking 'executeTrade' function with payload:", JSON.stringify(payload, null, 2));
        const { data, error } = await base44.functions.invoke('executeTrade', payload);

        if (error) {
            throw new Error(error.message || 'The executeTrade function returned an error.');
        }

        console.log(`[Trade DB] Successfully executed trade ${trade.id}.`);
        return { success: true, data };

    } catch (error) {
        console.error(`[Trade DB] CRITICAL ERROR executing trade ${trade.id}:`, error);
        return { success: false, error: error.message };
    }
}


// ===== CORE SOCKET LOGIC =====
io.on("connection", (socket) => {
  console.log(`[+] New connection: ${socket.id}`);

  socket.on("identify", (identity) => {
    if (!identity || !identity.playerId) {
      console.error(`[!] Invalid identification from ${socket.id}. Missing playerId.`);
      return;
    }
    const existingSocketId = getSocketIdByPlayerId(identity.playerId);
    if (existingSocketId && existingSocketId !== socket.id) {
      console.log(`[Reconnect] Player ${identity.username} is reconnecting. Removing old socket: ${existingSocketId}`);
      const oldSocket = io.sockets.sockets.get(existingSocketId);
      if (oldSocket) {
        oldSocket.disconnect(true);
      }
      players.delete(existingSocketId);
      io.emit("player_disconnected", identity.playerId);
    }
    players.set(socket.id, {
      socketId: socket.id,
      playerId: identity.playerId,
      username: identity.username || "Guest",
      current_area: identity.current_area || "default",
      admin_level: identity.admin_level || "user",
      skin_code: identity.skin_code || "blue",
      equipment: identity.equipment || {},
      position_x: identity.x || 600,
      position_y: identity.y || 400,
      direction: "front",
      is_moving: false,
      animation_frame: "idle",
      move_type: "walk",
    });
    
    const currentPlayer = players.get(socket.id);
    socket.emit("identify_ok", safePlayerView(currentPlayer));

    const allPlayersList = Array.from(players.values()).map(safePlayerView);
    socket.emit("current_players", allPlayersList);
    
    socket.broadcast.emit("player_joined", safePlayerView(currentPlayer));
    console.log(`✅ Player identified: ${identity.username} (PlayerID: ${identity.playerId}, SocketID: ${socket.id})`);
    console.log(`Active players: ${players.size}`);
  });

  socket.on("player_update", (data) => {
    const player = players.get(socket.id);
    if (!player) return;
    Object.assign(player, {
      position_x: data.x ?? player.position_x,
      position_y: data.y ?? player.position_y,
      direction: data.direction ?? player.direction,
      is_moving: data.is_moving ?? player.is_moving,
      animation_frame: data.animation_frame ?? player.animation_frame,
      move_type: data.move_type ?? player.move_type,
    });
    socket.broadcast.emit("player_moved", safePlayerView(player));
  });

  socket.on("chat_message", (data) => {
    const player = players.get(socket.id);
    if (!player || !data.message) return;
    io.emit("new_chat_message", { id: player.playerId, message: data.message });
  });

  socket.on("equipment_change", (data) => {
    const player = players.get(socket.id);
    if (!player || !data.equipment) return;
    player.equipment = data.equipment;
    io.emit("player_equipment_changed", { id: player.playerId, equipment: player.equipment });
  });

  socket.on("player:change_area", (data) => {
    const player = players.get(socket.id);
    if (player && data.areaId) {
      player.current_area = data.areaId;
      io.emit("player_area_changed", { id: player.playerId, areaId: data.areaId });
    }
  });

  // ================= TRADE CHAT =================
  socket.on("trade_chat_message", (data) => {
    const trade = activeTrades.get(data.trade_id);
    const sender = players.get(socket.id);
    if (!trade || !sender || !data.message) return;

    const messagePayload = {
      tradeId: trade.id,
      senderId: sender.playerId,
      message: data.message,
    };

    const initiatorSocketId = getSocketIdByPlayerId(trade.initiatorId);
    const receiverSocketId = getSocketIdByPlayerId(trade.receiverId);

    if (initiatorSocketId) io.to(initiatorSocketId).emit("new_trade_message", messagePayload);
    if (receiverSocketId) io.to(receiverSocketId).emit("new_trade_message", messagePayload);
  });

  // ================= TRADE SYSTEM =================
  socket.on("trade_request", (data) => {
    const sender = players.get(socket.id);
    if (!sender || !data.receiver_id) return;

    const receiverSocketId = getSocketIdByPlayerId(data.receiver_id);
    const receiver = receiverSocketId ? players.get(receiverSocketId) : null;
    
    if (receiver) {
      const tradeId = `${sender.playerId}_${data.receiver_id}_${Date.now()}`;
      activeTrades.set(tradeId, {
        id: tradeId,
        initiatorId: sender.playerId,
        receiverId: data.receiver_id,
        initiator_offer: { items: [], coins: 0, gems: 0, is_confirmed: false },
        receiver_offer: { items: [], coins: 0, gems: 0, is_confirmed: false },
        status: "pending",
      });
      io.to(receiverSocketId).emit("trade_request_received", {
        trade_id: tradeId,
        initiator: safePlayerView(sender),
      });
      console.log(`[Trade] Request from ${sender.username} to ${receiver.username}`);
    } else {
        console.log(`[Trade] Receiver not found for ID: ${data.receiver_id}`);
    }
  });

  socket.on("trade_accept", (data) => {
    const trade = activeTrades.get(data.trade_id);
    if (trade && players.get(socket.id)?.playerId === trade.receiverId && trade.status === "pending") {
      trade.status = "started";
      console.log(`[Trade] Trade ${trade.id} accepted and started.`);
      broadcastTradeStatus(trade.id);
    }
  });

  socket.on("trade_update", (data) => {
    const trade = activeTrades.get(data.trade_id);
    const player = players.get(socket.id);
    if (!trade || !player || trade.status !== 'started') return;

    const isInitiator = player.playerId === trade.initiatorId;
    const offerSide = isInitiator ? 'initiator_offer' : 'receiver_offer';

    if(trade[offerSide].is_confirmed) {
        console.warn(`[Trade] Player ${player.username} tried to update a confirmed offer.`);
        return;
    }
    trade[offerSide] = { ...trade[offerSide], ...data.offer };
    broadcastTradeStatus(trade.id);
  });

  socket.on("trade_confirm", async (data) => {
    const trade = activeTrades.get(data.trade_id);
    const player = players.get(socket.id);
    if (!trade || !player || trade.status !== 'started') return;
    
    const isInitiator = player.playerId === trade.initiatorId;
    const offerSide = isInitiator ? 'initiator_offer' : 'receiver_offer';

    if (trade[offerSide].is_confirmed) return;

    trade[offerSide].is_confirmed = true;
    console.log(`[Trade] Player ${player.username} has confirmed their offer for trade ${trade.id}.`);
    
    if (trade.initiator_offer.is_confirmed && trade.receiver_offer.is_confirmed) {
        trade.status = "executing";
        console.log(`[Trade] Both players confirmed. Executing trade ${trade.id}...`);
        broadcastTradeStatus(trade.id);

        const result = await executeTradeOnDB(trade);

        if (result.success) {
            trade.status = "completed";
            console.log(`[Trade] DB execution for ${trade.id} was successful.`);
        } else {
            trade.status = "failed";
            trade.reason = result.error || "שגיאה בעיבוד ההחלפה. הפריטים לא הוחלפו.";
        }
        
        broadcastTradeStatus(trade.id);
        activeTrades.delete(data.trade_id);
    } else {
        broadcastTradeStatus(trade.id);
    }
  });
  
  socket.on("trade_cancel", (data) => {
    const trade = activeTrades.get(data.trade_id);
    if (trade) {
      trade.status = "cancelled";
      trade.reason = data.reason || 'ההחלפה בוטלה על ידי המשתמש';
      console.log(`[Trade] Trade ${trade.id} cancelled. Reason: ${trade.reason}`);
      broadcastTradeStatus(trade.id);
      activeTrades.delete(data.trade_id);
    }
  });

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`[-] Player disconnected: ${player.username} (PlayerID: ${player.playerId})`);
      io.emit("player_disconnected", player.playerId);
      
      for (const [tradeId, trade] of activeTrades.entries()) {
          if(trade && (trade.initiatorId === player.playerId || trade.receiverId === player.playerId)) {
              trade.status = 'cancelled';
              trade.reason = 'המשתתף השני התנתק.';
              broadcastTradeStatus(tradeId);
              activeTrades.delete(tradeId);
              console.log(`[Trade] Trade ${tradeId} cancelled due to disconnect.`);
          }
      }

      players.delete(socket.id);
      console.log(`Active players: ${players.size}`);
    }
  });
});

// --- Deno Server Handler ---
Deno.serve(io.handler());
