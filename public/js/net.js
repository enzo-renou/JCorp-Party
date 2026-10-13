// Connexion Socket.IO + état partagé
/* global io */
export const socket = io({ transports: ['websocket', 'polling'] });
export const store = { state: null, offset: 0, connected: false };

const stateListeners = new Set();
const fxListeners = new Set();
export const onState = (fn) => { stateListeners.add(fn); return () => stateListeners.delete(fn); };
export const onFx = (fn) => { fxListeners.add(fn); return () => fxListeners.delete(fn); };

socket.on('state', (s) => {
  store.offset = s.now - Date.now();
  store.state = s;
  stateListeners.forEach((f) => f(s));
});
socket.on('fx', (e) => fxListeners.forEach((f) => f(e)));

/** heure du serveur (pour les compte à rebours) */
export const serverNow = () => Date.now() + store.offset;

export const emit = (event, data) => new Promise((res) => {
  let done = false;
  const t = setTimeout(() => { if (!done) res({ error: 'Pas de réponse du serveur.' }); }, 8000);
  socket.emit(event, data, (r) => { done = true; clearTimeout(t); res(r || {}); });
});
export const action = (msg) => socket.emit('game:action', msg);

// ---- session (pour revenir dans la partie après un rafraîchissement)
const KEY = 'jcorp.session';
export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* navigation privée */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* rien */ } },
};
export const prefs = {
  get(k, d) { try { return localStorage.getItem('jcorp.' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jcorp.' + k, v); } catch { /* rien */ } },
};
