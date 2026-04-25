const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.render('home'));
app.get('/chat', (req, res) => {
  const mode = req.query.mode === 'text' ? 'text' : 'video';
  res.render('index', { mode });
});

/* ── Matching state ── */
const waiting = [];     // socket IDs in queue
const pairs   = new Map(); // socket.id ↔ partner socket.id

function parseInterests(raw) {
  return (raw || '').split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0 && s.length < 30)
    .slice(0, 5);
}

function connectPair(sockA, sockB, common) {
  pairs.set(sockA.id, sockB.id);
  pairs.set(sockB.id, sockA.id);
  sockA.emit('matched', { common });
  sockB.emit('matched', { common });
  sockA.emit('initiate');
}

function matchUser(socket) {
  const interests = socket.interests || [];

  // 1st pass — find someone with a matching interest
  if (interests.length > 0) {
    for (let i = 0; i < waiting.length; i++) {
      const candId = waiting[i];
      const cand   = io.sockets.sockets.get(candId);
      if (!cand || !cand.connected) { waiting.splice(i--, 1); continue; }

      const common = interests.filter(t => (cand.interests || []).includes(t));
      if (common.length > 0) {
        waiting.splice(i, 1);
        connectPair(socket, cand, common);
        return;
      }
    }
  }

  // 2nd pass — random match from queue
  while (waiting.length > 0) {
    const candId = waiting.shift();
    const cand   = io.sockets.sockets.get(candId);
    if (cand && cand.connected) {
      connectPair(socket, cand, []);
      return;
    }
  }

  // No one available — add to queue
  waiting.push(socket.id);
  socket.emit('waiting');
}

function releaseUser(socketId) {
  const qi = waiting.indexOf(socketId);
  if (qi !== -1) waiting.splice(qi, 1);

  const partnerId = pairs.get(socketId);
  if (partnerId) {
    pairs.delete(socketId);
    pairs.delete(partnerId);
    const partner = io.sockets.sockets.get(partnerId);
    if (partner && partner.connected) partner.emit('stranger_disconnected');
  }
}

io.on('connection', (socket) => {
  socket.interests = parseInterests(socket.handshake.query.interests);

  matchUser(socket);

  socket.on('next', () => { releaseUser(socket.id); matchUser(socket); });
  socket.on('stop', () => { releaseUser(socket.id); socket.emit('stopped'); });

  socket.on('message', (text) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 500) return;
    const pid = pairs.get(socket.id);
    if (pid) io.to(pid).emit('message', text.trim());
  });

  socket.on('typing',      () => { const p = pairs.get(socket.id); if (p) io.to(p).emit('typing'); });
  socket.on('stop_typing', () => { const p = pairs.get(socket.id); if (p) io.to(p).emit('stop_typing'); });

  socket.on('offer',         (d) => { const p = pairs.get(socket.id); if (p) io.to(p).emit('offer', d); });
  socket.on('answer',        (d) => { const p = pairs.get(socket.id); if (p) io.to(p).emit('answer', d); });
  socket.on('ice_candidate', (d) => { const p = pairs.get(socket.id); if (p) io.to(p).emit('ice_candidate', d); });

  socket.on('disconnect', () => releaseUser(socket.id));
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log(`\n🎲  StrangerChat live → http://localhost:${PORT}\n`));
