import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const GOLDSTEIN_COLORS = ['#ff3333', '#783cb0', '#208c46', '#c2a454', '#bd246e', '#1c71a1'];
let roomMapStates = {};

function computeStandings(roomKey) {
    if (!roomMapStates[roomKey]) return [];
    return Object.values(roomMapStates[roomKey].players).sort((a, b) => {
        const lapsA = a.lapsComplete || 0;
        const lapsB = b.lapsComplete || 0;
        if (lapsB !== lapsA) return lapsB - lapsA;
        const progA = a.progress || 0;
        const progB = b.progress || 0;
        return progB - progA;
    });
}

io.on('connection', (socket) => {
    let activeRoom = null;

    socket.on('create-room', (data) => {
        const roomKey = data.roomKey;
        activeRoom = roomKey;
        socket.join(roomKey);

        roomMapStates[roomKey] = {
            seed: Math.floor(Math.random() * 888888),
            players: {},
            isMatchActive: false
        };

        roomMapStates[roomKey].players[socket.id] = {
            id: socket.id,
            username: data.username,
            color: GOLDSTEIN_COLORS[0],
            isHost: true,
            lapsComplete: 0,
            progress: 0,
            sanity: 0.0
        };

        sendLobbyUpdate(roomKey);
    });

    socket.on('join-room', (data) => {
        const roomKey = data.roomKey;
        activeRoom = roomKey;
        socket.join(roomKey);

        if (!roomMapStates[roomKey]) {
            roomMapStates[roomKey] = {
                seed: Math.floor(Math.random() * 888888),
                players: {},
                isMatchActive: false
            };
        }

        const currentCount = Object.keys(roomMapStates[roomKey].players).length;
        const assignedColor = GOLDSTEIN_COLORS[currentCount % GOLDSTEIN_COLORS.length];

        roomMapStates[roomKey].players[socket.id] = {
            id: socket.id,
            username: data.username,
            color: assignedColor,
            isHost: currentCount === 0,
            lapsComplete: 0,
            progress: 0,
            sanity: 0.0
        };

        sendLobbyUpdate(roomKey);
    });

    socket.on('launch-match', (roomKey) => {
        if (roomMapStates[roomKey]) {
            roomMapStates[roomKey].isMatchActive = true;
            Object.keys(roomMapStates[roomKey].players).forEach(id => {
                roomMapStates[roomKey].players[id].lapsComplete = 0;
                roomMapStates[roomKey].players[id].progress = 0;
                roomMapStates[roomKey].players[id].sanity = 0.0;
            });
            io.to(roomKey).emit('init-race-start', { seed: roomMapStates[roomKey].seed });
        }
    });

    socket.on('host-abort-race', (roomKey) => {
        if (roomMapStates[roomKey]) {
            roomMapStates[roomKey].isMatchActive = false;
            const finalStandings = computeStandings(roomKey);
            io.to(roomKey).emit('race-terminated-early', finalStandings);
        }
    });

    socket.on('player-finished-race', (roomKey) => {
        if (roomMapStates[roomKey]) {
            roomMapStates[roomKey].isMatchActive = false;
            const finalStandings = computeStandings(roomKey);
            io.to(roomKey).emit('race-terminated-early', finalStandings);
        }
    });

    socket.on('player-move', (movementData) => {
        if (!activeRoom || !roomMapStates[activeRoom]) return;

        if (roomMapStates[activeRoom].players[socket.id]) {
            roomMapStates[activeRoom].players[socket.id].position = movementData.position;
            roomMapStates[activeRoom].players[socket.id].rotation = movementData.rotation;
            roomMapStates[activeRoom].players[socket.id].lap = movementData.lap;
            roomMapStates[activeRoom].players[socket.id].progress = movementData.progress;
            roomMapStates[activeRoom].players[socket.id].lapsComplete = movementData.lapsComplete;
            roomMapStates[activeRoom].players[socket.id].username = movementData.username;
            roomMapStates[activeRoom].players[socket.id].color = movementData.color;
            roomMapStates[activeRoom].players[socket.id].sanity = movementData.sanity;
        }

        socket.to(activeRoom).emit('player-updated', roomMapStates[activeRoom].players[socket.id]);
    });

    function sendLobbyUpdate(roomKey) {
        if (roomMapStates[roomKey]) {
            const playerList = Object.values(roomMapStates[roomKey].players);
            io.to(roomKey).emit('lobby-update', { players: playerList });
        }
    }

    socket.on('disconnect', () => {
        if (activeRoom && roomMapStates[activeRoom]) {
            const wasHost = roomMapStates[activeRoom].players[socket.id]?.isHost;
            delete roomMapStates[activeRoom].players[socket.id];

            const remainingIds = Object.keys(roomMapStates[activeRoom].players);

            if (remainingIds.length > 0) {
                if (wasHost) {
                    roomMapStates[activeRoom].players[remainingIds[0]].isHost = true;
                }
                sendLobbyUpdate(activeRoom);
                io.to(activeRoom).emit('player-disconnected', socket.id);

                if (roomMapStates[activeRoom].isMatchActive && remainingIds.length === 1) {
                    roomMapStates[activeRoom].isMatchActive = false;
                    const finalStandings = computeStandings(activeRoom);
                    io.to(activeRoom).emit('race-terminated-early', finalStandings);
                }
            } else {
                delete roomMapStates[activeRoom];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log("\n☠  THE GHOST OF GOLDSTEIN CORE SERVER RUNNING ☠");
    console.log("---------------------------------------------------------------");
    console.log("URL: http://localhost:" + PORT);
    console.log("---------------------------------------------------------------\n");
});