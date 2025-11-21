import React, { useEffect, useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';

// Simplified Donut Manager (Client)
const DonutSystemManager = ({ areaId, versionName, playerId, socket }) => {
    const [donuts, setDonuts] = useState([]);
    const queryClient = useQueryClient();

    // 1. Clear donuts on area change (Start fresh - show spawning process live)
    useEffect(() => {
        setDonuts([]); 
    }, [areaId, versionName]);

    // 2. Socket Listeners
    useEffect(() => {
        if (!socket) return;

        const onSpawn = (data) => {
            // Handle both flat object (new server) and nested object (old server)
            const spawnedDonut = data.spawn || data;
            
            if (spawnedDonut.area_id === areaId) {
                console.log(`🍩 [CLIENT] Donut Spawned: ${spawnedDonut.collectible_type} at (${spawnedDonut.position_x}, ${spawnedDonut.position_y})`);
                setDonuts(prev => {
                    // Prevent duplicates
                    if (prev.some(d => d.spawn_id === spawnedDonut.spawn_id)) return prev;
                    return [...prev, spawnedDonut];
                });
            }
        };

        const onCollect = (data) => {
            console.log(`🍩 [CLIENT] Donut Collected: ${data.spawn_id}`);
            setDonuts(prev => prev.filter(d => d.spawn_id !== data.spawn_id));
        };
        
        const onSync = (list) => {
            if (Array.isArray(list)) {
                setDonuts(list);
            }
        };

        // Listen to events
        socket.on('donut_spawned', onSpawn);
        socket.on('donut_collected', onCollect);
        socket.on('donuts_sync', onSync);

        return () => {
            socket.off('donut_spawned', onSpawn);
            socket.off('donut_collected', onCollect);
            socket.off('donuts_sync', onSync);
        };
    }, [socket, areaId]);

    // 3. Handle Collection
    const handleCollect = useCallback((donut, e) => {
        e.stopPropagation();

        // 1. Optimistic Remove (Visual)
        setDonuts(prev => prev.filter(d => d.spawn_id !== donut.spawn_id));

        // 2. Tell Server
        socket?.emit('collect_donut', {
            spawn_id: donut.spawn_id,
            area_id: areaId
        });

        // 3. Feedback
        const donutName = donut.collectible_type === 'donut_pink' ? 'סופגניה' : 
                          donut.collectible_type === 'donut_chocolate' ? 'סופגניה שוקולד' :
                          donut.collectible_type || 'סופגניה';
        toast.success(`אספת ${donutName}!`);

        // 4. Refresh Stats (Small delay to let server process)
        setTimeout(() => {
             window.dispatchEvent(new Event('donut_collected_success'));
             queryClient.invalidateQueries(['collectibleCounts', playerId]);
        }, 500);
    }, [areaId, socket, queryClient, playerId]);

    return (
        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
            <AnimatePresence>
                {donuts.map(donut => (
                    <motion.div
                        key={donut.spawn_id}
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        whileHover={{ scale: 1.1 }}
                        className="absolute cursor-pointer pointer-events-auto"
                        style={{
                            left: donut.position_x,
                            top: donut.position_y,
                            transform: 'translate(-50%, -50%)',
                        }}
                        onClick={(e) => handleCollect(donut, e)}
                    >
                        <img 
                            src={donut.image_url} 
                            alt="Donut"
                            className="w-12 h-12 object-contain drop-shadow-lg"
                        />
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
};

export default DonutSystemManager;
