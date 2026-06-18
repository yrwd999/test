/**
 * App Controller — 主控制器
 *
 * 职责：
 * - DOM 事件绑定
 * - 流程编排（选类型 → 拖入 → 预览 → 上传 → 轮询）
 * - 上传结果持久化展示
 * - KB 同步触发
 * - KB 文档列表（按项目分组，参考 kb-dashboard 设计）
 * - Toast 通知
 */

const App = {

    /** 当前选择的文件类型 */
    selectedType: null,

    /** 当前拖入的文件列表 */
    pendingFiles: [],

    /** 本次上传成功的 file_id 列表（用于 KB 同步） */
    _uploadedFileIds: [],

    /** KB 文档原始数据 */
    _allDocs: [],

    // ── Init ──────────────────────────────────────

    init() {
        this._bindTypeButtons();
        this._bindDropZone();
        this._bindPreviewActions();
        this._bindProgressActions();
        this._bindApiConfig();
        this._bindKBFilters();
        this._checkBackendHealth();
        this._loadKBDocuments();
    },

    // ── Health Check ─────────────────────────────

    async _checkBackendHealth() {
        try {
            await ApiClient.health();
            this.showInfo('后端服务已连接');
        } catch (err) {
            this.showError(`后端连接失败: ${API_BASE_URL}`);
        }
    },

    // ── Step 1: File Type ───────────────────────

    _bindTypeButtons() {
        document.querySelectorAll('.type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.selectedType = btn.dataset.type;

                // Show upload step
                document.getElementById('step-upload').classList.remove('hidden');
            });
        });
    },

    // ── Step 2: Drop Zone ───────────────────────

    _bindDropZone() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');

        // Click to browse
        dropZone.addEventListener('click', () => fileInput.click());

        // File selected
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) this._handleFiles(e.target.files);
        });

        // Drag events
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            if (e.dataTransfer.files.length > 0) this._handleFiles(e.dataTransfer.files);
        });
    },

    async _handleFiles(fileList) {
        const files = Array.from(fileList);

        // Validate count
        if (files.length > 20) {
            this.showError(`最多上传 20 个文件，当前 ${files.length} 个`);
            return;
        }

        // Validate extensions
        const validExts = ['.pdf', '.docx', '.doc', '.xlsx', '.xls'];
        const invalid = files.filter(f => !validExts.some(ext => f.name.toLowerCase().endsWith(ext)));
        if (invalid.length > 0) {
            this.showError(`不支持的文件格式: ${invalid.map(f => f.name).join(', ')}`);
            return;
        }

        // Validate sizes
        const tooLarge = files.filter(f => f.size > 10 * 1024 * 1024);
        if (tooLarge.length > 0) {
            this.showError(`文件超过 10MB: ${tooLarge.map(f => f.name).join(', ')}`);
            return;
        }

        this.pendingFiles = files;

        // Request rename preview
        this.showInfo(`正在预览 ${files.length} 个文件的重命名结果...`);
        const result = await RenameModule.preview(this.selectedType, files);

        if (result) {
            RenameModule.renderTable(result);

            if (RenameModule.hasErrors(result)) {
                this.showInfo('部分文件无法识别项目编号，已禁用上传');
                // 禁用确认按钮
                const confirmBtn = document.getElementById('confirm-upload');
                confirmBtn.disabled = true;
                confirmBtn.classList.add('btn-disabled');
            } else {
                // 所有文件正常，确保按钮可用
                const confirmBtn = document.getElementById('confirm-upload');
                confirmBtn.disabled = false;
                confirmBtn.classList.remove('btn-disabled');
            }

            document.getElementById('step-preview').classList.remove('hidden');
        }
    },

    // ── Step 3: Confirm Upload ──────────────────

    _bindPreviewActions() {
        document.getElementById('confirm-upload').addEventListener('click', async () => {
            await this._doUpload();
        });

        document.getElementById('cancel-upload').addEventListener('click', () => {
            this._resetUpload();
        });
    },

    async _doUpload() {
        const confirmBtn = document.getElementById('confirm-upload');
        confirmBtn.disabled = true;
        confirmBtn.textContent = '⏳ 上传中...';

        try {
            const result = await UploadModule.uploadBatch(
                this.pendingFiles,
                this.selectedType,
            );

            // Show progress section
            document.getElementById('step-progress').classList.remove('hidden');
            UploadModule.renderResults(result);

            // Collect successful file IDs for sync
            this._uploadedFileIds = result.results
                .filter(r => r.file_id)
                .map(r => r.file_id);

            // Show action buttons (sync + new upload)
            const actions = document.getElementById('upload-actions');
            actions.classList.remove('hidden');

            const syncBtn = document.getElementById('btn-sync-kb');
            if (this._uploadedFileIds.length > 0) {
                syncBtn.classList.remove('hidden');
                syncBtn.disabled = false;
                syncBtn.textContent = `🔄 同步到知识库 (${this._uploadedFileIds.length} 个文件)`;
            } else {
                syncBtn.classList.add('hidden');
            }

            this.showSuccess(
                `上传完成：${result.succeeded} 成功 / ${result.failed} 失败`
            );

        } catch (err) {
            this.showError(`上传失败: ${err.message}`);
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = '✅ 确认上传';
        }
    },

    // ── Step 4: Progress Actions ────────────────

    _bindProgressActions() {
        // Sync to KB
        document.getElementById('btn-sync-kb').addEventListener('click', async () => {
            await this._doSyncToKB();
        });

        // New upload (reset)
        document.getElementById('btn-new-upload').addEventListener('click', () => {
            this._resetUpload();
        });
    },

    async _doSyncToKB() {
        const syncBtn = document.getElementById('btn-sync-kb');
        syncBtn.disabled = true;
        syncBtn.textContent = '⏳ 同步中...';

        try {
            const result = await UploadModule.syncToKB(this._uploadedFileIds);

            // 后端返回 { job_id, status, synced_count, error }
            const synced = result.synced_count !== undefined ? result.synced_count : '?';
            const status = result.status || 'UNKNOWN';
            this.showSuccess(`KB 同步完成：${synced} 个文件，状态：${status}`);
            syncBtn.textContent = `✅ 已同步 (${synced} 个文件)`;

            // 更新上传结果中的状态标签为「已同步」
            if (status === 'SUCCESS') {
                document.querySelectorAll('#upload-results .parse-status').forEach(el => {
                    el.textContent = '✅ 已同步';
                    el.className = 'parse-status status-ok';
                });
            }

            // Refresh KB documents after sync
            setTimeout(() => this._loadKBDocuments(), 1000);
        } catch (err) {
            this.showError(`KB 同步失败: ${err.message}`);
            syncBtn.disabled = false;
            syncBtn.textContent = `🔄 同步到知识库 (${this._uploadedFileIds.length} 个文件)`;
        }
    },

    // ── KB Documents List (dashboard-style) ───────

    async _loadKBDocuments() {
        const container = document.getElementById('kb-docs-container');
        container.innerHTML = '<div class="kb-loading"><div class="loading-spinner"></div>加载中...</div>';

        try {
            const result = await ApiClient.listKBDocuments();
            this._allDocs = result.documents || [];
            this._initKBFilterOptions();
            this._renderKBStats();
            this._renderKBProjects();
        } catch (err) {
            container.innerHTML = `<div class="kb-empty">⚠️ 加载失败: ${this._esc(err.message)}</div>`;
        }
    },

    _initKBFilterOptions() {
        const docs = this._allDocs;
        const years = [...new Set(docs.map(d => d.year))].sort();
        const types = [...new Set(docs.map(d => d.document_type).filter(Boolean))].sort();

        const yearSel = document.getElementById('kb-filter-year');
        const typeSel = document.getElementById('kb-filter-type');

        // 保留当前选中值
        const curY = yearSel.value;
        const curT = typeSel.value;

        yearSel.innerHTML = '<option value="">全部</option>';
        typeSel.innerHTML = '<option value="">全部</option>';

        years.forEach(y => { const o = document.createElement('option'); o.value = y; o.textContent = y + ' 年'; yearSel.appendChild(o); });
        types.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t.toUpperCase(); typeSel.appendChild(o); });

        yearSel.value = curY;
        typeSel.value = curT;
    },

    _renderKBStats() {
        const docs = this._allDocs;
        const projects = new Set(docs.map(d => d.project));
        const types = new Set(docs.map(d => d.document_type).filter(Boolean));
        const totalSize = docs.reduce((s, d) => s + (d.size || 0), 0);

        const statsEl = document.getElementById('kb-stats');
        if (!statsEl) return;

        statsEl.innerHTML = `
            <div class="kb-stat-card">
                <div class="kb-stat-icon">📄</div>
                <div class="kb-stat-value">${docs.length}</div>
                <div class="kb-stat-label">文档总数</div>
            </div>
            <div class="kb-stat-card">
                <div class="kb-stat-icon">📁</div>
                <div class="kb-stat-value">${projects.size}</div>
                <div class="kb-stat-label">项目数</div>
            </div>
            <div class="kb-stat-card">
                <div class="kb-stat-icon">🏷️</div>
                <div class="kb-stat-value">${types.size}</div>
                <div class="kb-stat-label">文件类型</div>
            </div>
            <div class="kb-stat-card">
                <div class="kb-stat-icon">💾</div>
                <div class="kb-stat-value">${this._fmtSize(totalSize)}</div>
                <div class="kb-stat-label">总数据量</div>
            </div>
        `;
    },

    _renderKBProjects() {
        const container = document.getElementById('kb-docs-container');
        const yearFilter = document.getElementById('kb-filter-year')?.value || '';
        const typeFilter = document.getElementById('kb-filter-type')?.value || '';
        const search = (document.getElementById('kb-filter-search')?.value || '').toLowerCase();

        let docs = this._allDocs;

        // Apply filters
        if (yearFilter) docs = docs.filter(d => d.year === yearFilter);
        if (typeFilter) docs = docs.filter(d => d.document_type === typeFilter);
        if (search) docs = docs.filter(d =>
            d.project.toLowerCase().includes(search) ||
            d.name.toLowerCase().includes(search)
        );

        // Group by project
        const projectMap = {};
        docs.forEach(d => {
            if (!projectMap[d.project]) {
                projectMap[d.project] = { docs: [], types: new Set(), totalSize: 0 };
            }
            projectMap[d.project].docs.push(d);
            projectMap[d.project].types.add(d.document_type);
            projectMap[d.project].totalSize += d.size || 0;
        });

        const projects = Object.entries(projectMap)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([code, data]) => ({
                code,
                docs: data.docs,
                types: Array.from(data.types),
                totalSize: data.totalSize,
            }));

        // Update count
        const countEl = document.getElementById('kb-filter-count');
        if (countEl) countEl.textContent = `${projects.length} 个项目`;

        if (projects.length === 0) {
            container.innerHTML = '<div class="kb-empty"><div class="kb-empty-icon">📭</div><p>没有匹配的文档</p></div>';
            return;
        }

        container.innerHTML = projects.map(p => {
            const typeTags = p.types.filter(Boolean).map(t =>
                `<span class="kb-type-tag ${t}">${t.toUpperCase()}</span>`
            ).join('');

            const docRows = p.docs.map(d => `
                <tr>
                    <td><span class="kb-doc-type"><span class="kb-doc-dot ${d.document_type}"></span>${this._esc(d.name)}</span></td>
                    <td>${d.document_type ? d.document_type.toUpperCase() : '—'}</td>
                    <td>${this._esc(d.category || '—')}</td>
                    <td style="text-align:right">${this._fmtSize(d.size)}</td>
                </tr>
            `).join('');

            const yearPart = p.code !== 'UNKNOWN' ? p.code.slice(5, 9) : '????';
            const numPart = p.code !== 'UNKNOWN' ? p.code.slice(10) : '?';

            return `
            <div class="kb-project-row" data-project="${this._esc(p.code)}">
                <div class="kb-project-header" onclick="this.parentElement.classList.toggle('open')">
                    <span class="kb-chevron">▶</span>
                    <span class="kb-project-code"><span class="kb-year">${yearPart}</span>${numPart}</span>
                    <span class="kb-project-count">${p.docs.length} 文档</span>
                    <span class="kb-project-tags">${typeTags}</span>
                    <span class="kb-project-size">${this._fmtSize(p.totalSize)}</span>
                </div>
                <div class="kb-project-details">
                    <table class="kb-doc-table">
                        <thead><tr><th>文件名</th><th>类型</th><th>类别</th><th style="text-align:right">大小</th></tr></thead>
                        <tbody>${docRows}</tbody>
                    </table>
                </div>
            </div>`;
        }).join('');
    },

    // ── KB Filters ───────────────────────────────

    _bindKBFilters() {
        const yearSel = document.getElementById('kb-filter-year');
        const typeSel = document.getElementById('kb-filter-type');
        const searchInput = document.getElementById('kb-filter-search');
        const refreshBtn = document.getElementById('btn-refresh-kb');

        const debounce = (fn, ms) => {
            let timer;
            return (...args) => {
                clearTimeout(timer);
                timer = setTimeout(() => fn(...args), ms);
            };
        };

        if (yearSel) yearSel.addEventListener('change', () => this._renderKBProjects());
        if (typeSel) typeSel.addEventListener('change', () => this._renderKBProjects());
        if (searchInput) searchInput.addEventListener('input', debounce(() => this._renderKBProjects(), 300));
        if (refreshBtn) refreshBtn.addEventListener('click', () => this._loadKBDocuments());
    },

    // ── Reset Upload ─────────────────────────────

    _resetUpload() {
        this.pendingFiles = [];
        this._uploadedFileIds = [];
        document.getElementById('file-input').value = '';
        document.getElementById('preview-tbody').innerHTML = '';
        document.getElementById('upload-results').innerHTML = '';
        document.getElementById('step-preview').classList.add('hidden');
        document.getElementById('step-progress').classList.add('hidden');
        document.getElementById('upload-actions').classList.add('hidden');
    },

    // ── Utils ───────────────────────────────────

    _fmtSize(bytes) {
        if (!bytes) return '—';
        if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return bytes + ' B';
    },

    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // ── API Config ──────────────────────────────

    _bindApiConfig() {
        const input = document.getElementById('api-url-input');
        const saveBtn = document.getElementById('save-api-url');

        // Load current value
        const current = localStorage.getItem('api_base_url');
        if (current) input.value = current;

        saveBtn.addEventListener('click', () => {
            const val = input.value.trim();
            if (val) {
                localStorage.setItem('api_base_url', val);
                this.showInfo('API 地址已保存，刷新页面生效');
            } else {
                localStorage.removeItem('api_base_url');
                this.showInfo('已清除自定义 API 地址');
            }
        });
    },

    // ── Toast ───────────────────────────────────

    showSuccess(msg) { this._toast(msg, 'success'); },
    showError(msg) { this._toast(msg, 'error'); },
    showInfo(msg) { this._toast(msg, 'info'); },

    _toast(msg, type) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = msg;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },
};

// ── Boot ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());