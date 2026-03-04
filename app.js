// ============================================================
// app.js – SiteSketch
// Main application: projects, photos, PDF export, map snapshots
// Depends on: constants.js, database.js, editor.js
// ============================================================

// ── Toast helper ─────────────────────────────────────────────
function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ── Spinner ───────────────────────────────────────────────────
function showSpinner(msg = '') {
    document.getElementById('spinnerMsg').textContent = msg;
    document.getElementById('spinner').style.display = 'flex';
}
function hideSpinner() { document.getElementById('spinner').style.display = 'none'; }

// ── Format helpers ────────────────────────────────────────────
function formatDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─────────────────────────────────────────────────────────────
// App class
// ─────────────────────────────────────────────────────────────
class App {
    constructor() {
        this.db           = new Database();
        this.editor       = new Editor();
        this.currentView  = 'projects';   // 'projects' | 'photos' | 'editor' | 'map'
        this.currentProject = null;
        this.currentPhoto   = null;
        this.mapInstance    = null;
        this.mapMarker      = null;
    }

    async init() {
        await this.db.init();
        this.bindGlobalEvents();
        await this.showProjects();
    }

    toast(msg, type) { showToast(msg, type); }

    // ----------------------------------------------------------
    // Navigation
    // ----------------------------------------------------------
    async showProjects() {
        this.currentView    = 'projects';
        this.currentProject = null;
        this.currentPhoto   = null;

        document.getElementById('viewProjects').style.display = 'block';
        document.getElementById('viewPhotos').style.display   = 'none';
        document.getElementById('viewEditor').style.display   = 'none';
        document.getElementById('navBack').style.display      = 'none';

        document.getElementById('appTitle').textContent = 'SiteSketch';
        await this.renderProjectList();
    }

    async showPhotos(project) {
        this.currentView    = 'photos';
        this.currentProject = project;

        document.getElementById('viewProjects').style.display = 'none';
        document.getElementById('viewPhotos').style.display   = 'block';
        document.getElementById('viewEditor').style.display   = 'none';
        document.getElementById('navBack').style.display      = 'inline-flex';

        document.getElementById('appTitle').textContent = project.name;
        document.getElementById('projectCustomer').textContent = project.customer || '';
        await this.renderPhotoGrid();
    }

    async showEditor(photo) {
        this.currentView  = 'editor';
        this.currentPhoto = photo;

        document.getElementById('viewProjects').style.display = 'none';
        document.getElementById('viewPhotos').style.display   = 'none';
        document.getElementById('viewEditor').style.display   = 'block';
        document.getElementById('navBack').style.display      = 'inline-flex';

        document.getElementById('appTitle').textContent = photo.name || 'Foto bearbeiten';

        const img = new Image();
        img.onload = () => {
            this.editor.init(photo, img);
        };
        img.src = photo.dataUrl;
    }

    // ----------------------------------------------------------
    // Project management
    // ----------------------------------------------------------
    async renderProjectList() {
        const projects = await this.db.getAll('projects');
        const list = document.getElementById('projectList');
        list.innerHTML = '';

        if (!projects.length) {
            list.innerHTML = '<div class="empty-state"><p>Keine Projekte vorhanden.</p><p>Tippen Sie auf + um ein neues Projekt zu erstellen.</p></div>';
            return;
        }

        projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        for (const p of projects) {
            const photos = await this.db.getByIndex('photos', 'projectId', p.id);
            const annotated = photos.filter(ph => ph.annotations && ph.annotations.length > 0).length;
            const card = document.createElement('div');
            card.className = 'project-card';
            card.innerHTML = `
                <div class="project-info" style="flex:1;cursor:pointer">
                    <div class="project-name">${this._esc(p.name)}</div>
                    <div class="project-meta">${this._esc(p.customer || '')} · ${photos.length} Fotos · ${annotated} bearbeitet · ${formatDate(p.updatedAt)}</div>
                </div>
                <div class="card-actions">
                    <button class="btn-icon" data-action="export" title="PDF Export">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                    </button>
                    <button class="btn-icon danger" data-action="delete" title="Löschen">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>`;
            card.querySelector('.project-info').onclick = () => this.showPhotos(p);
            card.querySelector('[data-action="export"]').onclick = (e) => { e.stopPropagation(); this.exportProjectPDF(p); };
            card.querySelector('[data-action="delete"]').onclick = (e) => { e.stopPropagation(); this.deleteProject(p); };
            list.appendChild(card);
        }
    }

