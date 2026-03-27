const GameState = require('./GameState');
const { MAX_PLAYERS, DISCONNECT_TIMEOUT_MS } = require('./constants');

class GameRoom {
  constructor(roomCode) {
    this.roomCode = roomCode;
    this.players = []; // { id, name, index, socket, disconnected, disconnectTimer }
    this.gameState = null;
    this.createdAt = Date.now();
    this.cleanupTimer = null; // timer for room deletion after game-over
  }

  addPlayer(socket, name) {
    if (this.gameState) {
      // Check for reconnection first (before "room is full" check)
      const existing = this.players.find(p => p.name === name && p.disconnected);
      if (existing) {
        clearTimeout(existing.disconnectTimer);
        existing.socket = socket;
        existing.id = socket.id;
        existing.disconnected = false;
        existing.disconnectTimer = null;
        socket.join(this.roomCode);
        return { index: existing.index, reconnected: true };
      }
      return { error: 'Game already in progress' };
    }

    if (this.players.length >= MAX_PLAYERS) {
      return { error: 'Room is full' };
    }

    // Check for duplicate name
    if (this.players.some(p => p.name === name)) {
      return { error: 'Name already taken' };
    }

    const index = this.players.length;
    this.players.push({
      id: socket.id,
      name,
      index,
      socket,
      disconnected: false,
      disconnectTimer: null
    });

    socket.join(this.roomCode);

    if (this.players.length === MAX_PLAYERS) {
      this.startGame();
      return { index, gameStarted: true };
    }

    return { index };
  }

  removePlayer(socketId) {
    const player = this.players.find(p => p.id === socketId);
    if (!player) return null;

    if (!this.gameState) {
      // Game hasn't started, just remove
      this.players = this.players.filter(p => p.id !== socketId);
      // Re-index
      this.players.forEach((p, i) => p.index = i);
      return { removed: true, name: player.name, playerCount: this.players.length };
    }

    // Game in progress - mark as disconnected (server handles timeout)
    player.disconnected = true;

    return { disconnected: true, name: player.name, playerIndex: player.index };
  }

  handleDisconnectTimeout(playerIndex) {
    if (!this.gameState) return null;
    if (this.gameState.phase !== 'SELECTING') return null;
    if (this.gameState.submissions[playerIndex] !== null) return null;

    this.gameState.submitCards(playerIndex, []);
    const allSubmitted = Object.values(this.gameState.submissions).every(s => s !== null);
    if (allSubmitted) {
      return { autoSubmitted: true, resolve: true };
    }
    return { autoSubmitted: true };
  }

  startGame() {
    this.gameState = new GameState(MAX_PLAYERS);
  }

  getPlayerNames() {
    return this.players.map(p => ({
      name: p.name,
      index: p.index,
      disconnected: p.disconnected
    }));
  }

  getPlayerBySocketId(socketId) {
    return this.players.find(p => p.id === socketId);
  }

  isEmpty() {
    return this.players.length === 0 ||
      (this.gameState && this.players.every(p => p.disconnected));
  }

  resetForRematch() {
    // Cancel any pending room cleanup timer
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.gameState = new GameState(MAX_PLAYERS);
  }
}

module.exports = GameRoom;
