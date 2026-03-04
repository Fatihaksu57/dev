// ============================================================
// database.js – SiteSketch
// IndexedDB wrapper with localStorage fallback
// Stores: 'projects', 'photos'
// ============================================================

class Database {
    constructor() {
        this.db = null;
        this.useIDB = true;
    }

    async init() {
        return new Promise((resolve) => {
            if (!window.indexedDB) { this.useIDB = false; resolve(); return; }
            const req = indexedDB.open('SiteSketchDB', 1);
            req.onerror = () => { this.useIDB = false; resolve(); };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('projects')) {
                    const ps = db.createObjectStore('projects', { keyPath: 'id' });
                    ps.createIndex('customer', 'customer');
                }
                if (!db.objectStoreNames.contains('photos')) {
                    const phs = db.createObjectStore('photos', { keyPath: 'id' });
                    phs.createIndex('projectId', 'projectId');
                }
            };
        });
    }

    async getAll(store) {
        if (!this.useIDB) return JSON.parse(localStorage.getItem('ss_' + store) || '[]');
        return new Promise((resolve) => {
            const tx = this.db.transaction([store], 'readonly');
            tx.objectStore(store).getAll().onsuccess = (e) => resolve(e.target.result);
        });
    }

    async get(store, id) {
        if (!this.useIDB) return (await this.getAll(store)).find(i => i.id === id);
        return new Promise((resolve) => {
            const tx = this.db.transaction([store], 'readonly');
            tx.objectStore(store).get(id).onsuccess = (e) => resolve(e.target.result);
        });
    }

    async put(store, item) {
        if (!this.useIDB) {
            const items = await this.getAll(store);
            const idx = items.findIndex(i => i.id === item.id);
            if (idx >= 0) items[idx] = item; else items.push(item);
            localStorage.setItem('ss_' + store, JSON.stringify(items));
            return item;
        }
        return new Promise((resolve) => {
            const tx = this.db.transaction([store], 'readwrite');
            tx.objectStore(store).put(item).onsuccess = () => resolve(item);
        });
    }

    async delete(store, id) {
        if (!this.useIDB) {
            const items = (await this.getAll(store)).filter(i => i.id !== id);
            localStorage.setItem('ss_' + store, JSON.stringify(items));
            return;
        }
        return new Promise((resolve) => {
            const tx = this.db.transaction([store], 'readwrite');
            tx.objectStore(store).delete(id).onsuccess = () => resolve();
        });
    }

    async getByIndex(store, index, value) {
        if (!this.useIDB) return (await this.getAll(store)).filter(i => i[index] === value);
        return new Promise((resolve) => {
            const tx = this.db.transaction([store], 'readonly');
            tx.objectStore(store).index(index).getAll(value).onsuccess = (e) => resolve(e.target.result);
        });
    }
}
