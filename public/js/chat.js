/* ═══════════════════════════════════════════════════════════════
   StrangerChat — Client
   Socket.io signaling + WebRTC video + text chat
   ═══════════════════════════════════════════════════════════════ */

const socket = io();

let pc          = null;
let localStream = null;
let isTyping    = false;
let typingTimer = null;
let chatActive  = false;

const STUN = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
] };

/* ── DOM ── */
const localVideo  = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localNoCam  = document.getElementById('localNoCam');
const remoteNoCam = document.getElementById('remoteNoCam');
const messagesEl  = document.getElementById('messages');
const inputEl     = document.getElementById('msgInput');
const sendBtn     = document.getElementById('sendBtn');
const nextBtn     = document.getElementById('nextBtn');
const stopBtn     = document.getElementById('stopBtn');
const statusBar   = document.getElementById('statusBar');
const statusText  = document.getElementById('statusText');
const typingRow   = document.getElementById('typingRow');

/* ── Camera ── */
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    localNoCam.style.display = 'none';
  } catch (e) {
    console.warn('Camera/mic unavailable — text-only mode.');
  }
}

/* ── WebRTC ── */
function createPC() {
  if (pc) { pc.close(); pc = null; }
  pc = new RTCPeerConnection(STUN);

  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  pc.ontrack = (e) => {
    remoteVideo.srcObject = e.streams[0];
    remoteNoCam.style.display = 'none';
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('ice_candidate', e.candidate);
  };

  pc.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc?.connectionState)) {
      remoteVideo.srcObject = null;
      remoteNoCam.style.display = 'flex';
    }
  };
}

function closePC() {
  if (pc) { pc.close(); pc = null; }
  remoteVideo.srcObject = null;
  remoteNoCam.style.display = 'flex';
  remoteNoCam.innerHTML = '<span>👤</span><br/>Waiting…';
}

async function makeOffer() {
  createPC();
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', offer);
}

/* ── UI helpers ── */
function setStatus(type, text) {
  statusBar.className = 'status status--' + type;
  statusText.textContent = text;
}

function setInputEnabled(on) {
  inputEl.disabled  = !on;
  sendBtn.disabled  = !on;
  chatActive = on;
  if (on) inputEl.focus();
}

function addMsg(who, text) {
  // Remove welcome screen on first message
  const welcome = messagesEl.querySelector('.welcome');
  if (welcome) welcome.remove();

  const wrap  = document.createElement('div');
  wrap.className = 'msg msg--' + who;

  if (who !== 'system') {
    const label = document.createElement('span');
    label.className = 'msg-label';
    label.textContent = who === 'you' ? 'You' : 'Stranger';
    wrap.appendChild(label);
  }

  const body = document.createElement('span');
  body.className = 'msg-body';
  body.textContent = text;
  wrap.appendChild(body);

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function clearChat() {
  messagesEl.innerHTML = '';
  typingRow.style.display = 'none';
  isTyping = false;
  clearTimeout(typingTimer);
}

/* ── Socket events ── */
socket.on('waiting', () => {
  setStatus('searching', 'Looking for a stranger…');
  setInputEnabled(false);
  clearChat();
  closePC();
  addMsg('system', 'Searching for someone to chat with…');
});

socket.on('matched', () => {
  setStatus('connected', 'Connected!');
  clearChat();
  addMsg('system', 'You are now chatting with a random stranger. Say hi! 👋');
  setInputEnabled(true);
});

socket.on('initiate', async () => {
  await makeOffer();
});

socket.on('offer', async (offer) => {
  createPC();
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', answer);
});

socket.on('answer', async (answer) => {
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice_candidate', async (candidate) => {
  if (pc) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (_) {}
  }
});

socket.on('message', (text) => {
  addMsg('stranger', text);
});

socket.on('typing', () => {
  typingRow.style.display = 'flex';
});

socket.on('stop_typing', () => {
  typingRow.style.display = 'none';
});

socket.on('stranger_disconnected', () => {
  setStatus('disconnected', 'Stranger disconnected.');
  addMsg('system', 'Your chat partner has disconnected. Press Next to find a new stranger.');
  setInputEnabled(false);
  closePC();
  typingRow.style.display = 'none';
});

socket.on('stopped', () => {
  setStatus('idle', 'Chat stopped.');
  setInputEnabled(false);
  clearChat();
  closePC();
  addMsg('system', 'Chat stopped. Press Next to start again.');
});

/* ── Controls ── */
nextBtn.addEventListener('click', () => socket.emit('next'));
stopBtn.addEventListener('click', () => socket.emit('stop'));

sendBtn.addEventListener('click', sendMessage);
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

function sendMessage() {
  const text = inputEl.value.trim();
  if (!text || !chatActive) return;
  socket.emit('message', text);
  addMsg('you', text);
  inputEl.value = '';
  // Stop typing signal
  clearTimeout(typingTimer);
  if (isTyping) { socket.emit('stop_typing'); isTyping = false; }
}

/* ── Typing detection ── */
inputEl.addEventListener('input', () => {
  if (!chatActive) return;
  if (!isTyping) { isTyping = true; socket.emit('typing'); }
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    isTyping = false;
    socket.emit('stop_typing');
  }, 1500);
});

/* ── Mobile: dynamically resize app to visual viewport ── */
const videoCol = document.querySelector('.video-col');

function applyViewportHeight() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-h', h + 'px');
}

function onViewportResize() {
  applyViewportHeight();
  // Collapse video strip if keyboard likely open (viewport shrank > 100px)
  const fullH = screen.height;
  const currentH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  const keyboardOpen = fullH - currentH > 150;
  if (videoCol) videoCol.classList.toggle('collapsed', keyboardOpen);
  if (keyboardOpen) {
    setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 100);
  }
}

applyViewportHeight();
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', onViewportResize);
  window.visualViewport.addEventListener('scroll', onViewportResize);
}
window.addEventListener('resize', applyViewportHeight);

/* ── Scroll to bottom when input focused ── */
inputEl.addEventListener('focus', () => {
  setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 350);
});

/* ── Init ── */
initCamera();