    async createProject() {
        const name = prompt('Projektname:');
        if (!name?.trim()) return;
        const customer = prompt('Auftraggeber (optional):') || '';
        const project = { id: 'p' + Date.now(), name: name.trim(), customer: customer.trim(), createdAt: Date.now(), updatedAt: Date.now() };
        await this.db.put('projects', project);
        await this.renderProjectList();
        showToast('Projekt erstellt', 'success');
    }

    async deleteProject(project) {
        if (!confirm(`Projekt "${project.name}" und alle Fotos löschen?`)) return;
        const photos = await this.db.getByIndex('photos', 'projectId', project.id);
        for (const ph of photos) await this.db.delete('photos', ph.id);
        await this.db.delete('projects', project.id);
        await this.renderProjectList();
        showToast('Projekt gelöscht', 'info');
    }

    // ----------------------------------------------------------
    // Photo management
    // ----------------------------------------------------------
    async renderPhotoGrid() {
        const photos = await this.db.getByIndex('photos', 'projectId', this.currentProject.id);
        const grid = document.getElementById('photoGrid');
        grid.innerHTML = '';

        if (!photos.length) {
            grid.innerHTML = '<div class="empty-state"><p>Keine Fotos vorhanden.</p><p>Fügen Sie Fotos mit den Buttons unten hinzu.</p></div>';
            return;
        }

        photos.sort((a, b) => (a.order || 0) - (b.order || 0));
        photos.forEach((photo, idx) => {
            const card = document.createElement('div');
            card.className = 'photo-card';
            const hasAnnotations = photo.annotations && photo.annotations.length > 0;
            card.innerHTML = `
                <div class="photo-thumb" style="cursor:pointer">
                    <img src="${photo.dataUrl}" alt="${this._esc(photo.name)}">
                    ${hasAnnotations ? `<div class="ann-badge">${photo.annotations.length}</div>` : ''}
                    ${photo.isMapSnapshot ? '<div class="map-badge">🗺</div>' : ''}
                </div>
                <div class="photo-name">${this._esc(photo.name || `Foto ${idx + 1}`)}</div>
                <div class="photo-actions">
                    <button class="btn-icon btn-sm" data-action="rename" title="Umbenennen">✏️</button>
                    <button class="btn-icon btn-sm danger" data-action="delete" title="Löschen">✕</button>
                </div>`;
            card.querySelector('.photo-thumb').onclick = () => this.showEditor(photo);
            card.querySelector('[data-action="rename"]').onclick = async (e) => {
                e.stopPropagation();
                const newName = prompt('Neuer Name:', photo.name);
                if (newName?.trim()) { photo.name = newName.trim(); await this.db.put('photos', photo); await this.renderPhotoGrid(); }
            };
            card.querySelector('[data-action="delete"]').onclick = async (e) => {
                e.stopPropagation();
                if (!confirm('Foto löschen?')) return;
                await this.db.delete('photos', photo.id);
                await this.renderPhotoGrid();
                showToast('Foto gelöscht', 'info');
            };
            grid.appendChild(card);
        });
    }

    async addPhotos() {
        const input = document.createElement('input');
        input.type = 'file'; input.multiple = true; input.accept = 'image/*';
        input.onchange = async (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;
            showSpinner('Fotos werden importiert…');
            const existingPhotos = await this.db.getByIndex('photos', 'projectId', this.currentProject.id);
            let order = existingPhotos.length;
            for (const file of files) {
                const dataUrl = await this._readFileAsDataUrl(file);
                const photo = {
                    id: 'ph' + Date.now() + Math.random(),
                    projectId: this.currentProject.id,
                    name: file.name.replace(/\.[^.]+$/, ''),
                    dataUrl,
                    annotations: [],
                    order: order++,
                    createdAt: Date.now()
                };
                await this.db.put('photos', photo);
            }
            this.currentProject.updatedAt = Date.now();
            await this.db.put('projects', this.currentProject);
            hideSpinner();
            await this.renderPhotoGrid();
            showToast(`${files.length} Foto(s) hinzugefügt`, 'success');
        };
        input.click();
    }

