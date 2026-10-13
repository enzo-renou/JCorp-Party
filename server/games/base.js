'use strict';
const { ms: scaleMs } = require('../util');

/**
 * Classe de base d'un mini-jeu.
 *
 * Le salon (room.js) fournit un `ctx` :
 *   ctx.participants   ids des joueurs présents au lancement
 *   ctx.masterId       id du maître du jeu de cette manche
 *   ctx.info(pid)      { id, name, avatar }
 *   ctx.isConnected(pid)
 *   ctx.update()       demande de renvoyer la vue à tous les joueurs
 *   ctx.fx(event, data, { to, except })   évènement ponctuel (ex. traits de dessin)
 *   ctx.finish({ scores, notes })         fin du jeu : scores bruts par joueur
 *   ctx.memory         mémoire du salon (pour ne pas répéter les questions)
 *
 * Un mini-jeu implémente : start(), view(pid), onAction(pid, msg), onConnectionChange(pid, connected)
 */
class Game {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.options = options;
    this.ids = [...ctx.participants];
    this.masterId = ctx.masterId;
    this.timers = new Set();
    this.dead = false;
  }

  has(pid) { return this.ids.includes(pid); }
  connected(pid) { return this.ctx.isConnected(pid); }
  connectedIds() { return this.ids.filter((id) => this.connected(id)); }
  name(pid) { return this.ctx.info(pid)?.name ?? '?'; }
  update() { if (!this.dead) this.ctx.update(); }

  after(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.dead) {
        try { fn(); } catch (e) { console.error('[game timer]', e); }
      }
    }, scaleMs(ms));
    this.timers.add(t);
    return t;
  }
  cancel(t) {
    if (t) { clearTimeout(t); this.timers.delete(t); }
  }

  destroy() {
    this.dead = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // à surcharger
  start() {}
  view() { return {}; }
  onAction() {}
  onConnectionChange() {}
}

module.exports = Game;
