// ============================================================
// editor.js – SiteSketch
// Canvas-based photo annotation editor
// Depends on: constants.js (TOOLS, TOOL_GROUPS, SURFACES, DNS)
// ============================================================

// iOS / viewport utilities
const iOS = {
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
    nextFrame: () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    forceLayout: (el) => { el.offsetHeight; return el; },
    getViewportHeight: () => window.visualViewport ? window.visualViewport.height : window.innerHeight
};

class Editor {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.photo = null;
        this.image = null;
        this.annotations = [];
        this.selectedTool = 'SELECT';
        this.selectedAnn = null;
        this._draggingLabel = null;
        this.undoStack = [];
        this.redoStack = [];
        this.drawing = false;
        this.path = [];
        this.scale = 1;
        this.currentMousePos = null;
        this.dragPointIndex = null;
        this._resizing = null;
        this._resizingLabel = null;
        this._rotating = null;
        this.currentSurface = 'GEHWEGPLATTE';
        this.currentDN = 'DN50';
        this.sizeMultiplier = 1;
        this._textInputActive = false;
        this.snapRadius = 35;
        this._snapIndicator = null;
    }

    // ----------------------------------------------------------
    // Initialise editor for a given photo + image element
    // ----------------------------------------------------------
    init(photo, img) {
        this.photo = photo;
        this.image = img;
        this.annotations = JSON.parse(JSON.stringify(photo.annotations || []));
        this.undoStack = [];
        this.redoStack = [];
        this.selectedAnn = null;
        this.selectedTool = 'SELECT';
        this.dragPointIndex = null;

        // Auto size-multiplier for high-res images
        if (photo.sizeMultiplier) {
            this.sizeMultiplier = photo.sizeMultiplier;
        } else {
            const longestSide = Math.max(img.width, img.height);
            this.sizeMultiplier = longestSide > 1200
                ? Math.max(1, Math.round(longestSide / 1200 * 4) / 4)
                : 1;
        }

        this.canvas = document.getElementById('editorCanvas');
        this.ctx = this.canvas.getContext('2d');

        // Fit canvas to viewport
        const toolbarReserve = iOS.isIOS ? 120 : 100;
        const headerReserve  = iOS.isIOS ? 120 : 100;
        const margin = 32;
        const maxW = Math.max(200, window.innerWidth - margin);
        const maxH = Math.max(200, iOS.getViewportHeight() - (toolbarReserve + headerReserve));
        this.scale = Math.min(maxW / img.width, maxH / img.height, 1);
        this.canvas.width  = img.width  * this.scale;
        this.canvas.height = img.height * this.scale;

        this.setupEvents();
        this.renderToolbar();
        this.renderLegend();
        this.renderLayers();
        this.render();
    }

    // ----------------------------------------------------------
    // Snap system
    // ----------------------------------------------------------
    findSnapPoint(p, excludeAnn) {
        let best = null, bestDist = this.snapRadius;
        for (const a of this.annotations) {
            if (a === excludeAnn) continue;
            if (a.points) {
                for (const pt of a.points) {
                    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
                    if (d < bestDist) { bestDist = d; best = { x: pt.x, y: pt.y, type: 'endpoint' }; }
                }
                for (let j = 0; j < a.points.length - 1; j++) {
                    const np = this._nearestOnSeg(p, a.points[j], a.points[j + 1]);
                    const d = Math.hypot(p.x - np.x, p.y - np.y);
                    if (d < bestDist && d > 3) { bestDist = d; best = { x: np.x, y: np.y, type: 'online' }; }
                }
            }
            if (a.point) {
                const d = Math.hypot(p.x - a.point.x, p.y - a.point.y);
                if (d < bestDist) { bestDist = d; best = { x: a.point.x, y: a.point.y, type: 'center' }; }
            }
        }
        return best;
    }

    _nearestOnSeg(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return { x: a.x, y: a.y };
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return { x: a.x + t * dx, y: a.y + t * dy };
    }

    applySnap(p, excludeAnn) {
        const snap = this.findSnapPoint(p, excludeAnn);
        if (snap) { this._snapIndicator = snap; return { x: snap.x, y: snap.y }; }
        this._snapIndicator = null;
        return p;
    }

    drawSnapIndicator() {
        if (!this._snapIndicator) return;
        const s = this._snapIndicator;
        const sx = s.x * this.scale, sy = s.y * this.scale;
        this.ctx.save();
        if (s.type === 'endpoint' || s.type === 'center') {
            this.ctx.strokeStyle = '#22C55E';
            this.ctx.lineWidth = 2;
            this.ctx.fillStyle = 'rgba(34,197,94,0.2)';
            this.ctx.beginPath(); this.ctx.arc(sx, sy, 12, 0, Math.PI * 2); this.ctx.fill(); this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.moveTo(sx - 7, sy); this.ctx.lineTo(sx + 7, sy);
            this.ctx.moveTo(sx, sy - 7); this.ctx.lineTo(sx, sy + 7);
            this.ctx.stroke();
        } else {
            this.ctx.strokeStyle = '#F59E0B';
            this.ctx.lineWidth = 2;
            this.ctx.fillStyle = 'rgba(245,158,11,0.2)';
            this.ctx.beginPath();
            this.ctx.moveTo(sx, sy - 8); this.ctx.lineTo(sx + 8, sy);
            this.ctx.lineTo(sx, sy + 8); this.ctx.lineTo(sx - 8, sy);
            this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke();
        }
        this.ctx.restore();
    }

    // ----------------------------------------------------------
    // Hit testing
    // ----------------------------------------------------------
    findAt(p) {
        for (let i = this.annotations.length - 1; i >= 0; i--) {
            const a = this.annotations[i];
            if (a.points) {
                for (let j = 0; j < a.points.length - 1; j++)
                    if (this.distSeg(p, a.points[j], a.points[j + 1]) < 15) return a;
            } else if (a.point) {
                const tool = TOOLS[a.tool];
                const baseSize = a.customSize || (tool ? tool.size : 14) || 14;
                const sz = baseSize * (a.customSize ? 1 : this.sizeMultiplier);
                if (tool && (tool.symbol === '□' || tool.symbol === '▬' || tool.symbol === '▯')) {
                    const rot = a.rotation || 0;
                    const cos = Math.cos(-rot), sin = Math.sin(-rot);
                    const dx = p.x - a.point.x, dy = p.y - a.point.y;
                    const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
                    const halfW = (tool.symbol === '▬' ? sz * 0.7 : tool.symbol === '▯' ? sz * 0.35 : sz / 2) + 8;
                    const halfH = (tool.symbol === '▬' ? sz * 0.35 : tool.symbol === '▯' ? sz * 0.7 : sz / 2) + 8;
                    if (Math.abs(rx) <= halfW && Math.abs(ry) <= halfH) return a;
                } else if (tool && tool.type === 'text' && a.text) {
                    const ts = a.textScale || 1;
                    const sm = this.sizeMultiplier;
                    const fontSize = 14 * ts * sm;
                    const approxW = a.text.length * fontSize * 0.6 + 12 * ts * sm;
                    const approxH = 20 * ts * sm;
                    if (p.x >= a.point.x - 5 && p.x <= a.point.x + approxW + 5 &&
                        p.y >= a.point.y - approxH / 2 - 5 && p.y <= a.point.y + approxH / 2 + 5) return a;
                } else {
                    const hitRadius = Math.max(20, sz / 2 + 8);
                    if (Math.hypot(p.x - a.point.x, p.y - a.point.y) < hitRadius) return a;
                }
            }
        }
        return null;
    }

    findLabelAt(p) {
        for (let i = this.annotations.length - 1; i >= 0; i--) {
            const a = this.annotations[i];
            if (a._labelBounds) {
                const b = a._labelBounds;
                if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return a;
            }
        }
        return null;
    }

    findPointAt(p, ann) {
        if (!ann.points) return null;
        for (let i = 0; i < ann.points.length; i++)
            if (Math.hypot(p.x - ann.points[i].x, p.y - ann.points[i].y) < 22) return i;
        return null;
    }

    distSeg(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }

    // ----------------------------------------------------------
    // Resize / rotate handles
    // ----------------------------------------------------------
    getResizeHandles(a) {
        const tool = TOOLS[a.tool]; if (!tool || !a.point) return [];
        const baseSize = a.customSize || tool.size || 14;
        const sz = baseSize * (a.customSize ? 1 : this.sizeMultiplier);
        const x = a.point.x, y = a.point.y, half = sz / 2 + 4;
        return [
            { x: x - half, y: y - half }, { x: x + half, y: y - half },
            { x: x + half, y: y + half }, { x: x - half, y: y + half }
        ];
    }

    findResizeHandleAt(p, ann) {
        if (!ann || !ann.point) return null;
        const handles = this.getResizeHandles(ann);
        for (let i = 0; i < handles.length; i++)
            if (Math.hypot(p.x - handles[i].x, p.y - handles[i].y) < 12) return i;
        return null;
    }

    isRotatable(ann) {
        if (!ann || !ann.point) return false;
        const tool = TOOLS[ann.tool];
        return tool && (tool.symbol === '□' || tool.symbol === '▬' || tool.symbol === '▯');
    }

    getRotationHandle(a) {
        if (!a.point) return null;
        const tool = TOOLS[a.tool]; if (!tool) return null;
        const baseSize = a.customSize || tool.size || 14;
        const sz = baseSize * (a.customSize ? 1 : this.sizeMultiplier);
        const rot = a.rotation || 0;
        const dist = sz / 2 + 20;
        return {
            x: a.point.x + dist * Math.sin(rot),
            y: a.point.y + dist * Math.cos(rot)
        };
    }

    findRotationHandleAt(p, ann) {
        if (!this.isRotatable(ann)) return false;
        const h = this.getRotationHandle(ann);
        if (!h) return false;
        return Math.hypot(p.x - h.x, p.y - h.y) < 14;
    }

    // ----------------------------------------------------------
    // Undo / redo / delete
    // ----------------------------------------------------------
    saveState() {
        this.undoStack.push(JSON.stringify(this.annotations));
        this.redoStack = [];
        if (this.undoStack.length > 50) this.undoStack.shift();
    }

    undo() {
        if (!this.undoStack.length) return;
        this.redoStack.push(JSON.stringify(this.annotations));
        this.annotations = JSON.parse(this.undoStack.pop());
        this.selectedAnn = null;
        this.renderLayers(); this.render();
    }

    redo() {
        if (!this.redoStack.length) return;
        this.undoStack.push(JSON.stringify(this.annotations));
        this.annotations = JSON.parse(this.redoStack.pop());
        this.selectedAnn = null;
        this.renderLayers(); this.render();
    }

    deleteSelected() {
        if (!this.selectedAnn) return;
        this.saveState();
        this.annotations = this.annotations.filter(a => a.id !== this.selectedAnn.id);
        this.selectedAnn = null;
        this.renderLayers(); this.render();
    }

    resetAllAnnotations() {
        if (!this.annotations.length) return;
        if (!confirm('Alle Markierungen auf diesem Bild zurücksetzen?')) return;
        this.saveState();
        this.annotations = [];
        this.selectedAnn = null;
        this.renderLayers(); this.render(); this.renderToolbar();
        this.toast('Alle Markierungen zurückgesetzt', 'info');
    }

    duplicateSelected() {
        if (!this.selectedAnn) return;
        this.saveState();
        const clone = JSON.parse(JSON.stringify(this.selectedAnn));
        clone.id = 'a' + Date.now();
        const offset = 20;
        if (clone.point) { clone.point.x += offset; clone.point.y += offset; }
        else if (clone.points) clone.points = clone.points.map(pt => ({ x: pt.x + offset, y: pt.y + offset }));
        delete clone.labelOffset;
        this.annotations.push(clone);
        this.selectedAnn = clone;
        this.renderLayers(); this.render(); this.renderToolbar();
        this.toast('Element dupliziert', 'info');
    }

    // ----------------------------------------------------------
    // Geo length calculation (map snapshots only)
    // ----------------------------------------------------------
    calcLength(pts) {
        if (!this.photo.mapMetadata) return 0;
        const m = this.photo.mapMetadata, bb = m.boundingBox;
        let total = 0;
        for (let i = 0; i < pts.length - 1; i++) {
            const p1 = { lon: bb.west + pts[i].x     * (bb.east - bb.west) / m.pixelWidth, lat: bb.north - pts[i].y     * (bb.north - bb.south) / m.pixelHeight };
            const p2 = { lon: bb.west + pts[i+1].x   * (bb.east - bb.west) / m.pixelWidth, lat: bb.north - pts[i+1].y   * (bb.north - bb.south) / m.pixelHeight };
            const R = 6371000;
            const dLat = (p2.lat - p1.lat) * Math.PI / 180;
            const dLon = (p2.lon - p1.lon) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 + Math.cos(p1.lat*Math.PI/180) * Math.cos(p2.lat*Math.PI/180) * Math.sin(dLon/2)**2;
            total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }
        return total;
    }

    // ----------------------------------------------------------
    // Zoom
    // ----------------------------------------------------------
    zoomIn()    { this.scale = Math.min(this.scale * 1.25, 3);  this.applyZoom(); }
    zoomOut()   { this.scale = Math.max(this.scale * 0.8, 0.2); this.applyZoom(); }
    zoomReset() {
        const maxW = Math.max(200, window.innerWidth - 32);
        const maxH = Math.max(200, window.innerHeight - 250);
        this.scale = Math.min(maxW / this.image.width, maxH / this.image.height, 1);
        this.applyZoom();
    }
    applyZoom() {
        this.canvas.width  = this.image.width  * this.scale;
        this.canvas.height = this.image.height * this.scale;
        this.render();
    }

    // ----------------------------------------------------------
    // Text input overlay
    // ----------------------------------------------------------
    showTextInput(canvasPoint, callback, existingText) {
        this.closeTextInput();
        this._textInputActive = true;
        const overlay = document.createElement('div');
        overlay.className = 'text-input-overlay';
        overlay.id = 'textInputOverlay';
        const input = document.createElement('input');
        input.type = 'text'; input.value = existingText || ''; input.placeholder = 'Text eingeben...';
        const okBtn = document.createElement('button'); okBtn.className = 'text-ok'; okBtn.innerHTML = '✓';
        const cancelBtn = document.createElement('button'); cancelBtn.className = 'text-cancel'; cancelBtn.innerHTML = '✕';
        overlay.appendChild(input); overlay.appendChild(okBtn); overlay.appendChild(cancelBtn);

        const wrapper = this.canvas.parentElement;
        wrapper.appendChild(overlay);

        const canvasRect = this.canvas.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        overlay.style.left = (canvasRect.left - wrapperRect.left + wrapper.scrollLeft + canvasPoint.x * this.scale) + 'px';
        overlay.style.top  = (canvasRect.top  - wrapperRect.top  + wrapper.scrollTop  + canvasPoint.y * this.scale) + 'px';

        const finish = (val) => { this.closeTextInput(); callback(val); };
        okBtn.onclick     = (e) => { e.stopPropagation(); finish(input.value); };
        cancelBtn.onclick = (e) => { e.stopPropagation(); finish(null); };
        input.onkeydown   = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(input.value); } else if (e.key === 'Escape') finish(null); };
        overlay.onmousedown  = (e) => e.stopPropagation();
        overlay.ontouchstart = (e) => e.stopPropagation();
        setTimeout(() => { input.focus(); input.select(); }, 50);
    }

    closeTextInput() {
        this._textInputActive = false;
        const el = document.getElementById('textInputOverlay');
        if (el) el.remove();
    }

    // ----------------------------------------------------------
    // Flyout helper
    // ----------------------------------------------------------
    closeFlyout() {
        const existing = document.querySelector('.tool-flyout');
        if (existing) existing.remove();
    }

    showFlyout(btn, content, title) {
        this.closeFlyout();
        const flyout = document.createElement('div');
        flyout.className = 'tool-flyout';
        const rect = btn.getBoundingClientRect();
        flyout.style.top = Math.min(rect.top, window.innerHeight - 300) + 'px';
        if (title) {
            const titleEl = document.createElement('div');
            titleEl.className = 'tool-flyout-title';
            titleEl.textContent = title;
            flyout.appendChild(titleEl);
        }
        flyout.appendChild(content);
        document.body.appendChild(flyout);
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!flyout.contains(e.target) && !btn.contains(e.target)) {
                    flyout.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 10);
    }

    // ----------------------------------------------------------
    // Trasse meta helpers
    // ----------------------------------------------------------
    ensureTrasseMeta(ann) {
        if (!ann) return;
        ann.meta = ann.meta || {};
        if (!ann.meta.surface) ann.meta.surface = this.currentSurface;
        if (!ann.meta.dn)      ann.meta.dn      = this.currentDN;
    }

    updateTrasseProps() {
        const panel = document.getElementById('trasseProps');
        if (!panel) return;
        const ann = this.selectedAnn;
        const tool = ann && TOOLS[ann.tool];
        if (!ann || !tool || tool.id !== 'TRASSE') { panel.style.display = 'none'; return; }
        this.ensureTrasseMeta(ann);
        panel.style.display = 'block';
        const surfOptions = SURFACES.map(s => `<option value="${s.value}" ${ann.meta.surface === s.value ? 'selected' : ''}>${s.label}</option>`).join('');
        const dnOptions   = DNS.map(d => `<option value="${d.value}" ${ann.meta.dn === d.value ? 'selected' : ''}>${d.label}</option>`).join('');
        panel.innerHTML = `
            <h4><span>Trasse Eigenschaften</span>
            <button class="close-btn" onclick="document.getElementById('trasseProps').style.display='none'">✕</button></h4>
            <div class="row">
                <label>Oberfläche</label><select data-prop="surface">${surfOptions}</select>
                <label>DN</label><select data-prop="dn">${dnOptions}</select>
            </div>`;
        panel.querySelectorAll('select').forEach(sel => {
            sel.onchange = () => { ann.meta[sel.dataset.prop] = sel.value; this.render(); this.renderLayers(); };
        });
    }

    // ----------------------------------------------------------
    // Mini toolbar (context buttons above selected annotation)
    // ----------------------------------------------------------
    updateMiniToolbar() {
        let tb = document.getElementById('annMiniToolbar');
        if (!this.selectedAnn || this.selectedTool !== 'SELECT') {
            if (tb) tb.style.display = 'none';
            return;
        }
        if (!tb) {
            tb = document.createElement('div');
            tb.id = 'annMiniToolbar';
            tb.className = 'ann-mini-toolbar';
            this.canvas.parentElement.appendChild(tb);
        }
        const a = this.selectedAnn;
        const isText = a.text !== undefined;
        tb.innerHTML = `
            <button class="danger" title="Löschen" data-action="delete">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
            <button title="Duplizieren" data-action="duplicate">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
            ${isText ? '<button title="Text bearbeiten" data-action="edit"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' : ''}`;

        tb.querySelector('[data-action="delete"]').onclick  = (e) => { e.stopPropagation(); this.deleteSelected(); this.renderToolbar(); };
        tb.querySelector('[data-action="duplicate"]').onclick = (e) => { e.stopPropagation(); this.duplicateSelected(); };
        if (isText && tb.querySelector('[data-action="edit"]')) {
            tb.querySelector('[data-action="edit"]').onclick = (e) => {
                e.stopPropagation();
                this.showTextInput(a.point, (txt) => {
                    if (txt !== null && txt !== '') { this.saveState(); a.text = txt; this.renderLayers(); this.render(); }
                }, a.text);
            };
        }

        // Position above annotation
        const canvasRect  = this.canvas.getBoundingClientRect();
        const wrapperRect = this.canvas.parentElement.getBoundingClientRect();
        let ax, ay;
        if (a.point) { ax = a.point.x * this.scale; ay = a.point.y * this.scale; }
        else if (a.points && a.points.length > 0) {
            let minY = Infinity, midX = 0;
            a.points.forEach(pt => { if (pt.y < minY) { minY = pt.y; midX = pt.x; } });
            ax = midX * this.scale; ay = minY * this.scale;
        } else { tb.style.display = 'none'; return; }

        const canvasOffsetX = canvasRect.left - wrapperRect.left + this.canvas.parentElement.scrollLeft;
        const canvasOffsetY = canvasRect.top  - wrapperRect.top  + this.canvas.parentElement.scrollTop;
        tb.style.display = 'flex';
        tb.style.left    = (canvasOffsetX + ax) + 'px';
        tb.style.top     = (canvasOffsetY + ay - 12) + 'px';
    }

    // ----------------------------------------------------------
    // Render toolbar
    // ----------------------------------------------------------
    renderToolbar() {
        const tb = document.getElementById('editorToolbar');
        tb.innerHTML = '';

        const toolGroups = [
            { id: 'SELECT',        icon: '↖', name: 'Auswahl' },
            { id: 'LINES',         icon: '━', name: 'Linien',      children: ['TRASSE','BESTANDSTRASSE','KABEL','LF_KANAL','INSTALLATIONSROHR','PFEIL','MASSKETTE'] },
            { id: 'POINTS',        icon: '●', name: 'Punkte',      children: ['MUFFE','BOHRUNG_HAUSEINFUEHRUNG','BOHRUNG_WANDDURCHFUEHRUNG','BRANDSCHOTTUNG','HINDERNIS'] },
            { id: 'SCHACHT_GROUP', icon: '□', name: 'Schächte',    children: ['SCHACHT_AZK_NEU','SCHACHT_AZK_BESTAND','SCHACHT_DAZK_NEU','SCHACHT_DAZK_BESTAND','SCHACHT_APL_NEU','SCHACHT_APL_BESTAND'] },
            { id: 'TEXT_CALL_OUT', icon: 'T', name: 'Text' },
            { id: 'SETTINGS',      icon: '⚙', name: 'Einstellungen', isSettings: true }
        ];

        toolGroups.forEach(group => {
            const btn = document.createElement('button');
            const isActive = this.selectedTool === group.id || (group.children && group.children.includes(this.selectedTool));
            btn.className = 'tool-btn' + (isActive ? ' active' : '');

            if (group.children && group.children.includes(this.selectedTool)) {
                const activeTool = TOOLS[this.selectedTool];
                btn.innerHTML = activeTool?.color
                    ? `<span class="tool-color" style="background:${activeTool.color}"></span>`
                    : group.icon;
            } else {
                btn.innerHTML = group.icon;
            }

            btn.onclick = (e) => {
                e.stopPropagation();
                if (group.isSettings) {
                    this._showSettingsFlyout(btn);
                } else if (group.children) {
                    this._showGroupFlyout(btn, group);
                } else {
                    this.selectedTool = group.id;
                    this.selectedAnn = null;
                    this.closeFlyout();
                    this.renderToolbar(); this.render();
                }
            };
            tb.appendChild(btn);
        });

        // Separator
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:rgba(255,255,255,0.15);margin:4px 0;';
        tb.appendChild(sep);

        // Delete button (when something is selected)
        if (this.selectedAnn) {
            const del = document.createElement('button');
            del.className = 'tool-btn'; del.style.color = '#DC2626';
            del.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
            del.onclick = () => this.deleteSelected();
            tb.appendChild(del);
        }

        // Reset all button
        if (this.annotations.length > 0) {
            const resetBtn = document.createElement('button');
            resetBtn.className = 'tool-btn'; resetBtn.title = 'Alle zurücksetzen'; resetBtn.style.color = '#DC2626';
            resetBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M5 6v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg><span style="font-size:9px;display:block;line-height:1;margin-top:1px">Alle</span>';
            resetBtn.onclick = () => this.resetAllAnnotations();
            tb.appendChild(resetBtn);
        }

        this.updateTrasseProps();
    }

    _showSettingsFlyout(btn) {
        const content = document.createElement('div');
        content.className = 'toolbar-settings';
        content.innerHTML = `
            <div class="toolbar-setting-row">
                <label>Oberfläche</label>
                <select id="flyoutSurface">${SURFACES.map(s => `<option value="${s.value}" ${this.currentSurface === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
            </div>
            <div class="toolbar-setting-row">
                <label>DN</label>
                <select id="flyoutDN">${DNS.map(d => `<option value="${d.value}" ${this.currentDN === d.value ? 'selected' : ''}>${d.label}</option>`).join('')}</select>
            </div>
            <div class="toolbar-setting-row">
                <label>Größe: ${this.sizeMultiplier}x</label>
                <input type="range" id="flyoutSize" min="0.5" max="4" step="0.25" value="${this.sizeMultiplier}">
            </div>`;
        this.showFlyout(btn, content, 'Einstellungen');
        content.querySelector('#flyoutSurface').onchange = (e) => { this.currentSurface = e.target.value; };
        content.querySelector('#flyoutDN').onchange      = (e) => { this.currentDN = e.target.value; };
        content.querySelector('#flyoutSize').oninput     = (e) => {
            this.sizeMultiplier = parseFloat(e.target.value);
            e.target.previousElementSibling.textContent = `Größe: ${this.sizeMultiplier}x`;
            this.render();
        };
    }

    _showGroupFlyout(btn, group) {
        const content = document.createElement('div');
        group.children.forEach(toolId => {
            const tool = TOOLS[toolId]; if (!tool) return;
            const item = document.createElement('div');
            item.className = 'tool-flyout-item' + (this.selectedTool === toolId ? ' active' : '');
            item.innerHTML = tool.color
                ? `<span class="flyout-color" style="background:${tool.color}"></span><span>${tool.name}</span>`
                : `<span class="flyout-icon">${tool.icon || '•'}</span><span>${tool.name}</span>`;
            item.onclick = () => {
                this.selectedTool = toolId;
                this.selectedAnn  = null;
                this.closeFlyout();
                this.renderToolbar(); this.render();
            };
            content.appendChild(item);
        });
        this.showFlyout(btn, content, group.name);
    }

    // ----------------------------------------------------------
    // Legend & layers panels (sidebar)
    // ----------------------------------------------------------
    renderLegend() {
        const list = document.getElementById('legendList'); if (!list) return;
        list.innerHTML = '';
        Object.values(TOOLS).filter(t => t.type !== 'utility').forEach(t => {
            const item = document.createElement('div'); item.className = 'legend-item';
            let sym;
            if (t.type === 'line' || t.type === 'arrow' || t.type === 'dimension')
                sym = `<span style="width:20px;height:4px;background:${t.color};border-radius:2px"></span>`;
            else if (t.symbol === '▯') sym = `<span style="width:10px;height:18px;background:${t.color};border-radius:1px"></span>`;
            else if (t.symbol === '▬') sym = `<span style="width:18px;height:10px;background:${t.color};border-radius:1px"></span>`;
            else if (t.symbol === '□') sym = `<span style="width:14px;height:14px;background:${t.color};border-radius:2px"></span>`;
            else if (t.symbol === '◆') sym = `<span style="width:14px;height:14px;background:${t.color};transform:rotate(45deg);border-radius:2px"></span>`;
            else if (t.symbol === '○_empty') sym = `<span style="width:14px;height:14px;border:2px solid ${t.color};border-radius:50%;box-sizing:border-box"></span>`;
            else if (t.symbol === '⚠') sym = `<span style="color:${t.color};font-size:16px">⚠</span>`;
            else if (t.symbol === '🛡') sym = `<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:18px;background:${t.color};border-radius:2px 2px 8px 8px;color:#fff;font-size:9px;font-weight:bold">F</span>`;
            else sym = `<span style="color:${t.color}">${t.symbol || '●'}</span>`;
            item.innerHTML = `${sym}<span>${t.name}</span>`;
            list.appendChild(item);
        });
    }

    renderLayers() {
        const list = document.getElementById('layerList'); list.innerHTML = '';
        if (!this.annotations.length) { list.innerHTML = '<p class="text-muted" style="font-size:12px">Keine Elemente</p>'; return; }
        [...this.annotations].reverse().forEach(a => {
            const t = TOOLS[a.tool]; if (!t) return;
            const item = document.createElement('div');
            item.className = 'layer-item' + (a === this.selectedAnn ? ' selected' : '');
            let lbl = t.name;
            if (a.computed?.lengthMeters) lbl += ` (${a.computed.lengthMeters.toFixed(1)}m)`;
            if (a.text) lbl = a.text.substring(0, 20);
            const displaySymbol = t.symbol === '○_empty' ? '○' : (t.symbol || '━');
            item.innerHTML = `<span style="color:${t.color}">${displaySymbol}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;cursor:pointer">${lbl}</span><button style="width:22px;height:22px;border:none;background:transparent;color:var(--text-muted);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;border-radius:4px;flex-shrink:0" title="Löschen">✕</button>`;
            const selectItem = () => { this.selectedAnn = a; this.selectedTool = 'SELECT'; if (a.tool === 'TRASSE') this.ensureTrasseMeta(a); this.renderToolbar(); this.renderLayers(); this.render(); };
            item.querySelector('span:nth-child(1)').onclick = selectItem;
            item.querySelector('span:nth-child(2)').onclick = selectItem;
            item.querySelector('button').onclick = (e) => {
                e.stopPropagation();
                this.saveState();
                this.annotations = this.annotations.filter(x => x.id !== a.id);
                if (this.selectedAnn === a) this.selectedAnn = null;
                this.renderToolbar(); this.renderLayers(); this.render();
            };
            list.appendChild(item);
        });
    }

    // ----------------------------------------------------------
    // Main render loop
    // ----------------------------------------------------------
    render() {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);
        this.annotations.forEach(a => this.drawAnn(a, a === this.selectedAnn));

        // Preview line while drawing
        if (this.drawing && this.path.length > 0 && this.currentMousePos) {
            const tool = TOOLS[this.selectedTool];
            const target = this._snapIndicator || this.currentMousePos;
            this.ctx.save();
            this.ctx.strokeStyle = tool.color;
            this.ctx.lineWidth = (tool.lineWidth || 2) * this.scale;
            if (tool.dash) this.ctx.setLineDash(tool.dash.map(d => d * this.scale)); else this.ctx.setLineDash([]);
            this.ctx.lineCap = 'round'; this.ctx.lineJoin = 'round'; this.ctx.globalAlpha = 0.6;
            this.ctx.beginPath();
            this.ctx.moveTo(this.path[0].x * this.scale, this.path[0].y * this.scale);
            this.ctx.lineTo(target.x * this.scale, target.y * this.scale);
            this.ctx.stroke();
            // Start dot
            this.ctx.globalAlpha = 1; this.ctx.fillStyle = '#FFF'; this.ctx.strokeStyle = tool.color;
            this.ctx.lineWidth = 2; this.ctx.setLineDash([]);
            this.ctx.beginPath(); this.ctx.arc(this.path[0].x * this.scale, this.path[0].y * this.scale, 6, 0, Math.PI * 2);
            this.ctx.fill(); this.ctx.stroke();
            this.ctx.restore();
        }
        this.drawSnapIndicator();
        this.updateMiniToolbar();
    }

    // ----------------------------------------------------------
    // Draw individual annotation
    // ----------------------------------------------------------
    drawAnn(a, sel) {
        const tool = TOOLS[a.tool]; if (!tool) return;
        this.ctx.save();

        if ((tool.type === 'line') && a.points && a.points.length > 1) {
            this._drawLine(a, tool, sel);
        } else if (tool.type === 'point' && a.point) {
            this._drawPoint(a, tool, sel);
        } else if (tool.type === 'arrow' && a.points && a.points.length >= 2) {
            this._drawArrow(a, tool, sel);
        } else if (tool.type === 'dimension' && a.points && a.points.length >= 2) {
            this._drawDimension(a, tool, sel);
        } else if (tool.type === 'text' && a.point && a.text) {
            this._drawText(a, tool, sel);
        }

        this.ctx.restore();
    }

    _drawLine(a, tool, sel) {
        let lineColor = tool.color;
        if (a.tool === 'TRASSE' && a.meta?.surface) {
            const surf = SURFACES.find(s => s.value === a.meta.surface);
            if (surf?.color) lineColor = surf.color;
        }
        this.ctx.strokeStyle = lineColor;
        this.ctx.lineWidth = (tool.lineWidth + (sel ? 2 : 0)) * this.scale * this.sizeMultiplier;
        this.ctx.lineCap = 'round';
        if (tool.dash) this.ctx.setLineDash(tool.dash.map(d => d * this.scale)); else this.ctx.setLineDash([]);
        this.ctx.beginPath();
        this.ctx.moveTo(a.points[0].x * this.scale, a.points[0].y * this.scale);
        for (let i = 1; i < a.points.length; i++) this.ctx.lineTo(a.points[i].x * this.scale, a.points[i].y * this.scale);
        this.ctx.stroke();

        // Label for lines with computed length
        if (a.computed && a.computed.lengthMeters) {
            this._drawLineLabel(a, tool, lineColor, sel);
        }

        // Endpoint handles when selected
        if (sel) {
            a.points.forEach(p => {
                this.ctx.fillStyle = '#FFF'; this.ctx.strokeStyle = lineColor; this.ctx.lineWidth = 2; this.ctx.setLineDash([]);
                this.ctx.beginPath(); this.ctx.arc(p.x * this.scale, p.y * this.scale, 8, 0, Math.PI * 2);
                this.ctx.fill(); this.ctx.stroke();
            });
        }
    }

    _drawLineLabel(a, tool, lineColor, sel) {
        // Find midpoint
        let totalLen = 0; const segments = [];
        for (let i = 1; i < a.points.length; i++) {
            const dx = a.points[i].x - a.points[i-1].x, dy = a.points[i].y - a.points[i-1].y;
            const segLen = Math.sqrt(dx*dx + dy*dy);
            segments.push({ start: a.points[i-1], end: a.points[i], len: segLen });
            totalLen += segLen;
        }
        const halfLen = totalLen / 2;
        let accumulated = 0, mid = a.points[0], midSeg = null;
        for (const seg of segments) {
            if (accumulated + seg.len >= halfLen) {
                const ratio = (halfLen - accumulated) / seg.len;
                mid = { x: seg.start.x + (seg.end.x - seg.start.x) * ratio, y: seg.start.y + (seg.end.y - seg.start.y) * ratio };
                midSeg = seg; break;
            }
            accumulated += seg.len;
        }

        // Build label text
        let label = tool.name;
        if (a.tool === 'TRASSE' && a.meta) {
            const dn = a.meta.dn || 'DN50';
            const surfObj = SURFACES.find(s => s.value === (a.meta.surface || 'GEHWEGPLATTE'));
            label = `${dn} · ${surfObj ? surfObj.label : a.meta.surface}`;
        }
        label += ' · ' + a.computed.lengthMeters.toFixed(1) + ' m';

        const ls = a.labelScale || 1;
        const fontSize = 14 * this.scale * ls * this.sizeMultiplier;
        this.ctx.font = `bold ${fontSize}px 'Roboto', sans-serif`;
        const tw = this.ctx.measureText(label).width;

        // Label position (auto-offset based on line direction, or manual offset)
        let labelX = mid.x, labelY = mid.y;
        if (a.labelOffset) {
            labelX = mid.x + a.labelOffset.dx;
            labelY = mid.y + a.labelOffset.dy;
        } else if (midSeg) {
            const sdx = midSeg.end.x - midSeg.start.x, sdy = midSeg.end.y - midSeg.start.y;
            const angle = Math.abs(Math.atan2(sdy, sdx));
            const offsetDist = 25 * this.sizeMultiplier;
            if (angle > Math.PI * 0.35 && angle < Math.PI * 0.65) labelX = mid.x + offsetDist;
            else labelY = mid.y + offsetDist;
        }

        // Dotted connector line if label was moved
        const boxH = 22 * this.scale * ls * this.sizeMultiplier;
        const boxW = tw + 12 * ls * this.sizeMultiplier;
        if (a.labelOffset && (Math.abs(a.labelOffset.dx) > 2 || Math.abs(a.labelOffset.dy) > 2)) {
            this.ctx.save();
            this.ctx.strokeStyle = lineColor; this.ctx.lineWidth = 1; this.ctx.globalAlpha = 0.4;
            this.ctx.setLineDash([4 * this.scale, 3 * this.scale]);
            this.ctx.beginPath();
            this.ctx.moveTo(mid.x * this.scale, mid.y * this.scale);
            this.ctx.lineTo(labelX * this.scale, labelY * this.scale);
            this.ctx.stroke();
            this.ctx.restore();
        }

        // Label box
        const boxXpos = labelX * this.scale - tw / 2 - 6 * ls * this.sizeMultiplier;
        const boxYpos = labelY * this.scale - boxH / 2;
        this.ctx.fillStyle = 'rgba(255,255,255,0.92)'; this.ctx.strokeStyle = lineColor; this.ctx.lineWidth = 1.5;
        this.ctx.beginPath(); this.ctx.roundRect(boxXpos, boxYpos, boxW, boxH, 4 * this.scale); this.ctx.fill(); this.ctx.stroke();
        this.ctx.fillStyle = lineColor; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
        this.ctx.fillText(label, labelX * this.scale, labelY * this.scale);

        // Store label bounds for hit testing
        a._labelBounds = { x: labelX - (boxW / this.scale) / 2, y: labelY - (boxH / this.scale) / 2, w: boxW / this.scale, h: boxH / this.scale };

        // Resize handle when selected
        if (sel) {
            const hx = boxXpos + boxW, hy = boxYpos + boxH / 2;
            this.ctx.fillStyle = '#FFF'; this.ctx.strokeStyle = lineColor; this.ctx.lineWidth = 2;
            this.ctx.beginPath(); this.ctx.rect(hx - 4, hy - 4, 8, 8); this.ctx.fill(); this.ctx.stroke();
            a._labelResizeHandle = { x: (boxXpos + boxW) / this.scale, y: (boxYpos + boxH / 2) / this.scale, r: 18 };
        } else {
            a._labelResizeHandle = null;
        }
    }

    _drawPoint(a, tool, sel) {
        const x = a.point.x * this.scale, y = a.point.y * this.scale;
        const baseSize = a.customSize || tool.size || 14;
        const sz = (sel ? baseSize + 4 : baseSize) * this.scale * (a.customSize ? 1 : this.sizeMultiplier);
        const rot = a.rotation || 0;
        this.ctx.fillStyle = tool.color;
        this.ctx.strokeStyle = '#FFF';
        this.ctx.lineWidth = 3 * this.scale * this.sizeMultiplier;

        const needsRotation = (tool.symbol === '□' || tool.symbol === '▬' || tool.symbol === '▯') && rot !== 0;
        if (needsRotation) { this.ctx.save(); this.ctx.translate(x, y); this.ctx.rotate(rot); this.ctx.translate(-x, -y); }

        switch (tool.symbol) {
            case '○':
                this.ctx.beginPath(); this.ctx.arc(x, y, sz/2, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
                break;
            case '○_empty':
                this.ctx.beginPath(); this.ctx.arc(x, y, sz/2, 0, Math.PI*2);
                this.ctx.strokeStyle = tool.color; this.ctx.stroke();
                break;
            case '▯':
                this.ctx.fillRect(x - sz*0.35, y - sz*0.7, sz*0.7, sz*1.4);
                this.ctx.strokeRect(x - sz*0.35, y - sz*0.7, sz*0.7, sz*1.4);
                break;
            case '▬':
                this.ctx.fillRect(x - sz*0.7, y - sz*0.35, sz*1.4, sz*0.7);
                this.ctx.strokeRect(x - sz*0.7, y - sz*0.35, sz*1.4, sz*0.7);
                break;
            case '□':
                this.ctx.fillRect(x - sz/2, y - sz/2, sz, sz);
                this.ctx.strokeRect(x - sz/2, y - sz/2, sz, sz);
                break;
            case '◆':
                this.ctx.beginPath();
                this.ctx.moveTo(x, y - sz/2); this.ctx.lineTo(x + sz/2, y);
                this.ctx.lineTo(x, y + sz/2); this.ctx.lineTo(x - sz/2, y);
                this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke();
                break;
            case '⚠':
                this.ctx.beginPath();
                this.ctx.moveTo(x, y - sz/2); this.ctx.lineTo(x + sz/2, y + sz/2); this.ctx.lineTo(x - sz/2, y + sz/2);
                this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke();
                this.ctx.fillStyle = '#FFF';
                this.ctx.font = `bold ${sz*0.5}px sans-serif`; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
                this.ctx.fillText('!', x, y + sz*0.15);
                break;
            case '🛡':
                this.ctx.beginPath();
                this.ctx.moveTo(x - sz*0.4, y - sz*0.5); this.ctx.lineTo(x + sz*0.4, y - sz*0.5);
                this.ctx.lineTo(x + sz*0.4, y + sz*0.05);
                this.ctx.quadraticCurveTo(x + sz*0.4, y + sz*0.5, x, y + sz*0.5);
                this.ctx.quadraticCurveTo(x - sz*0.4, y + sz*0.5, x - sz*0.4, y + sz*0.05);
                this.ctx.closePath(); this.ctx.fill(); this.ctx.stroke();
                this.ctx.fillStyle = '#FFF';
                this.ctx.font = `bold ${sz*0.4}px sans-serif`; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
                this.ctx.fillText('F', x, y);
                break;
            default: // ⊕ and others
                this.ctx.beginPath(); this.ctx.arc(x, y, sz/2, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
                this.ctx.strokeStyle = '#FFF';
                this.ctx.beginPath();
                this.ctx.moveTo(x - sz/3, y); this.ctx.lineTo(x + sz/3, y);
                this.ctx.moveTo(x, y - sz/3); this.ctx.lineTo(x, y + sz/3);
                this.ctx.stroke();
        }

        if (needsRotation) this.ctx.restore();

        // Resize handles when selected
        if (sel) {
            this.getResizeHandles(a).forEach(h => {
                const hx = h.x * this.scale, hy = h.y * this.scale;
                this.ctx.fillStyle = '#FFF'; this.ctx.strokeStyle = tool.color; this.ctx.lineWidth = 2;
                this.ctx.beginPath(); this.ctx.rect(hx - 7, hy - 7, 14, 14); this.ctx.fill(); this.ctx.stroke();
            });
            // Rotation handle for rotatable shapes
            if (this.isRotatable(a)) {
                const rh = this.getRotationHandle(a);
                if (rh) {
                    const rhx = rh.x * this.scale, rhy = rh.y * this.scale;
                    this.ctx.save();
                    this.ctx.strokeStyle = tool.color; this.ctx.lineWidth = 1; this.ctx.globalAlpha = 0.5; this.ctx.setLineDash([3,3]);
                    this.ctx.beginPath(); this.ctx.moveTo(x, y); this.ctx.lineTo(rhx, rhy); this.ctx.stroke();
                    this.ctx.restore();
                    this.ctx.fillStyle = '#FFF'; this.ctx.strokeStyle = tool.color; this.ctx.lineWidth = 2;
                    this.ctx.beginPath(); this.ctx.arc(rhx, rhy, 7, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
                    this.ctx.fillStyle = tool.color;
                    this.ctx.font = 'bold 10px sans-serif'; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
                    this.ctx.fillText('↻', rhx, rhy);
                }
            }
        }
    }

    _drawArrow(a, tool, sel) {
        const p1 = a.points[0], p2 = a.points[a.points.length - 1];
        const x1 = p1.x * this.scale, y1 = p1.y * this.scale;
        const x2 = p2.x * this.scale, y2 = p2.y * this.scale;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = 20 * this.scale * this.sizeMultiplier;
        this.ctx.strokeStyle = tool.color; this.ctx.fillStyle = tool.color;
        this.ctx.lineWidth = (tool.lineWidth + (sel ? 2 : 0)) * this.scale * this.sizeMultiplier;
        this.ctx.lineCap = 'round';
        this.ctx.beginPath(); this.ctx.moveTo(x1, y1); this.ctx.lineTo(x2, y2); this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.moveTo(x2, y2);
        this.ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI/6), y2 - headLen * Math.sin(angle - Math.PI/6));
        this.ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI/6), y2 - headLen * Math.sin(angle + Math.PI/6));
        this.ctx.closePath(); this.ctx.fill();
        if (sel) {
            [p1, p2].forEach(p => {
                this.ctx.fillStyle = '#FFF'; this.ctx.strokeStyle = tool.color; this.ctx.lineWidth = 2;
                this.ctx.beginPath(); this.ctx.arc(p.x * this.scale, p.y * this.scale, 8, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
            });
        }
    }

    _drawDimension(a, tool, sel) {
        const p1 = a.points[0], p2 = a.points[a.points.length - 1];
        const x1 = p1.x * this.scale, y1 = p1.y * this.scale;
        const x2 = p2.x * this.scale, y2 = p2.y * this.scale;
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const perpAngle = angle + Math.PI / 2;
        const tickLen = 10 * this.scale * this.sizeMultiplier;
        this.ctx.strokeStyle = tool.color;
        this.ctx.lineWidth = (tool.lineWidth + (sel ? 1 : 0)) * this.scale * this.sizeMultiplier;
        this.ctx.lineCap = 'round';
        this.ctx.beginPath(); this.ctx.moveTo(x1, y1); this.ctx.lineTo(x2, y2); this.ctx.stroke();
        this.ctx.beginPath();
        this.ctx.moveTo(x1 + tickLen * Math.cos(perpAngle), y1 + tickLen * Math.sin(perpAngle));
        this.ctx.lineTo(x1 - tickLen * Math.cos(perpAngle), y1 - tickLen * Math.sin(perpAngle));
        this.ctx.moveTo(x2 + tickLen * Math.cos(perpAngle), y2 + tickLen * Math.sin(perpAngle));
        this.ctx.lineTo(x2 - tickLen * Math.cos(perpAngle), y2 - tickLen * Math.sin(perpAngle));
        this.ctx.stroke();
        const midX = (x1+x2)/2, midY = (y1+y2)/2, label = a.text || '? m';
        this.ctx.font = `bold ${12 * this.scale}px 'Roboto', sans-serif`;
        const tw = this.ctx.measureText(label).width;
        this.ctx.fillStyle = 'rgba(255,255,255,0.95)';
        this.ctx.fillRect(midX - tw/2 - 4, midY - 10*this.scale, tw + 8, 20*this.scale);
        this.ctx.fillStyle = tool.color; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
        this.ctx.fillText(label, midX, midY);
        if (sel) {
            [p1, p2].forEach(p => {
                this.ctx.fillStyle = '#FFF'; this.ctx.strokeStyle = tool.color; this.ctx.lineWidth = 2;
                this.ctx.beginPath(); this.ctx.arc(p.x * this.scale, p.y * this.scale, 8, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
            });
        }
    }

    _drawText(a, tool, sel) {
        const ts = a.textScale || 1;
        const x = a.point.x * this.scale, y = a.point.y * this.scale;
        const fontSize = 14 * this.scale * ts * this.sizeMultiplier;
        this.ctx.font = `${fontSize}px sans-serif`;
        const tw = this.ctx.measureText(a.text).width;
        const pad = 6 * this.scale * ts * this.sizeMultiplier;
        const bh  = 20 * this.scale * ts * this.sizeMultiplier;
        this.ctx.fillStyle = sel ? '#FEF3C7' : '#FFFBEB';
        this.ctx.strokeStyle = sel ? '#F59E0B' : '#FCD34D';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath(); this.ctx.roundRect(x, y - bh/2, tw + pad*2, bh, 4); this.ctx.fill(); this.ctx.stroke();
        this.ctx.fillStyle = '#1A1A2E'; this.ctx.textAlign = 'left'; this.ctx.textBaseline = 'middle';
        this.ctx.fillText(a.text, x + pad, y);
        if (sel) {
            const hx = x + tw + pad*2, hy = y, hr = 10;
            this.ctx.fillStyle = '#FFF'; this.ctx.strokeStyle = '#F59E0B'; this.ctx.lineWidth = 2;
            this.ctx.beginPath(); this.ctx.arc(hx, hy, hr, 0, Math.PI*2); this.ctx.fill(); this.ctx.stroke();
            a._textResizeHandle = { x: hx / this.scale, y: hy / this.scale, r: hr / this.scale + 12 };
        } else {
            a._textResizeHandle = null;
        }
    }

    // ----------------------------------------------------------
    // Render to image (for PDF export)
    // ----------------------------------------------------------
    async renderToImage() {
        const maxDim = 2000;
        const ratio = Math.min(maxDim / this.image.width, maxDim / this.image.height, 1);
        const c = document.createElement('canvas');
        c.width  = Math.round(this.image.width  * ratio);
        c.height = Math.round(this.image.height * ratio);
        const ctx = c.getContext('2d');
        ctx.drawImage(this.image, 0, 0, c.width, c.height);
        const os = this.scale, oc = this.ctx, om = this.sizeMultiplier;
        this.scale = ratio;
        this.sizeMultiplier = Math.max(om, 1 / ratio);
        this.ctx = ctx;
        this.annotations.forEach(a => this.drawAnn(a, false));
        this.scale = os; this.ctx = oc; this.sizeMultiplier = om;
        return c.toDataURL('image/jpeg', 0.9);
    }

    getAnnotations() { return this.annotations; }

    toast(msg, type) { if (window.app) window.app.toast(msg, type); }

    // ----------------------------------------------------------
    // Event handlers (mouse + touch)
    // setupEvents() is long but kept together intentionally —
    // splitting it would break the shared closure variables.
    // ----------------------------------------------------------
    setupEvents() {
        const getP = (e) => {
            const r = this.canvas.getBoundingClientRect();
            return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
        };

        let touchHandled = false;
        let touchHandledTimer = null;
        let lastPlacementTime = 0;
        const PLACEMENT_DEBOUNCE = 600;

        // Pinch/pan state
        let isPinching = false, isPanning = false;
        let pinchStartDist = 0, pinchStartScale = 1;
        let panStartX = 0, panStartY = 0, panScrollStartX = 0, panScrollStartY = 0;
        let isZoomDragging = false, zoomStartY = 0, zoomStartScale = 1;
        let lastTapTime = 0;

        // Schacht drag-to-size state
        let schachtDragStart = null, schachtDragCurrent = null;

        const pinchDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        const pinchCenter = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
        const isSchachtTool = () => {
            const tool = TOOLS[this.selectedTool];
            return tool && tool.type === 'point' && ['□', '▬', '▯'].includes(tool.symbol);
        };

        // ── Mouse events ──────────────────────────────────────
        this.canvas.onmousedown = (e) => {
            if (touchHandled || this._textInputActive) return;
            const p = getP(e), tool = TOOLS[this.selectedTool];

            if (this.selectedTool === 'SELECT') {
                this._handleSelectStart(p);
            } else if (tool && (tool.type === 'line' || tool.type === 'arrow' || tool.type === 'dimension')) {
                this.drawing = true;
                this.path = [this.applySnap(p, null)];
                this.saveState(); this.render();
            } else if (tool && tool.type === 'point') {
                const now = Date.now();
                if (now - lastPlacementTime < PLACEMENT_DEBOUNCE) return;
                lastPlacementTime = now;
                this.saveState();
                const ann = { id: 'a' + Date.now(), tool: this.selectedTool, point: p };
                this.annotations.push(ann);
                this.selectedAnn = ann; this.selectedTool = 'SELECT';
                this.renderToolbar(); this.renderLayers(); this.render();
            } else if (tool && tool.type === 'text') {
                this.showTextInput(p, (txt) => {
                    if (txt) {
                        this.saveState();
                        const ann = { id: 'a' + Date.now(), tool: this.selectedTool, point: p, text: txt };
                        this.annotations.push(ann);
                        this.selectedAnn = ann; this.selectedTool = 'SELECT';
                        this.renderToolbar(); this.renderLayers(); this.render();
                    }
                });
            }
        };

        this.canvas.onmousemove = (e) => {
            if (touchHandled) return;
            const p = getP(e);
            this.currentMousePos = p;
            if (this.drawing && this.path.length > 0) this.applySnap(p, null);
            else this._snapIndicator = null;
            this._handleDragMove(p);
            this.render();
        };

        this.canvas.onmouseup = (e) => {
            if (touchHandled) return;
            const p = getP(e);
            if (this._handleDragEnd(p)) return;
            this._finishLine(p);
        };

        this.canvas.ondblclick = (e) => {
            if (touchHandled) return;
            const p = getP(e);
            const labelAnn = this.findLabelAt(p);
            if (labelAnn && labelAnn.labelOffset) { this.saveState(); delete labelAnn.labelOffset; this.render(); return; }
            if (this.selectedTool === 'SELECT' && this.selectedAnn && this.selectedAnn.text !== undefined) {
                this.showTextInput(this.selectedAnn.point, (txt) => {
                    if (txt !== null) { this.saveState(); this.selectedAnn.text = txt; this.renderLayers(); this.render(); }
                }, this.selectedAnn.text);
            }
        };

        // ── Touch events ──────────────────────────────────────
        const handleTouchStart = (e) => {
            if (this._textInputActive) return;
            if (e.touches.length === 2) {
                e.preventDefault();
                isPinching = true; isPanning = true;
                pinchStartDist = pinchDist(e.touches); pinchStartScale = this.scale;
                const center = pinchCenter(e.touches);
                panStartX = center.x; panStartY = center.y;
                const wrapper = this.canvas.parentElement;
                panScrollStartX = wrapper.scrollLeft; panScrollStartY = wrapper.scrollTop;
                this.drawing = false; this.path = []; schachtDragStart = null; schachtDragCurrent = null;
                return;
            }
            const now = Date.now();
            const timeSinceLastTap = now - lastTapTime;
            if (timeSinceLastTap < 300 && e.touches.length === 1) {
                const t0 = e.touches[0], r0 = this.canvas.getBoundingClientRect();
                const p0 = { x: (t0.clientX - r0.left) / this.scale, y: (t0.clientY - r0.top) / this.scale };
                if (!(this.selectedTool === 'SELECT' && (this.findAt(p0) || this.findLabelAt(p0) || this.selectedAnn))) {
                    isZoomDragging = true; zoomStartY = e.touches[0].clientY; zoomStartScale = this.scale;
                    e.preventDefault(); return;
                }
            }
            lastTapTime = now;
            if (isZoomDragging || isPinching) return;
            touchHandled = true;
            clearTimeout(touchHandledTimer);
            touchHandledTimer = setTimeout(() => { touchHandled = false; }, 800);
            e.preventDefault();
            const t = e.touches[0], r = this.canvas.getBoundingClientRect();
            const p = { x: (t.clientX - r.left) / this.scale, y: (t.clientY - r.top) / this.scale };
            const tool = TOOLS[this.selectedTool];
            if (this.selectedTool === 'SELECT') {
                this._handleSelectStart(p);
            } else if (isSchachtTool()) {
                if (schachtDragStart) return;
                e.preventDefault(); this.saveState();
                schachtDragStart = p; schachtDragCurrent = p;
                this.render();
            } else if (tool && (tool.type === 'line' || tool.type === 'arrow' || tool.type === 'dimension')) {
                this.drawing = true; this.path = [this.applySnap(p, null)]; this.saveState(); this.render();
            } else if (tool && tool.type === 'point') {
                const now2 = Date.now();
                if (now2 - lastPlacementTime < PLACEMENT_DEBOUNCE) return;
                lastPlacementTime = now2;
                this.saveState();
                const ann = { id: 'a' + Date.now(), tool: this.selectedTool, point: p };
                this.annotations.push(ann);
                this.selectedAnn = ann; this.selectedTool = 'SELECT';
                this.renderToolbar(); this.renderLayers(); this.render();
            } else if (tool && tool.type === 'text') {
                this.showTextInput(p, (txt) => {
                    if (txt) {
                        this.saveState();
                        const ann = { id: 'a' + Date.now(), tool: this.selectedTool, point: p, text: txt };
                        this.annotations.push(ann);
                        this.selectedAnn = ann; this.selectedTool = 'SELECT';
                        this.renderToolbar(); this.renderLayers(); this.render();
                    }
                });
            }
        };

        const handleTouchMove = (e) => {
            if ((isPinching || isPanning) && e.touches.length === 2) {
                e.preventDefault();
                this.scale = Math.max(0.2, Math.min(5, pinchStartScale * pinchDist(e.touches) / pinchStartDist));
                this.applyZoom();
                const center = pinchCenter(e.touches), wrapper = this.canvas.parentElement;
                wrapper.scrollLeft = panScrollStartX + (panStartX - center.x);
                wrapper.scrollTop  = panScrollStartY + (panStartY - center.y);
                return;
            }
            if (isZoomDragging && e.touches.length === 1) {
                e.preventDefault();
                this.scale = Math.max(0.2, Math.min(5, zoomStartScale * (1 + (zoomStartY - e.touches[0].clientY) / 200)));
                this.applyZoom(); return;
            }
            e.preventDefault();
            const t = e.touches[0], r = this.canvas.getBoundingClientRect();
            const p = { x: (t.clientX - r.left) / this.scale, y: (t.clientY - r.top) / this.scale };
            this.currentMousePos = p;
            if (this.drawing && this.path.length > 0) this.applySnap(p, null);

            if (schachtDragStart && isSchachtTool()) {
                schachtDragCurrent = p; this.render();
                const tool = TOOLS[this.selectedTool];
                const x1 = Math.min(schachtDragStart.x, p.x) * this.scale;
                const y1 = Math.min(schachtDragStart.y, p.y) * this.scale;
                const w  = Math.abs(p.x - schachtDragStart.x) * this.scale;
                const h  = Math.abs(p.y - schachtDragStart.y) * this.scale;
                if (w > 2 || h > 2) {
                    this.ctx.fillStyle = tool.color + '66'; this.ctx.strokeStyle = tool.color;
                    this.ctx.lineWidth = 2 * this.scale; this.ctx.setLineDash([6, 4]);
                    this.ctx.fillRect(x1, y1, w, h); this.ctx.strokeRect(x1, y1, w, h);
                    this.ctx.setLineDash([]);
                }
                return;
            }
            this._handleDragMove(p); this.render();
        };

        const handleTouchEnd = (e) => {
            if (isPinching || isPanning) { if (e.touches.length < 2) { isPinching = false; isPanning = false; } return; }
            if (isZoomDragging) { isZoomDragging = false; return; }
            if (schachtDragStart && schachtDragCurrent && isSchachtTool()) {
                const now = Date.now();
                if (now - lastPlacementTime < PLACEMENT_DEBOUNCE) { schachtDragStart = null; schachtDragCurrent = null; return; }
                lastPlacementTime = now;
                const dx = Math.abs(schachtDragCurrent.x - schachtDragStart.x);
                const dy = Math.abs(schachtDragCurrent.y - schachtDragStart.y);
                const center = { x: (schachtDragStart.x + schachtDragCurrent.x) / 2, y: (schachtDragStart.y + schachtDragCurrent.y) / 2 };
                const customSize = (dx > 8 || dy > 8) ? Math.max(dx, dy) : null;
                const ann = { id: 'a' + Date.now(), tool: this.selectedTool, point: center };
                if (customSize) ann.customSize = customSize;
                this.annotations.push(ann);
                this.selectedAnn = ann; this.selectedTool = 'SELECT';
                schachtDragStart = null; schachtDragCurrent = null;
                this.renderToolbar(); this.renderLayers(); this.render(); return;
            }
            if (schachtDragStart) { schachtDragStart = null; schachtDragCurrent = null; }
            e.preventDefault();
            const lastP = this.currentMousePos;
            if (this._handleDragEnd(lastP)) return;
            if (this.drawing && this.path.length > 0 && lastP) this._finishLine(lastP);
        };

        this.canvas.addEventListener('touchstart',  handleTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove',   handleTouchMove,  { passive: false });
        this.canvas.addEventListener('touchend',    handleTouchEnd,   { passive: false });
        this.canvas.addEventListener('touchcancel', handleTouchEnd,   { passive: false });
    }

    // ----------------------------------------------------------
    // Shared drag helpers (used by both mouse and touch)
    // ----------------------------------------------------------
    _handleSelectStart(p) {
        // Rotation handle
        if (this.selectedAnn && this.isRotatable(this.selectedAnn) && this.findRotationHandleAt(p, this.selectedAnn)) {
            const angle = Math.atan2(p.y - this.selectedAnn.point.y, p.x - this.selectedAnn.point.x);
            this._rotating = { ann: this.selectedAnn, startAngle: angle, startRotation: this.selectedAnn.rotation || 0 };
            this.saveState(); return;
        }
        // Resize handle
        if (this.selectedAnn && this.selectedAnn.point) {
            const handleIdx = this.findResizeHandleAt(p, this.selectedAnn);
            if (handleIdx !== null) {
                const baseSize = this.selectedAnn.customSize || TOOLS[this.selectedAnn.tool]?.size || 14;
                this._resizing = { ann: this.selectedAnn, startDist: Math.hypot(p.x - this.selectedAnn.point.x, p.y - this.selectedAnn.point.y), startSize: baseSize };
                this.saveState(); return;
            }
        }
        // Text resize handle
        if (this.selectedAnn?._textResizeHandle) {
            const h = this.selectedAnn._textResizeHandle;
            if (Math.hypot(p.x - h.x, p.y - h.y) < h.r) {
                this._resizingText = { ann: this.selectedAnn, startX: p.x, startScale: this.selectedAnn.textScale || 1 };
                this.saveState(); return;
            }
        }
        // Label resize handle
        if (this.selectedAnn?._labelResizeHandle) {
            const h = this.selectedAnn._labelResizeHandle;
            if (Math.hypot(p.x - h.x, p.y - h.y) < h.r + 5) {
                this._resizingLabel = { ann: this.selectedAnn, startX: p.x, startScale: this.selectedAnn.labelScale || 1 };
                this.saveState(); return;
            }
        }
        // Individual point drag
        if (this.selectedAnn?.points) {
            const pointIdx = this.findPointAt(p, this.selectedAnn);
            if (pointIdx !== null) {
                this.dragPointIndex = pointIdx;
                this.selectedAnn._dragPoint = { ...p };
                this.saveState(); return;
            }
        }
        // Label drag
        const labelAnn = this.findLabelAt(p);
        if (labelAnn) {
            this.selectedAnn = labelAnn;
            if (labelAnn.tool === 'TRASSE') this.ensureTrasseMeta(labelAnn);
            this._draggingLabel = labelAnn; this._labelDragStart = { ...p };
            this.saveState(); this.dragPointIndex = null;
            this.renderLayers(); this.render(); this.updateTrasseProps(); return;
        }
        // Select annotation
        this.selectedAnn = this.findAt(p);
        if (this.selectedAnn?.tool === 'TRASSE') this.ensureTrasseMeta(this.selectedAnn);
        if (this.selectedAnn) this.selectedAnn._drag = { ...p };
        this.dragPointIndex = null; this._draggingLabel = null;
        this.renderLayers(); this.render(); this.updateTrasseProps();
    }

    _handleDragMove(p) {
        if (this._rotating) {
            const angle = Math.atan2(p.y - this._rotating.ann.point.y, p.x - this._rotating.ann.point.x);
            this._rotating.ann.rotation = this._rotating.startRotation + (angle - this._rotating.startAngle);
            return;
        }
        if (this._resizing) {
            const dist = Math.hypot(p.x - this._resizing.ann.point.x, p.y - this._resizing.ann.point.y);
            this._resizing.ann.customSize = Math.max(8, Math.min(200, this._resizing.startSize * dist / (this._resizing.startDist || 1)));
            return;
        }
        if (this._resizingLabel) {
            this._resizingLabel.ann.labelScale = Math.max(0.4, Math.min(5, this._resizingLabel.startScale + (p.x - this._resizingLabel.startX) / 80));
            return;
        }
        if (this._resizingText) {
            this._resizingText.ann.textScale = Math.max(0.3, Math.min(10, this._resizingText.startScale + (p.x - this._resizingText.startX) / 50));
            return;
        }
        if (this._draggingLabel && this._labelDragStart) {
            const a = this._draggingLabel;
            if (!a.labelOffset) a.labelOffset = { dx: 0, dy: 0 };
            a.labelOffset.dx += p.x - this._labelDragStart.x;
            a.labelOffset.dy += p.y - this._labelDragStart.y;
            this._labelDragStart = { ...p };
            return;
        }
        if (this.selectedTool === 'SELECT' && this.selectedAnn && this.dragPointIndex !== null && this.selectedAnn._dragPoint) {
            const snapped = this.applySnap(p, this.selectedAnn);
            this.selectedAnn.points[this.dragPointIndex].x = snapped.x;
            this.selectedAnn.points[this.dragPointIndex].y = snapped.y;
            if (this.photo.isMapSnapshot && this.photo.mapMetadata && this.selectedAnn.tool !== 'BESTANDSTRASSE')
                this.selectedAnn.computed = { lengthMeters: this.calcLength(this.selectedAnn.points) };
            return;
        }
        if (this.selectedAnn && this.selectedAnn._drag) {
            const dx = p.x - this.selectedAnn._drag.x, dy = p.y - this.selectedAnn._drag.y;
            if (this.selectedAnn.points) this.selectedAnn.points = this.selectedAnn.points.map(pt => ({ x: pt.x + dx, y: pt.y + dy }));
            else if (this.selectedAnn.point) { this.selectedAnn.point.x += dx; this.selectedAnn.point.y += dy; }
            this.selectedAnn._drag = { ...p };
        }
    }

    _handleDragEnd(p) {
        if (this._rotating)       { this._rotating = null;       this.renderLayers(); return true; }
        if (this._resizing)       { this._resizing = null;       this.renderLayers(); return true; }
        if (this._resizingLabel)  { this._resizingLabel = null;  this.renderLayers(); return true; }
        if (this._resizingText)   { this._resizingText = null;   this.renderLayers(); return true; }
        if (this._draggingLabel)  { this._draggingLabel = null; this._labelDragStart = null; this.renderLayers(); return true; }
        if (this.dragPointIndex !== null && this.selectedAnn?._dragPoint) {
            delete this.selectedAnn._dragPoint; this._snapIndicator = null;
            this.dragPointIndex = null; this.renderLayers(); return true;
        }
        if (this.selectedAnn?._drag) { delete this.selectedAnn._drag; this.saveState(); }
        return false;
    }

    _finishLine(p) {
        if (!this.drawing || !this.path.length) return;
        const tool = TOOLS[this.selectedTool];
        if (tool && (tool.type === 'line' || tool.type === 'arrow' || tool.type === 'dimension')) {
            this.path.push(this.applySnap(p, null));
            this._snapIndicator = null;
            const ann = { id: 'a' + Date.now(), tool: this.selectedTool, points: this.path };
            if (ann.tool === 'TRASSE') ann.meta = { surface: this.currentSurface, dn: this.currentDN };
            if (this.photo.isMapSnapshot && this.photo.mapMetadata && this.selectedTool !== 'BESTANDSTRASSE')
                ann.computed = { lengthMeters: this.calcLength(this.path) };
            if (tool.type === 'dimension') { const m = prompt('Maß eingeben (z.B. 2.5 m):'); ann.text = m || '? m'; }
            this.annotations.push(ann);
            this.renderLayers();
        }
        this.drawing = false; this.path = []; this.currentMousePos = null;
        this.render();
    }
}
