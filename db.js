/**
 * db.js — IndexedDB Database Layer
 * ============================================================
 * Provides a Promise-based wrapper around IndexedDB for the
 * VoteSecure voting system.
 *
 * Stores:
 *   voters     — registered voter accounts
 *   candidates — election candidates
 *   votes      — cast ballots
 *   election   — election configuration & timer settings
 *   sessions   — active login sessions
 * ============================================================
 */

const DB_NAME    = 'VoteSecureDB';
const DB_VERSION = 1;

/** Open (or upgrade) the database. Returns a Promise<IDBDatabase>. */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // ── Voters store ──────────────────────────────────────
      if (!db.objectStoreNames.contains('voters')) {
        const voters = db.createObjectStore('voters', { keyPath: 'voterId' });
        voters.createIndex('email',  'email',  { unique: true });
        voters.createIndex('phone',  'phone',  { unique: false });
        voters.createIndex('status', 'status', { unique: false });
      }

      // ── Candidates store ──────────────────────────────────
      if (!db.objectStoreNames.contains('candidates')) {
        const candidates = db.createObjectStore('candidates', {
          keyPath: 'id', autoIncrement: true
        });
        candidates.createIndex('position', 'position', { unique: false });
      }

      // ── Votes store ───────────────────────────────────────
      if (!db.objectStoreNames.contains('votes')) {
        const votes = db.createObjectStore('votes', {
          keyPath: 'id', autoIncrement: true
        });
        votes.createIndex('voterId',     'voterId',     { unique: false });
        votes.createIndex('candidateId', 'candidateId', { unique: false });
        votes.createIndex('position',    'position',    { unique: false });
        // Compound: one vote per voter per position
        votes.createIndex('voterPosition', ['voterId','position'], { unique: true });
      }

      // ── Election config store (single record, key = 'config') ──
      if (!db.objectStoreNames.contains('election')) {
        db.createObjectStore('election', { keyPath: 'key' });
      }

      // ── Sessions store ────────────────────────────────────
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'token' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

/** Generic helper: run a transaction and return the result. */
function notifyDataChanged(type = 'update') {
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel('votesecure-sync');
      channel.postMessage({ type, ts: Date.now() });
      channel.close();
    }
    localStorage.setItem('votesecure-sync', JSON.stringify({ type, ts: Date.now() }));
  } catch (err) {
    console.warn('Sync notification failed:', err);
  }
}

function dbTransaction(storeName, mode, action, notifyOnComplete = false) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req   = action(store);
    if (req) {
      req.onsuccess = () => {
        if (notifyOnComplete) notifyDataChanged();
        resolve(req.result);
      };
      req.onerror   = () => reject(req.error);
    } else {
      tx.oncomplete = () => {
        if (notifyOnComplete) notifyDataChanged();
        resolve();
      };
      tx.onerror    = () => reject(tx.error);
    }
  }));
}

// ── Password Hashing (PBKDF2 via Web Crypto API) ──────────────────────────

/**
 * Hash a password using PBKDF2 with a random salt.
 * Returns a hex string: "<salt>:<hash>"
 */
async function hashPassword(password) {
  const salt       = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashArray = Array.from(new Uint8Array(bits));
  const saltHex   = Array.from(salt).map(b => b.toString(16).padStart(2,'0')).join('');
  const hashHex   = hashArray.map(b => b.toString(16).padStart(2,'0')).join('');
  return `${saltHex}:${hashHex}`;
}

/**
 * Verify a plaintext password against a stored hash.
 */
async function verifyPassword(password, stored) {
  const [saltHex, storedHash] = stored.split(':');
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2,'0')).join('');
  return hashHex === storedHash;
}

// ── Voter ID Generator ─────────────────────────────────────────────────────

function generateVoterId() {
  const year   = new Date().getFullYear().toString().slice(-2);
  const random = Math.random().toString(36).substring(2,8).toUpperCase();
  return `VS${year}-${random}`;
}

// ── Session Helpers ────────────────────────────────────────────────────────

function generateToken() {
  return crypto.getRandomValues(new Uint8Array(24))
    .reduce((s,b) => s + b.toString(16).padStart(2,'0'), '');
}

function saveSession(data) {
  sessionStorage.setItem('vs_session', JSON.stringify(data));
}

function getSession() {
  try {
    return JSON.parse(sessionStorage.getItem('vs_session'));
  } catch { return null; }
}

function clearSession() {
  sessionStorage.removeItem('vs_session');
}

function requireAuth(adminOnly = false) {
  const sess = getSession();
  if (!sess) { window.location.href = 'login.html'; return null; }
  if (adminOnly && !sess.isAdmin) { window.location.href = 'vote.html'; return null; }
  return sess;
}

// ── Input Sanitisation ─────────────────────────────────────────────────────