    // ----------------------------------------------------------
    // Map snapshot
    // ----------------------------------------------------------
    async openMapView() {
        document.getElementById('viewPhotos').style.display   = 'none';
        document.getElementById('viewMapCapture').style.display = 'block';
        document.getElementById('appTitle').textContent = 'Kartenausschnitt';

        await this._nextFrame();
        const mapEl = document.getElementById('mapContainer');
        if (this.mapInstance) { this.mapInstance.invalidateSize(); return; }

        this.mapInstance = L.map('mapContainer').setView([48.137, 11.576], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(this.mapInstance);

        // Address search
        const searchEl = document.getElementById('mapSearch');
        if (searchEl) {
            searchEl.onkeydown = async (e) => {
                if (e.key === 'Enter') {
                    const q = searchEl.value.trim();
                    if (!q) return;
                    try {
                        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
                        const data = await res.json();
                        if (data.length) {
                            this.mapInstance.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 17);
                        } else {
                            showToast('Adresse nicht gefunden', 'error');
                        }
                    } catch { showToast('Suche fehlgeschlagen', 'error'); }
                }
            };
        }
    }

    closeMapView() {
        document.getElementById('viewMapCapture').style.display = 'none';
        document.getElementById('viewPhotos').style.display     = 'block';
        document.getElementById('appTitle').textContent = this.currentProject?.name || 'SiteSketch';
    }

    async captureMap() {
        showSpinner('Karte wird aufgenommen…');
        try {
            const map = this.mapInstance;
            const bounds = map.getBounds();
            const canvas = await html2canvas(document.getElementById('mapContainer'), { useCORS: true, allowTaint: true });
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const existingPhotos = await this.db.getByIndex('photos', 'projectId', this.currentProject.id);
            const mapMeta = {
                boundingBox: { north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() },
                pixelWidth:  canvas.width,
                pixelHeight: canvas.height,
                zoom: map.getZoom()
            };
            const photo = {
                id: 'ph' + Date.now(),
                projectId: this.currentProject.id,
                name: `Karte ${formatDate(Date.now())}`,
                dataUrl,
                annotations: [],
                isMapSnapshot: true,
                mapMetadata: mapMeta,
                order: existingPhotos.length,
                createdAt: Date.now()
            };
            await this.db.put('photos', photo);
            this.currentProject.updatedAt = Date.now();
            await this.db.put('projects', this.currentProject);
            hideSpinner();
            this.closeMapView();
            await this.renderPhotoGrid();
            showToast('Kartenausschnitt gespeichert', 'success');
        } catch (err) {
            hideSpinner();
            showToast('Fehler beim Aufnehmen: ' + err.message, 'error');
        }
    }

    // ----------------------------------------------------------
    // Save editor annotations back to DB
    // ----------------------------------------------------------
    async saveCurrentPhoto() {
        if (!this.currentPhoto) return;
        this.currentPhoto.annotations = this.editor.getAnnotations();
        this.currentPhoto.sizeMultiplier = this.editor.sizeMultiplier;
        await this.db.put('photos', this.currentPhoto);
        if (this.currentProject) {
            this.currentProject.updatedAt = Date.now();
            await this.db.put('projects', this.currentProject);
        }
        showToast('Gespeichert', 'success');
    }

    // ----------------------------------------------------------
    // Quantity summary
    // ----------------------------------------------------------
    async showQuantities() {
        if (!this.currentProject) return;
        const photos = await this.db.getByIndex('photos', 'projectId', this.currentProject.id);
        const totals = {};

        for (const photo of photos) {
            for (const ann of (photo.annotations || [])) {
                const tool = TOOLS[ann.tool]; if (!tool || !tool.unit) continue;
                const key = ann.tool;
                if (!totals[key]) totals[key] = { name: tool.name, unit: tool.unit, value: 0, color: tool.color };
                if (tool.type === 'line' && ann.computed?.lengthMeters) {
                    totals[key].value += ann.computed.lengthMeters;
                } else if (tool.type === 'point') {
                    totals[key].value += 1;
                }
            }
        }

        // Group TRASSE by surface + DN
        const trasseTotals = {};
        for (const photo of photos) {
            for (const ann of (photo.annotations || [])) {
                if (ann.tool !== 'TRASSE' || !ann.computed?.lengthMeters) continue;
                const surf = (ann.meta?.surface || 'UNBEFESTIGT');
                const dn   = (ann.meta?.dn || 'DN50');
                const key  = `${dn}|${surf}`;
                if (!trasseTotals[key]) {
                    const surfObj = SURFACES.find(s => s.value === surf);
                    trasseTotals[key] = { dn, surface: surfObj?.label || surf, value: 0 };
                }
                trasseTotals[key].value += ann.computed.lengthMeters;
            }
        }

        // Build modal
        let html = '<div class="qty-table">';
        const trasse = totals['TRASSE'];
        if (trasse || Object.keys(trasseTotals).length) {
            html += `<div class="qty-section-title" style="color:#FF0000">Trasse</div>`;
            if (Object.keys(trasseTotals).length) {
                Object.values(trasseTotals).forEach(t => {
                    html += `<div class="qty-row"><span>${t.dn} · ${t.surface}</span><span>${t.value.toFixed(1)} m</span></div>`;
                });
            } else if (trasse) {
                html += `<div class="qty-row"><span>Gesamt</span><span>${trasse.value.toFixed(1)} m</span></div>`;
            }
            delete totals['TRASSE'];
        }
        Object.values(totals).forEach(t => {
            if (t.value === 0) return;
            const valStr = t.unit === 'm' ? t.value.toFixed(1) + ' m' : Math.round(t.value) + ' ' + t.unit;
            html += `<div class="qty-row" style="color:${t.color}"><span>${t.name}</span><span>${valStr}</span></div>`;
        });
        html += '</div>';

        if (!Object.keys(totals).length && !Object.keys(trasseTotals).length) {
            html = '<p class="text-muted" style="text-align:center;padding:24px">Keine Mengen vorhanden.<br>Zeichnen Sie Trassen und Punkte auf Ihren Fotos.</p>';
        }

        this._showModal('Mengenermittlung – ' + this.currentProject.name, html);
    }

