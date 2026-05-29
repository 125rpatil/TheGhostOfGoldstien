import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const httpServer = createServer(app);

// ES Modules do not have '__dirname' globally defined, so we reconstruct it here:
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hook dynamically into Render's designated port infrastructure
const PORT = process.env.PORT || 3000;

// Permissive Cross-Origin Resource Sharing setup for incoming WebSocket pipelines
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const activeRooms = {};
const RETRO_COLORS = ['#ff0000', '#00ff00', '#00ffff', '#ffff00', '#ff00ff', '#ffffff'];

// Serves the HTML game file directly when navigating to your Render URL root ('/')
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'haunted_race.html'));
});

/**
 * Socket.io Multi-Client Network Architecture
 */
io.on('connection', (socket) => {
    let joinedRoomKey = null;

    socket.on('create-room', (data) => {
        const { roomKey, username } = data;
        joinedRoomKey = roomKey;

        const newPlayer = {
            id: socket.id,
            username: username || 'HOST',
            color: RETRO_COLORS[0],
            isHost: true
        };

        activeRooms[roomKey] = {
            roomKey,
            players: [newPlayer],
            seed: Math.floor(Math.random() * 999999),
            raceStarted: false
        };

        socket.join(roomKey);
        io.to(roomKey).emit('lobby-update', { players: activeRooms[roomKey].players });
    });

    socket.on('join-room', (data) => {
        const { roomKey, username } = data;
        const room = activeRooms[roomKey];

        if (!room) {
            socket.emit('error-msg', 'SIGIL ID INVALID OR EXPIRED.');
            return;
        }
        if (room.raceStarted) {
            socket.emit('error-msg', 'ROM INJECTED ALREADY. RUNNING CORE.');
            return;
        }

        joinedRoomKey = roomKey;
        const assignedColor = RETRO_COLORS[room.players.length % RETRO_COLORS.length];

        const newPlayer = {
            id: socket.id,
            username: username || `SOUL_${room.players.length}`,
            color: assignedColor,
            isHost: false
        };

        room.players.push(newPlayer);
        socket.join(roomKey);

        io.to(roomKey).emit('lobby-update', { players: room.players });
    });

    socket.on('launch-match', (roomKey) => {
        const room = activeRooms[roomKey];
        if (!room) return;

        const hostPlayer = room.players.find(p => p.id === socket.id);
        if (hostPlayer && hostPlayer.isHost) {
            room.raceStarted = true;
            io.to(roomKey).emit('init-race-start', { seed: room.seed });
        }
    });

    socket.on('player-move', (movementData) => {
        if (!joinedRoomKey || !activeRooms[joinedRoomKey]) return;

        const room = activeRooms[joinedRoomKey];
        const internalPlayer = room.players.find(p => p.id === socket.id);

        if (internalPlayer) {
            Object.assign(internalPlayer, movementData);
            socket.to(joinedRoomKey).emit('player-updated', {
                id: socket.id,
                ...movementData
            });
        }
    });

    socket.on('player-finished-race', (roomKey) => {
        const room = activeRooms[roomKey];
        if (!room) return;

        const standings = [...room.players].sort((a, b) => {
            if ((b.lapsComplete || 0) !== (a.lapsComplete || 0)) {
                return (b.lapsComplete || 0) - (a.lapsComplete || 0);
            }
            return (b.progress || 0) - (a.progress || 0);
        });

        io.to(roomKey).emit('race-terminated-early', standings);
    });

    socket.on('host-abort-race', (roomKey) => {
        const room = activeRooms[roomKey];
        if (room) {
            const host = room.players.find(p => p.id === socket.id);
            if (host && host.isHost) {
                io.to(roomKey).emit('race-terminated-early', room.players);
            }
        }
    });

    socket.on('disconnect', () => {
        if (joinedRoomKey && activeRooms[joinedRoomKey]) {
            const room = activeRooms[joinedRoomKey];
            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.players.length === 0) {
                delete activeRooms[joinedRoomKey];
            } else {
                if (!room.players.some(p => p.isHost)) {
                    room.players[0].isHost = true;
                }
                io.to(joinedRoomKey).emit('lobby-update', { players: room.players });
                io.to(joinedRoomKey).emit('player-disconnected', socket.id);
            }
        }
    });
});

// Spin up the listener loop bound to the Render dynamic assignment port
httpServer.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`UNDERWORLD CORE ACTIVE ON PORT: ${PORT}`);
    console.log(`=========================================`);
});