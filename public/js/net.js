// Peer-to-peer multiplayer over WebRTC (PeerJS, loaded as a global in index.html).
// Everyone who types the same room code ends up in the same room: the first one to open the
// code becomes the host and relays messages for the others, like a tiny game server in the browser.
const PREFIX = 'ncu-racing-v1-';
const MAX_PLAYERS = 8;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const randomCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

export class Net {
  constructor() { this.handlers = {}; this.gen = 0; this.reset(); }

  reset() {
    this.peer = null; this.isHost = false; this.hostConn = null; this.id = null; this.room = null;
    this.players = new Map(); this.racing = false; this.nextId = 2;
  }

  on(type, fn) { this.handlers[type] = fn; }
  emit(m) { this.handlers[m.t]?.(m); }
  get connected() { return this.isHost ? !!this.peer && !this.peer.destroyed : !!this.hostConn?.open; }

  // Join room `code`, creating it when nobody hosts it yet. Resolves once in the lobby.
  async join(code, name, color) {
    if (!window.Peer) throw new Error('無法載入連線元件，請檢查網路');
    this.close();
    const gen = ++this.gen;
    this.me = { name, color };
    code = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || randomCode(); // PeerJS ids are alphanumeric
    try {
      await this.host(code, gen);
    } catch (e) {
      if (e.type !== 'unavailable-id') throw new Error('連線失敗：' + (e.type || e.message));
      await this.connectTo(code, gen); // someone already hosts this code
    }
    return code;
  }

  close() {
    const peer = this.peer;
    this.gen++; // ignore events from the old connection
    this.reset();
    peer?.destroy();
  }

  send(m) {
    if (this.isHost) this.handle(1, m);
    else if (this.hostConn?.open) this.hostConn.send(m);
  }

  // ---------- host side ----------
  host(code, gen) {
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(PREFIX + code);
      let opened = false;
      peer.on('open', () => {
        if (gen !== this.gen) { peer.destroy(); return; }
        opened = true;
        this.peer = peer; this.isHost = true; this.room = code; this.id = 1;
        this.players.set(1, { id: 1, name: this.me.name, color: this.me.color, conn: null });
        peer.on('connection', (conn) => this.accept(conn, gen));
        this.emit({ t: 'joined', id: 1, room: code, host: 1, players: this.list(), racing: false });
        resolve();
      });
      peer.on('error', (e) => {
        if (!opened) { peer.destroy(); reject(e); }
      });
      // losing the signalling server does not drop open data channels; just re-register
      peer.on('disconnected', () => { if (gen === this.gen && !peer.destroyed) peer.reconnect(); });
    });
  }

  accept(conn, gen) {
    let pid = null;
    conn.on('data', (m) => {
      if (gen !== this.gen || !m || typeof m !== 'object') return;
      if (pid !== null) { this.handle(pid, m); return; }
      if (m.t !== 'join') return;
      if (this.players.size >= MAX_PLAYERS) {
        conn.send({ t: 'error', msg: '房間已滿（最多 8 人）' }); setTimeout(() => conn.close(), 500); return;
      }
      pid = this.nextId++;
      this.players.set(pid, { id: pid, name: String(m.name || 'Player').slice(0, 16), color: Math.abs(m.color | 0) % 8, conn });
      conn.send({ t: 'joined', id: pid, room: this.room, host: 1, players: this.list(), racing: this.racing });
      this.broadcast({ t: 'players', host: 1, players: this.list() }, pid);
    });
    conn.on('close', () => {
      if (gen !== this.gen || pid === null || !this.players.delete(pid)) return;
      this.broadcast({ t: 'left', id: pid, host: 1, players: this.list() });
    });
    conn.on('error', () => conn.close());
  }

  list() { return [...this.players.values()].map(({ id, name, color }) => ({ id, name, color })); }

  broadcast(m, exclude) {
    for (const p of this.players.values()) {
      if (p.id === exclude) continue;
      if (p.id === 1) this.emit(m);
      else if (p.conn.open) p.conn.send(m);
    }
  }

  // A message from player `pid` (1 = the host itself) arriving at the host.
  handle(pid, m) {
    if (m.t === 'start' && pid === 1) {
      this.racing = true;
      this.broadcast({ t: 'start', laps: m.laps | 0 || 3, order: [...this.players.keys()] });
    } else if (m.t === 'lobby' && pid === 1) {
      this.racing = false;
      this.broadcast({ t: 'lobby' });
    } else if (m.t === 's' || m.t === 'finish') {
      this.broadcast({ ...m, id: pid }, pid);
    }
  }

  // ---------- guest side ----------
  connectTo(code, gen) {
    return new Promise((resolve, reject) => {
      const peer = this.peer = new window.Peer();
      let settled = false;
      const fail = (msg) => {
        if (settled || gen !== this.gen) return;
        settled = true; this.close(); reject(new Error(msg));
      };
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => conn.send({ t: 'join', name: this.me.name, color: this.me.color }));
        conn.on('data', (m) => {
          if (gen !== this.gen) return;
          if (m.t === 'error' && !settled) { fail(m.msg); return; }
          if (m.t === 'joined') { this.id = m.id; this.room = m.room; this.hostConn = conn; settled = true; resolve(); }
          this.emit(m);
        });
        conn.on('close', () => {
          if (gen !== this.gen) return;
          if (settled) { this.close(); this.emit({ t: 'close' }); } else fail('無法加入房間');
        });
      });
      peer.on('error', (e) => fail(e.type === 'peer-unavailable' ? '找不到這個房間，請確認房號' : '連線失敗：' + e.type));
      setTimeout(() => fail('連線逾時，請再試一次'), 15000);
    });
  }
}

// Buffers remote snapshots and renders them ~120 ms in the past for smooth motion.
export class RemoteCar {
  constructor(id, name) { this.id = id; this.name = name; this.snaps = []; this.lap = 0; this.progress = -1e9; this.finished = null; }

  push(m) {
    this.snaps.push({ t: performance.now(), ...m });
    if (this.snaps.length > 30) this.snaps.shift();
    this.lap = m.lap; this.progress = m.prog; this.s = m.ps; this.lateral = m.lat;
  }

  sample() {
    const t = performance.now() - 120, S = this.snaps;
    if (!S.length) return null;
    if (S.length === 1 || t <= S[0].t) return S[0];
    for (let i = S.length - 1; i > 0; i--) {
      const a = S[i - 1], b = S[i];
      if (t >= a.t) {
        if (t > b.t) return b;
        const k = (t - a.t) / Math.max(1, b.t - a.t);
        let dy = b.yaw - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, yaw: a.yaw + dy * k, st: b.st, w: a.w + (b.w - a.w) * k, br: b.br, v: b.v };
      }
    }
    return S[S.length - 1];
  }
}
