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

app.get('/', (req, res) => res.render('index'));

/* ── Matching state ── */
const waiting = []; // socket IDs waiting for a partner
const pairs   = new Map(); // socket.id ↔ partner socket.id

function matchUser(socket) {
  // Drain stale queue entries first
  while (waiting.length > 0) {
    const candidateId = waiting.shift();
    const candidate   = io.sockets.sockets.get(candidateId);
    if (candidate && candidate.connected) {
      pairs.set(socket.id, candidateId);
      pairs.set(candidateId, socket.id);
      socket.emit('matched');
      candidate.emit('matched');
      socket.emit('initiate'); // this socket makes the WebRTC offer
      return;
    }
  }
  waiting.push(socket.id);
  socket.emit('waiting');
}

function releaseUser(socketId) {
  // Remove from waiting queue
  const qi = waiting.indexOf(socketId);
  if (qi !== -1) waiting.splice(qi, 1);

  // Notify and release partner
  const partnerId = pairs.get(socketId);
  if (partnerId) {
    pairs.delete(socketId);
    pairs.delete(partnerId);
    const partner = io.sockets.sockets.get(partnerId);
    if (partner && partner.connected) {
      partner.emit('stranger_disconnected');
    }
  }
}

io.on('connection', (socket) => {
  matchUser(socket);

  socket.on('next', () => {
    releaseUser(socket.id);
    matchUser(socket);
  });

  socket.on('stop', () => {
    releaseUser(socket.id);
    socket.emit('stopped');
  });

  socket.on('message', (text) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 500) return;
    const partnerId = pairs.get(socket.id);
    if (partnerId) io.to(partnerId).emit('message', text.trim());
  });

  socket.on('typing',      () => { const p = pairs.get(socket.id); if (p) io.to(p).emit('typing'); });
  socket.on('stop_typing', () => { const p = pairs.get(socket.id); if (p) io.to(p).emit('stop_typing'); });

  /* WebRTC signaling — just relay to partner */
  socket.on('offer',         (d) => { const p = pairs.get(socket.id); if (p) io.to(p).emit('offer', d); });
  socket.on('answer',        (d) => { const p = pairs.get(socket.id); if (p) io.to(p).emit('answer', d); });
  socket.on('ice_candidate', (d) => { const p = pairs.get(socket.id); if (p) io.to(p).emit('ice_candidate', d); });

  socket.on('disconnect', () => releaseUser(socket.id));
});

const PORT = process.env.PORT || 3002;
server.listen(PORT, () => console.log(`\n🎲  StrangerChat live → http://localhost:${PORT}\n`));