    // ----------------------------------------------------------
    // PDF Export
    // ----------------------------------------------------------
    async exportProjectPDF(project) {
        if (!project) project = this.currentProject;
        if (!project) return;

        showSpinner('PDF wird erstellt…');
        try {
            const photos = await this.db.getByIndex('photos', 'projectId', project.id);
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
            const pW = 210, pH = 297, margin = 15;
            let pageNum = 1;

            const addHeader = (title) => {
                doc.setFillColor(26, 26, 46);
                doc.rect(0, 0, pW, 18, 'F');
                doc.setTextColor(255, 255, 255);
                doc.setFontSize(11); doc.setFont('helvetica', 'bold');
                doc.text('SiteSketch', margin, 12);
                doc.setFontSize(9); doc.setFont('helvetica', 'normal');
                doc.text(title, pW / 2, 12, { align: 'center' });
                doc.text(formatDate(Date.now()), pW - margin, 12, { align: 'right' });
                doc.setTextColor(0, 0, 0);
            };

            const addFooter = () => {
                doc.setFontSize(8); doc.setTextColor(150, 150, 150);
                doc.text(`Seite ${pageNum}`, pW / 2, pH - 8, { align: 'center' });
                doc.setTextColor(0, 0, 0);
                pageNum++;
            };

            // Title page
            addHeader(project.name);
            doc.setFontSize(22); doc.setFont('helvetica', 'bold');
            doc.text(project.name, pW / 2, 80, { align: 'center' });
            if (project.customer) {
                doc.setFontSize(14); doc.setFont('helvetica', 'normal');
                doc.text(project.customer, pW / 2, 95, { align: 'center' });
            }
            doc.setFontSize(11);
            doc.text(`${photos.length} Fotos`, pW / 2, 115, { align: 'center' });
            doc.text(`Erstellt: ${formatDate(Date.now())}`, pW / 2, 125, { align: 'center' });
            addFooter();

            // Photo pages
            for (const photo of photos.sort((a, b) => (a.order || 0) - (b.order || 0))) {
                doc.addPage();
                addHeader(photo.name || 'Foto');

                // Render annotated image
                const imgDataUrl = photo.annotations?.length > 0
                    ? await this._renderPhotoWithAnnotations(photo)
                    : photo.dataUrl;

                const maxImgW = pW - margin * 2;
                const maxImgH = pH - 60;
                const tmpImg = new Image();
                await new Promise(r => { tmpImg.onload = r; tmpImg.src = imgDataUrl; });
                const ratio = Math.min(maxImgW / tmpImg.width, maxImgH / tmpImg.height);
                const imgW = tmpImg.width * ratio, imgH = tmpImg.height * ratio;
                const imgX = (pW - imgW) / 2;

                doc.addImage(imgDataUrl, 'JPEG', imgX, 22, imgW, imgH);

                // Photo name below image
                doc.setFontSize(10); doc.setFont('helvetica', 'bold');
                doc.text(photo.name || '', pW / 2, 22 + imgH + 6, { align: 'center' });

                // Annotation summary if present
                if (photo.annotations?.length) {
                    const lineSummary = this._buildAnnotationSummary(photo);
                    if (lineSummary) {
                        doc.setFontSize(8); doc.setFont('helvetica', 'normal');
                        doc.text(lineSummary, margin, 22 + imgH + 13);
                    }
                }
                addFooter();
            }

            // Quantities page
            const qtySummary = await this._buildQuantitySummaryForPDF(project);
            if (qtySummary.length) {
                doc.addPage();
                addHeader('Mengenermittlung');
                doc.setFontSize(16); doc.setFont('helvetica', 'bold');
                doc.text('Mengenermittlung', margin, 35);
                let y = 50;
                doc.setFontSize(10); doc.setFont('helvetica', 'normal');
                for (const row of qtySummary) {
                    const r = parseInt(row.color?.slice(1, 3) || '0', 16);
                    const g = parseInt(row.color?.slice(3, 5) || '0', 16);
                    const b = parseInt(row.color?.slice(5, 7) || '0', 16);
                    doc.setTextColor(r, g, b);
                    doc.text(row.label, margin, y);
                    doc.setTextColor(0, 0, 0);
                    doc.text(row.value, pW - margin, y, { align: 'right' });
                    y += 8;
                    if (y > pH - 30) { addFooter(); doc.addPage(); addHeader('Mengenermittlung (Forts.)'); y = 35; }
                }
                addFooter();
            }

            doc.save(`SiteSketch_${project.name.replace(/[^a-z0-9]/gi, '_')}.pdf`);
            hideSpinner();
            showToast('PDF erstellt', 'success');
        } catch (err) {
            hideSpinner();
            showToast('PDF-Fehler: ' + err.message, 'error');
            console.error(err);
        }
    }

