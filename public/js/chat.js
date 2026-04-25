/* ═══════════════════════════════════════════════════════════════
   StrangerChat — Client
   Socket.io signaling + WebRTC video + text chat
   ═══════════════════════════════════════════════════════════════ */

/* ── Read URL params ── */
const urlParams   = new URLSearchParams(window.location.search);
const urlInterests = urlParams.get('interests') || '';
const MODE = document.querySelector('.app')?.dataset.mode || 'text';

const socket = io({ query: { interests: urlInterests, mode: MODE } });

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
const localVideo   = document.getElementById('localVideo');
const remoteVideo  = document.getElementById('remoteVideo');
const localNoCam   = document.getElementById('localNoCam');
const remoteNoCam  = document.getElementById('remoteNoCam');
const messagesEl   = document.getElementById('messages');
const inputEl      = document.getElementById('msgInput');
const sendBtn      = document.getElementById('sendBtn');
const nextBtn      = document.getElementById('nextBtn');
const stopBtn      = document.getElementById('stopBtn');
const statusBar    = document.getElementById('statusBar');
const statusText   = document.getElementById('statusText');
const typingRow    = document.getElementById('typingRow');
const chatState       = document.getElementById('chatState');
const chatStateSub    = document.getElementById('chatStateSub');
const chatStateActions = document.getElementById('chatStateActions');
const interestsBar    = document.getElementById('interestsBar');
const interestsTags   = document.getElementById('interestsTags');
const actionBar       = document.getElementById('actionBar');
const actionNextBtn   = document.getElementById('actionNextBtn');
const stopSearchBtn   = document.getElementById('stopSearchBtn');
const changeTagsBtn   = document.getElementById('changeTagsBtn');

/* ── Show user's own interest tags in the bar ── */
function renderUserInterests() {
  const tags = urlInterests.split(',').map(s => s.trim()).filter(Boolean).slice(0, 5);
  if (!tags.length || !interestsBar) return;
  interestsTags.innerHTML = tags.map(t =>
    `<span class="interests-tag">${t}</span>`
  ).join('');
  interestsBar.style.display = 'flex';
}
renderUserInterests();

/* ── Camera ── */
async function initCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    if (localVideo) {
      localVideo.srcObject = localStream;
      if (localNoCam) localNoCam.style.display = 'none';
    }
  } catch (e) {
    console.warn('Camera/mic unavailable.');
  }
}

/* text mode never calls initCamera — mic/camera only requested for video mode */

/* ── WebRTC ── */
function createPC() {
  if (pc) { pc.close(); pc = null; }
  pc = new RTCPeerConnection(STUN);

  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  pc.ontrack = (e) => {
    if (remoteVideo) {
      remoteVideo.srcObject = e.streams[0];
      if (remoteNoCam) remoteNoCam.style.display = 'none';
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('ice_candidate', e.candidate);
  };

  pc.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(pc?.connectionState)) {
      if (remoteVideo) remoteVideo.srcObject = null;
      if (remoteNoCam) remoteNoCam.style.display = 'flex';
    }
  };
}

function closePC() {
  if (pc) { pc.close(); pc = null; }
  if (remoteVideo) remoteVideo.srcObject = null;
  if (remoteNoCam) {
    remoteNoCam.style.display = 'flex';
    remoteNoCam.innerHTML = '<span>👤</span><br/>Waiting…';
  }
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

function showChatState(title, sub, showActions = false) {
  if (!chatState) return;
  chatState.querySelector('.chat-state-title').textContent = title;
  if (chatStateSub) chatStateSub.textContent = sub;
  chatState.style.display = 'flex';
  if (chatStateActions) chatStateActions.style.display = showActions ? 'flex' : 'none';
}

function hideChatState() {
  if (chatState) chatState.style.display = 'none';
}

function showActionBar() {
  if (actionBar) actionBar.style.display = 'flex';
}

function hideActionBar() {
  if (actionBar) actionBar.style.display = 'none';
}

function addMsg(who, text) {
  hideChatState();
  hideActionBar();

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
  hideChatState();
  hideActionBar();
}

/* ── Socket events ── */
socket.on('waiting', () => {
  setStatus('searching', 'Looking for a stranger…');
  setInputEnabled(false);
  clearChat();
  closePC();
  showChatState('Finding you a stranger…', 'Searching the network', true);
});

socket.on('matched', ({ common } = {}) => {
  setStatus('connected', 'Connected!');
  clearChat();
  addMsg('system', 'You are now chatting with a random stranger. Say hi! 👋');
  if (common && common.length > 0) {
    const tags = common.map(t => `#${t}`).join('  ');
    addMsg('system', `You both like: ${tags} 🎯`);
  }
  setInputEnabled(true);
  hideActionBar();
});

socket.on('initiate', async () => {
  if (MODE === 'video') await makeOffer();
});

socket.on('offer', async (offer) => {
  if (MODE !== 'video') return;
  createPC();
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', answer);
});

socket.on('answer', async (answer) => {
  if (MODE === 'video' && pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('ice_candidate', async (candidate) => {
  if (MODE === 'video' && pc) {
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
  addMsg('system', 'Your chat partner has disconnected.');
  setInputEnabled(false);
  closePC();
  typingRow.style.display = 'none';
  showActionBar();
});

socket.on('stopped', () => {
  setStatus('idle', 'Chat stopped.');
  setInputEnabled(false);
  clearChat();
  closePC();
  showChatState('Chat stopped', 'Press "Find New Stranger" to start again');
  showActionBar();
});

/* ── Controls ── */
nextBtn.addEventListener('click', () => socket.emit('next'));
stopBtn.addEventListener('click', () => socket.emit('stop'));
if (actionNextBtn) actionNextBtn.addEventListener('click', () => socket.emit('next'));
if (stopSearchBtn) stopSearchBtn.addEventListener('click', () => socket.emit('stop'));
if (changeTagsBtn) changeTagsBtn.addEventListener('click', () => {
  const params = new URLSearchParams();
  if (urlInterests) params.set('interests', urlInterests);
  window.location.href = '/?' + params.toString();
});

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
  const fullH    = screen.height;
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
if (MODE === 'video') initCamera();
