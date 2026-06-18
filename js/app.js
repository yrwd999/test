/**
 * App Controller — 主控制器
 *
 * 职责：
 * - DOM 事件绑定
 * - 流程编排（选类型 → 拖入 → 预览 → 上传 → 轮询）
 * - 上传结果持久化展示
 * - KB 同步触发
 * - KB 文件列表加载与筛选
 * - Toast 通知
 */

const App = {

    /** 当前选择的文件类型 */
    selectedType: null,

    /** 当前拖入的文件列表 */
    pendingFiles: [],

    /** 本次上传成功的 file_id 列表（用于 KB 同步） */
    _uploadedFileIds: [],

    /** 当前文件列表数据（用于前端筛选） */
    _allFiles: [],

    // ── Init ──────────────────────────────────────

    init() {
        this._bindTypeButtons();
        this._bindDropZone();
        this._bindPreviewActions();
        this._bindProgressActions();
        this._bindApiConfig();
        this._bindFileListFilters();
        this._checkBackendHealth();
        this._loadKBFileList();
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
                this.showInfo('部分文件无法识别项目编号，请检查后移除');
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
            const synced = result.synced || result.succeeded || '?';
            const failed = result.failed || 0;
            this.showSuccess(`KB 同步完成：${synced} 成功 / ${failed} 失败`);
            syncBtn.textContent = `✅ 已同步 (${synced} 个文件)`;

            // Refresh file list after sync
            setTimeout(() => this._loadKBFileList(), 1000);
        } catch (err) {
            this.showError(`KB 同步失败: ${err.message}`);
            syncBtn.disabled = false;
            syncBtn.textContent = `🔄 同步到知识库 (${this._uploadedFileIds.length} 个文件)`;
        }
    },

    // ── KB File List ─────────────────────────────

    async _loadKBFileList() {
        const container = document.getElementById('file-list-container');
        container.innerHTML = '<p class="loading-hint">加载中...</p>';

        try {
            const result = await ApiClient.listFiles('', 200);
            this._allFiles = result.files || [];
            this._renderFileList();
        } catch (err) {
            container.innerHTML = `<p class="loading-hint">加载失败: ${err.message}</p>`;
        }
    },

    _renderFileList() {
        const container = document.getElementById('file-list-container');
        const projectFilter = (document.getElementById('filter-project-code').value || '').trim().toUpperCase();
        const statusFilter = document.getElementById('filter-status').value;

        let files = this._allFiles;

        // Apply filters
        if (projectFilter) {
            files = files.filter(f => {
                const name = (f.file_name || '').toUpperCase();
                return name.includes(projectFilter);
            });
        }
        if (statusFilter) {
            files = files.filter(f => {
                const s = (f.status || '').toUpperCase();
                return s === statusFilter || s.includes(statusFilter);
            });
        }

        if (files.length === 0) {
            container.innerHTML = '<p class="loading-hint">暂无文件</p>';
            return;
        }

        const summary = document.createElement('p');
        summary.className = 'file-list-summary';
        summary.textContent = `共 ${files.length} 个文件`;
        container.innerHTML = '';
        container.appendChild(summary);

        files.forEach(f => {
            const item = document.createElement('div');
            item.className = 'file-list-item';

            const statusClass = this._getStatusClass(f.status);
            const timeStr = f.create_time ? new Date(f.create_time).toLocaleString('zh-CN') : '—';

            item.innerHTML = `
                <span class="file-icon">📄</span>
                <div class="file-info">
                    <div class="file-name" title="${this._esc(f.file_name)}">${this._esc(f.file_name)}</div>
                    <div class="file-meta">${timeStr} · ${this._esc(f.category_id || '—')}</div>
                </div>
                <span class="${statusClass}">${this._esc(f.status)}</span>
            `;

            container.appendChild(item);
        });
    },

    _getStatusClass(status) {
        const s = (status || '').toUpperCase();
        if (s === 'SUCCESS' || s.includes('SUCCESS')) return 'status-ok';
        if (s === 'FAILED' || s.includes('FAILED')) return 'status-error';
        return 'status-uploading';
    },

    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // ── File List Filters ────────────────────────

    _bindFileListFilters() {
        const filterInput = document.getElementById('filter-project-code');
        const filterSelect = document.getElementById('filter-status');
        const refreshBtn = document.getElementById('btn-refresh-files');

        const debounce = (fn, ms) => {
            let timer;
            return (...args) => {
                clearTimeout(timer);
                timer = setTimeout(() => fn(...args), ms);
            };
        };

        filterInput.addEventListener('input', debounce(() => this._renderFileList(), 300));
        filterSelect.addEventListener('change', () => this._renderFileList());
        refreshBtn.addEventListener('click', () => this._loadKBFileList());
    },

    // ── Reset Upload (not full reset — keeps file list) ─────

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