    async _renderPhotoWithAnnotations(photo) {
        // Use a temporary Editor instance to render the photo without showing it
        const tmpCanvas = document.createElement('canvas');
        const img = await new Promise((resolve) => {
            const i = new Image(); i.onload = () => resolve(i); i.src = photo.dataUrl;
        });
        const maxDim = 1800;
        const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
        tmpCanvas.width  = Math.round(img.width  * ratio);
        tmpCanvas.height = Math.round(img.height * ratio);
        const ctx = tmpCanvas.getContext('2d');
        ctx.drawImage(img, 0, 0, tmpCanvas.width, tmpCanvas.height);

        // Draw annotations using Editor drawing methods
        const tmpEditor = new Editor();
        tmpEditor.scale          = ratio;
        tmpEditor.sizeMultiplier = Math.max(photo.sizeMultiplier || 1, 1 / ratio);
        tmpEditor.ctx            = ctx;
        tmpEditor.canvas         = tmpCanvas;
        tmpEditor.image          = img;
        tmpEditor.photo          = photo;
        tmpEditor.annotations    = photo.annotations || [];
        tmpEditor.annotations.forEach(a => tmpEditor.drawAnn(a, false));

        return tmpCanvas.toDataURL('image/jpeg', 0.9);
    }

    _buildAnnotationSummary(photo) {
        const parts = [];
        const counts = {};
        for (const ann of photo.annotations) {
            const tool = TOOLS[ann.tool]; if (!tool) continue;
            const key = tool.name;
            if (!counts[key]) counts[key] = { count: 0, length: 0, unit: tool.unit };
            counts[key].count++;
            if (ann.computed?.lengthMeters) counts[key].length += ann.computed.lengthMeters;
        }
        Object.entries(counts).forEach(([name, v]) => {
            if (v.unit === 'm' && v.length > 0) parts.push(`${name}: ${v.length.toFixed(1)} m`);
            else if (v.unit === 'Stk') parts.push(`${name}: ${v.count} Stk`);
        });
        return parts.join(' | ');
    }

