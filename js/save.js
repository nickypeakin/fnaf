// Worlds are saved in the browser (IndexedDB). Falls back to memory if storage is blocked.
(function (G) {
  'use strict';
  const MC = G.MC;
  const memory = new Map();
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open('blockcraft', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('worlds', { keyPath: 'id' }); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }

  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      if (!db) { resolve(fn(null)); return; }
      const t = db.transaction('worlds', mode);
      const store = t.objectStore('worlds');
      const r = fn(store);
      t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : r);
      t.onerror = () => reject(t.error);
    }));
  }

  MC.Save = {
    get persistent() { return open().then((db) => !!db); },
    async list() {
      const all = await tx('readonly', (s) => (s ? s.getAll() : [...memory.values()]));
      return (all || []).map((w) => ({ id: w.id, name: w.name, seed: w.seed, mode: w.mode, difficulty: w.difficulty, played: w.played, created: w.created })).sort((a, b) => (b.played || 0) - (a.played || 0));
    },
    get(id) { return tx('readonly', (s) => (s ? s.get(id) : memory.get(id))); },
    put(w) { w.played = Date.now(); return tx('readwrite', (s) => (s ? s.put(w) : memory.set(w.id, w))); },
    remove(id) { return tx('readwrite', (s) => (s ? s.delete(id) : memory.delete(id))); },
  };
})(globalThis);