function sanitize(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function validateEmail(email) {
  const value = email.trim();
  if (!value) return false;
  if (value.includes(' ')) return false;
  if (value.startsWith('.') || value.endsWith('.')) return false;
  if (value.includes('..')) return false;
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(value);
}

function validatePhone(phone) {
  const value = phone.trim();
  if (!value) return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return false;
  return /^\+?[\d\s\-()]{7,15}$/.test(value);
}

function validateName(name) {
  const value = name.trim();
  if (!value || value.length < 2) return false;
  if (!/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'.-]{1,49}$/.test(value)) return false;
  return value.split(/\s+/).every(part => part.length >= 1);
}

function validatePassword(password) {
  return /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(password);
}

// ── VOTER CRUD ─────────────────────────────────────────────────────────────

async function registerVoter({ fullName, email, phone, password }) {
  // Check for duplicate email
  const existing = await getVoterByEmail(email);
  if (existing) throw new Error('An account with this email already exists.');

  const hash    = await hashPassword(password);
  const voterId = generateVoterId();
  const voter   = {
    voterId,
    fullName: fullName.trim(),
    email:    email.trim().toLowerCase(),
    phone:    phone.trim(),
    password: hash,
    status:   'active',       // active | suspended
    isAdmin:  false,
    createdAt: Date.now(),
    hasVoted: {}              // { positionName: candidateId }
  };

  await dbTransaction('voters', 'readwrite', store => store.add(voter), true);
  return voterId;
}

function getVoter(voterId) {
  return dbTransaction('voters', 'readonly', store => store.get(voterId));
}

function getVoterByEmail(email) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx    = db.transaction('voters', 'readonly');
    const index = tx.objectStore('voters').index('email');
    const req   = index.get(email.trim().toLowerCase());
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => reject(req.error);
  }));
}

function getAllVoters() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx  = db.transaction('voters', 'readonly');
    const req = tx.objectStore('voters').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function updateVoter(voter) {
  return dbTransaction('voters', 'readwrite', store => store.put(voter), true);
}

function deleteVoter(voterId) {
  return dbTransaction('voters', 'readwrite', store => store.delete(voterId), true);
}

// ── CANDIDATE CRUD ────────────────────────────────────────────────────────

async function addCandidate(candidate) {
  return dbTransaction('candidates', 'readwrite', store => store.add({
    ...candidate,
    createdAt: Date.now()
  }));
}

function getCandidate(id) {
  return dbTransaction('candidates', 'readonly', store => store.get(Number(id)));
}

function getAllCandidates() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction('candidates','readonly').objectStore('candidates').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function updateCandidate(candidate) {
  return dbTransaction('candidates', 'readwrite', store => store.put(candidate), true);
}

function deleteCandidate(id) {
  return dbTransaction('candidates', 'readwrite', store => store.delete(Number(id)), true);
}

// ── VOTE CRUD ──────────────────────────────────────────────────────────────

async function castVote(voterId, candidateId, position) {
  // Prevent duplicate: unique index on [voterId, position] will throw
  return dbTransaction('votes', 'readwrite', store => store.add({
    voterId, candidateId: Number(candidateId), position,
    timestamp: Date.now()
  }), true);
}

function getAllVotes() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const req = db.transaction('votes','readonly').objectStore('votes').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

function getVotesByPosition(position) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const index = db.transaction('votes','readonly').objectStore('votes').index('position');
    const req   = index.getAll(position);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

// ── ELECTION CONFIG ────────────────────────────────────────────────────────

async function getElectionConfig() {
  const cfg = await dbTransaction('election', 'readonly', store => store.get('config'));
  return cfg || { key:'config', title:'General Election', startTime: null, endTime: null };
}

function saveElectionConfig(config) {
  return dbTransaction('election', 'readwrite', store => store.put({ key:'config', ...config }), true);
}

function isElectionActive(config) {
  if (!config.startTime || !config.endTime) return false;
  const now = Date.now();
  return now >= config.startTime && now <= config.endTime;
}

// ── Seed admin account (called once on app init) ──────────────────────────

async function ensureAdminExists() {
  const admin = await getVoter('ADMIN-001');
  if (admin) {
    const updatedAdmin = {
      ...admin,
      isAdmin: true,
      status: admin.status || 'active',
      email: admin.email || 'admin@votesecure.gov'
    };
    await updateVoter(updatedAdmin);
    return;
  }

  const hash = await hashPassword('admin123');
  await dbTransaction('voters', 'readwrite', store => store.add({
    voterId:   'ADMIN-001',
    fullName:  'System Administrator',
    email:     'admin@votesecure.gov',
    phone:     '000-000-0000',
    password:  hash,
    status:    'active',
    isAdmin:   true,
    createdAt: Date.now(),
    hasVoted:  {}
  }));
}

// ── Toast Helper ───────────────────────────────────────────────────────────

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container')
    || Object.assign(document.createElement('div'), { id: 'toast-container' });
  if (!container.parentNode) document.body.appendChild(container);

  const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const toast  = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${sanitize(message)}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Initialise DB & admin on script load
ensureAdminExists().catch(console.error);
