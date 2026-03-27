const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameRoom = require('./game/GameRoom');
const { ROOM_CODE_LENGTH, ROOM_CLEANUP_MS } = require('./game/constants');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, 'public')));

// Room storage
const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (rooms.has(code));
  return code;
}

// Sanitize player name to prevent XSS
function sanitizeName(name) {
  return name.replace(/[<>&"'/]/g, '');
}

function broadcastGameView(room) {
  if (!room.gameState) return;
  const names = room.getPlayerNames();
  for (const player of room.players) {
    if (player.disconnected) continue;
    const view = room.gameState.getViewForPlayer(player.index);
    view.playerNames = names;
    player.socket.emit('game-update', view);
  }
}

function broadcastToRoom(room, event, data) {
  for (const player of room.players) {
    if (player.disconnected) continue;
    player.socket.emit(event, data);
  }
}

function handleRoundResolution(room) {
  const result = room.gameState.resolveRound();
  const names = room.getPlayerNames();
  result.roundResult.playerNames = names;

  // Always send round-result first
  broadcastToRoom(room, 'round-result', result.roundResult);

  if (result.gameOver) {
    let winnerIndices = [];
    let winnerNames = [];
    if (result.gameWinner !== undefined && result.gameWinner !== null) {
      winnerIndices = [result.gameWinner];
      winnerNames = [names[result.gameWinner].name];
    } else if (result.gameWinners && result.gameWinners.length > 0) {
      winnerIndices = result.gameWinners;
      winnerNames = result.gameWinners.map(i => names[i].name);
    }
    broadcastToRoom(room, 'game-over', {
      winnerIndices,
      winnerNames,
      draw: result.draw || false,
      wins: room.gameState.wins
    });
    scheduleRoomCleanup(room);
    return;
  }

  // Next round
  broadcastGameView(room);
}

function scheduleRoomCleanup(room) {
  // Cancel any existing cleanup timer
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
  }
  room.cleanupTimer = setTimeout(() => {
    if (rooms.has(room.roomCode)) {
      rooms.delete(room.roomCode);
    }
    room.cleanupTimer = null;
  }, ROOM_CLEANUP_MS);
}

// Socket.IO
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPlayerIndex = null;

  // Lobby: create room (no player added yet)
  socket.on('create-room', ({ playerName }) => {
    if (!playerName || playerName.trim().length === 0) {
      socket.emit('error', { message: 'Name is required' });
      return;
    }

    const roomCode = generateRoomCode();
    const room = new GameRoom(roomCode);
    rooms.set(roomCode, room);

    socket.emit('room-created', { roomCode });
  });

  // Lobby: check room exists and has space (no player added)
  socket.on('check-room', ({ roomCode, playerName }) => {
    if (!playerName || playerName.trim().length === 0) {
      socket.emit('error', { message: 'Name is required' });
      return;
    }
    if (!roomCode) {
      socket.emit('error', { message: 'Room code is required' });
      return;
    }

    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const safeName = sanitizeName(playerName.trim());

    if (room.gameState) {
      const existing = room.players.find(p => p.name === safeName && p.disconnected);
      if (!existing) {
        socket.emit('error', { message: 'Game already in progress' });
        return;
      }
    } else if (room.players.length >= 4) {
      socket.emit('error', { message: 'Room is full' });
      return;
    }

    if (!room.gameState && room.players.some(p => p.name === safeName)) {
      socket.emit('error', { message: 'Name already taken' });
      return;
    }

    socket.emit('room-ok', { roomCode: code });
  });

  // Game page: actually join the room
  socket.on('join-room', ({ roomCode, playerName }) => {
    if (!playerName || playerName.trim().length === 0) {
      socket.emit('error', { message: 'Name is required' });
      return;
    }
    if (!roomCode) {
      socket.emit('error', { message: 'Room code is required' });
      return;
    }

    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    const safeName = sanitizeName(playerName.trim());
    const result = room.addPlayer(socket, safeName);
    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }

    currentRoom = room;
    currentPlayerIndex = result.index;

    socket.emit('room-joined', {
      roomCode: code,
      playerIndex: result.index,
      players: room.getPlayerNames(),
      reconnected: result.reconnected || false
    });

    if (result.reconnected) {
      if (room.gameState) {
        const view = room.gameState.getViewForPlayer(result.index);
        view.playerNames = room.getPlayerNames();
        socket.emit('game-update', view);
      }
      broadcastToRoom(room, 'player-reconnected', {
        playerName: safeName,
        playerIndex: result.index
      });
      return;
    }

    broadcastToRoom(room, 'player-joined', {
      playerName: safeName,
      playerIndex: result.index,
      players: room.getPlayerNames()
    });

    if (result.gameStarted) {
      broadcastToRoom(room, 'game-start', {
        players: room.getPlayerNames()
      });
      broadcastGameView(room);
    }
  });

  socket.on('submit-cards', ({ cards }) => {
    if (!currentRoom || !currentRoom.gameState) return;
    // Prevent submissions if phase is not SELECTING (Bug 6: race condition guard)
    if (currentRoom.gameState.phase !== 'SELECTING') return;

    const result = currentRoom.gameState.submitCards(currentPlayerIndex, cards || []);
    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }

    broadcastGameView(currentRoom);

    if (result.allSubmitted) {
      // Lock phase immediately to prevent race conditions during delay
      currentRoom.gameState.phase = 'RESOLVING';
      setTimeout(() => {
        currentRoom.gameState.phase = 'SELECTING'; // restore before resolveRound
        handleRoundResolution(currentRoom);
      }, 500);
    }
  });

  // Play again - any player can trigger, restarts game for all
  socket.on('play-again', () => {
    if (!currentRoom) return;
    if (!currentRoom.gameState || currentRoom.gameState.phase !== 'GAME_OVER') return;
    currentRoom.resetForRematch();
    broadcastToRoom(currentRoom, 'game-start', {
      players: currentRoom.getPlayerNames()
    });
    broadcastGameView(currentRoom);
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;

    const result = currentRoom.removePlayer(socket.id);
    if (!result) return;

    if (result.removed) {
      broadcastToRoom(currentRoom, 'player-left', {
        playerName: result.name,
        playerCount: result.playerCount,
        players: currentRoom.getPlayerNames()
      });
      if (currentRoom.isEmpty()) {
        const roomRef = currentRoom;
        setTimeout(() => {
          if (roomRef.isEmpty() && rooms.has(roomRef.roomCode)) {
            rooms.delete(roomRef.roomCode);
          }
        }, 5000);
      }
    } else if (result.disconnected) {
      broadcastToRoom(currentRoom, 'player-disconnected', {
        playerName: result.name,
        playerIndex: result.playerIndex
      });

      // Single timeout for auto-submit on disconnect (no duplicate in GameRoom)
      const room = currentRoom;
      const playerIdx = result.playerIndex;
      setTimeout(() => {
        if (!room.gameState) return;
        const timeoutResult = room.handleDisconnectTimeout(playerIdx);
        if (timeoutResult && timeoutResult.resolve) {
          // Lock phase and resolve
          room.gameState.phase = 'RESOLVING';
          setTimeout(() => {
            room.gameState.phase = 'SELECTING';
            handleRoundResolution(room);
          }, 500);
        } else if (timeoutResult && timeoutResult.autoSubmitted) {
          broadcastGameView(room);
        }
      }, 30000);
    }

    currentRoom = null;
    currentPlayerIndex = null;
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
