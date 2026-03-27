const SocketClient = {
  socket: null,
  callbacks: {},

  init() {
    this.socket = io();
    this.setupListeners();
    return this.socket;
  },

  on(event, callback) {
    this.callbacks[event] = callback;
  },

  emit(event, data) {
    this.socket.emit(event, data);
  },

  setupListeners() {
    const events = [
      'room-created', 'room-joined', 'player-joined', 'player-left',
      'player-disconnected', 'player-reconnected',
      'game-start', 'game-update', 'round-result',
      'steal-prompt', 'steal-waiting', 'steal-complete',
      'game-over', 'error'
    ];

    for (const event of events) {
      this.socket.on(event, (data) => {
        if (this.callbacks[event]) {
          this.callbacks[event](data);
        }
      });
    }
  }
};
