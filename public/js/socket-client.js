const SocketClient = {
  socket: null,
  callbacks: {},
  connected: false,
  pendingEmits: [],

  init() {
    this.socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    this.socket.on('connect', () => {
      console.log('Socket connected:', this.socket.id);
      this.connected = true;
      // Flush any pending emits
      for (const { event, data } of this.pendingEmits) {
        this.socket.emit(event, data);
      }
      this.pendingEmits = [];
    });

    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      this.connected = false;
    });

    this.socket.on('connect_error', (err) => {
      console.error('Socket connection error:', err.message);
    });

    this.setupListeners();
    return this.socket;
  },

  on(event, callback) {
    this.callbacks[event] = callback;
  },

  emit(event, data) {
    if (this.connected && this.socket) {
      this.socket.emit(event, data);
    } else {
      // Queue until connected
      this.pendingEmits.push({ event, data });
    }
  },

  setupListeners() {
    const events = [
      'room-created', 'room-joined', 'player-joined', 'player-left',
      'player-disconnected', 'player-reconnected',
      'game-start', 'game-update', 'round-result',
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
