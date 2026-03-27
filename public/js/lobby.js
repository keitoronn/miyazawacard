const socket = io({
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000
});

const nameInput = document.getElementById('player-name');
const codeInput = document.getElementById('room-code');
const createBtn = document.getElementById('create-btn');
const joinBtn = document.getElementById('join-btn');
const errorMsg = document.getElementById('error-msg');

let socketReady = false;

socket.on('connect', () => {
  console.log('Lobby socket connected');
  socketReady = true;
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err.message);
  showError('サーバーに接続できません。リロードしてください。');
});

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.style.display = 'block';
  setTimeout(() => { errorMsg.style.display = 'none'; }, 3000);
}

function getName() {
  const name = nameInput.value.trim();
  if (!name) {
    showError('名前を入力してください');
    return null;
  }
  return name;
}

createBtn.addEventListener('click', () => {
  const name = getName();
  if (!name) return;
  if (!socketReady) {
    showError('サーバーに接続中です。少々お待ちください。');
    return;
  }
  createBtn.disabled = true;
  socket.emit('create-room', { playerName: name });
});

joinBtn.addEventListener('click', () => {
  const name = getName();
  if (!name) return;
  const code = codeInput.value.trim().toUpperCase();
  if (!code || code.length !== 4) {
    showError('4文字のルームコードを入力してください');
    return;
  }
  if (!socketReady) {
    showError('サーバーに接続中です。少々お待ちください。');
    return;
  }
  joinBtn.disabled = true;
  socket.emit('check-room', { roomCode: code, playerName: name });
});

// Enter key support
codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (codeInput.value.trim()) joinBtn.click();
  }
});

socket.on('room-created', ({ roomCode }) => {
  sessionStorage.setItem('playerName', nameInput.value.trim());
  window.location.href = `/game.html?room=${roomCode}`;
});

socket.on('room-ok', ({ roomCode }) => {
  sessionStorage.setItem('playerName', nameInput.value.trim());
  window.location.href = `/game.html?room=${roomCode}`;
});

socket.on('error', ({ message }) => {
  showError(message);
  createBtn.disabled = false;
  joinBtn.disabled = false;
});
