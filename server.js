// The online server: run it with   node server.js
// It does two things, on port 8767:
//  · serves the game's files (so a friend on the same network can open it: the address is printed below)
//  · passes messages between the two players in each online room (a WebSocket relay). It doesn't run the game:
//    each player's computer runs its own ragdoll, and tells the other one where it is and who it hit.
// Nothing to install: it's plain Node.
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');
const PORT = +process.env.PORT || 8767, ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

// this computer's addresses on the network (for the link your friend opens)
const lanIPs = () => Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal && !a.address.startsWith('172.17.')).map(a => a.address);

// ---------------------------------------------------------------- the files
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT) || path.basename(file) === 'server.js') { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ---------------------------------------------------------------- the rooms
const rooms = new Map();   // room code → [player, player]
function send(c, msg) {
  if (c.dead) return;
  const data = Buffer.from(typeof msg === 'string' ? msg : JSON.stringify(msg));
  let head;
  if (data.length < 126) head = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
  c.sock.write(Buffer.concat([head, data]));
}
function leave(c) {
  if (c.dead) return;
  c.dead = true;
  const r = rooms.get(c.room);
  if (!r) return;
  const i = r.indexOf(c);
  if (i >= 0) r.splice(i, 1);
  for (const o of r) send(o, { t: 'left' });
  if (!r.length) rooms.delete(c.room);
  console.log(`room ${c.room}: a player left (${r.length} still in)`);
}
function onMessage(c, text) {
  let m;
  try { m = JSON.parse(text); } catch (e) { return; }
  if (m.t === 'join') {
    const code = String(m.room || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
    const r = rooms.get(code) || [];
    if (r.length >= 2) return send(c, { t: 'full' });
    c.room = code; r.push(c); rooms.set(code, r);
    send(c, { t: 'joined', n: r.length, ips: lanIPs() });
    console.log(`room ${code}: a player joined (${r.length} in)`);
    if (r.length === 2) r.forEach((p, i) => send(p, { t: 'start', host: i === 0 }));
    return;
  }
  // anything else goes to the other player in the room
  const r = rooms.get(c.room);
  if (r) for (const o of r) if (o !== c) send(o, text);
}

// every few seconds, a ping to everyone (browsers answer by themselves); anyone silent for a while has gone
const all = new Set();
setInterval(() => {
  for (const c of all) {
    if (Date.now() - c.heard > 25000) { leave(c); all.delete(c); c.sock.destroy(); continue; }
    if (!c.dead) c.sock.write(Buffer.from([0x89, 0]));
  }
}, 8000);

// the WebSocket bits: the handshake, then reading frames
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  const c = { sock, room: null, dead: false, heard: Date.now() };
  all.add(c);
  let buf = Buffer.alloc(0), parts = [];
  sock.on('data', d => {
    c.heard = Date.now();
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      const mask = masked ? buf.slice(at, at + 4) : null;
      if (masked) at += 4;
      if (buf.length < at + len) return;
      const payload = Buffer.from(buf.slice(at, at + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.slice(at + len);
      if (op === 8) { gone(); return; }                                                 // close
      if (op === 9) { sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }   // ping → pong
      if (op === 1 || op === 0) {
        parts.push(payload);
        if (fin) { onMessage(c, Buffer.concat(parts).toString()); parts = []; }
      }
    }
  });
  const gone = () => { leave(c); all.delete(c); sock.destroy(); };
  sock.on('end', gone);
  sock.on('close', gone);
  sock.on('error', gone);
});

server.listen(PORT, () => {
  console.log(`Ragdoll Brawl online server running on port ${PORT}.`);
  for (const ip of lanIPs()) console.log(`  On another computer on this network, open:  http://${ip}:${PORT}/`);
  console.log(`  On this computer:  http://localhost:${PORT}/`);
});