    async _buildQuantitySummaryForPDF(project) {
        const photos = await this.db.getByIndex('photos', 'projectId', project.id);
        const rows = [];
        const totals = {};
        const trasseTotals = {};

        for (const photo of photos) {
            for (const ann of (photo.annotations || [])) {
                const tool = TOOLS[ann.tool]; if (!tool) continue;
                if (ann.tool === 'TRASSE' && ann.computed?.lengthMeters) {
                    const k = `${ann.meta?.dn || 'DN50'}|${ann.meta?.surface || 'UNBEFESTIGT'}`;
                    if (!trasseTotals[k]) {
                        const surfObj = SURFACES.find(s => s.value === (ann.meta?.surface || 'UNBEFESTIGT'));
                        trasseTotals[k] = { label: `Trasse · ${ann.meta?.dn || 'DN50'} · ${surfObj?.label || ''}`, value: 0, color: '#FF0000' };
                    }
                    trasseTotals[k].value += ann.computed.lengthMeters;
                } else if (tool.unit) {
                    if (!totals[ann.tool]) totals[ann.tool] = { label: tool.name, unit: tool.unit, value: 0, color: tool.color };
                    if (tool.type === 'line' && ann.computed?.lengthMeters) totals[ann.tool].value += ann.computed.lengthMeters;
                    else if (tool.type === 'point') totals[ann.tool].value += 1;
                }
            }
        }

        Object.values(trasseTotals).forEach(t => { if (t.value > 0) rows.push({ label: t.label, value: t.value.toFixed(1) + ' m', color: t.color }); });
        Object.values(totals).forEach(t => {
            if (t.value === 0) return;
            const val = t.unit === 'm' ? t.value.toFixed(1) + ' m' : Math.round(t.value) + ' ' + t.unit;
            rows.push({ label: t.label, value: val, color: t.color });
        });
        return rows;
    }

    // ----------------------------------------------------------
    // Excel export
    // ----------------------------------------------------------
    async exportExcel() {
        if (!this.currentProject) return;
        showSpinner('Excel wird erstellt…');
        try {
            const photos = await this.db.getByIndex('photos', 'projectId', this.currentProject.id);
            const rows = [['Foto', 'Element', 'DN', 'Oberfläche', 'Menge', 'Einheit']];

            for (const photo of photos) {
                for (const ann of (photo.annotations || [])) {
                    const tool = TOOLS[ann.tool]; if (!tool || !tool.unit) continue;
                    let qty = 0, unit = tool.unit;
                    if (tool.type === 'line' && ann.computed?.lengthMeters) qty = parseFloat(ann.computed.lengthMeters.toFixed(2));
                    else if (tool.type === 'point') qty = 1;
                    if (!qty) continue;
                    const dn   = ann.meta?.dn || '';
                    const surf = ann.meta?.surface ? (SURFACES.find(s => s.value === ann.meta.surface)?.label || ann.meta.surface) : '';
                    rows.push([photo.name || '', tool.name, dn, surf, qty, unit]);
                }
            }

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws['!cols'] = [{wch:30},{wch:20},{wch:10},{wch:20},{wch:10},{wch:10}];
            XLSX.utils.book_append_sheet(wb, ws, 'Mengenermittlung');
            XLSX.writeFile(wb, `SiteSketch_${this.currentProject.name.replace(/[^a-z0-9]/gi,'_')}.xlsx`);
            hideSpinner();
            showToast('Excel erstellt', 'success');
        } catch (err) {
            hideSpinner();
            showToast('Excel-Fehler: ' + err.message, 'error');
        }
    }

    // ----------------------------------------------------------
    // UI helpers
    // ----------------------------------------------------------
    _showModal(title, bodyHtml) {
        let modal = document.getElementById('genericModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'genericModal';
            modal.className = 'modal-overlay';
            modal.innerHTML = '<div class="modal-box"><div class="modal-header"><h3 id="modalTitle"></h3><button id="modalClose" class="btn-icon">✕</button></div><div id="modalBody"></div></div>';
            document.body.appendChild(modal);
            modal.querySelector('#modalClose').onclick = () => modal.style.display = 'none';
            modal.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
        }
        modal.querySelector('#modalTitle').textContent = title;
        modal.querySelector('#modalBody').innerHTML = bodyHtml;
        modal.style.display = 'flex';
    }

    bindGlobalEvents() {
        document.getElementById('navBack').addEventListener('click', () => {
            if (this.currentView === 'editor') {
                this.saveCurrentPhoto().then(() => this.showPhotos(this.currentProject));
            } else if (this.currentView === 'photos') {
                this.showProjects();
            }
        });

        // Keyboard shortcuts in editor
        document.addEventListener('keydown', (e) => {
            if (this.currentView !== 'editor') return;
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'z') { e.preventDefault(); this.editor.undo(); }
                if (e.key === 'y') { e.preventDefault(); this.editor.redo(); }
                if (e.key === 's') { e.preventDefault(); this.saveCurrentPhoto(); }
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (document.activeElement.tagName === 'INPUT') return;
                this.editor.deleteSelected();
            }
        });
    }

    _readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    _esc(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    _nextFrame() { return new Promise(r => requestAnimationFrame(r)); }
}

// ── Bootstrap ──────────────────────────────────────────────────
window.app = new App();
window.addEventListener('DOMContentLoaded', () => window.app.init());
