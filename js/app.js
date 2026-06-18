/**
 * App Controller — 主控制器
 *
 * 职责：
 * - DOM 事件绑定
 * - 流程编排（选类型 → 拖入 → 预览 → 上传 → 轮询）
 * - Toast 通知
 */

const App = {

    /** 当前选择的文件类型 */
    selectedType: null,

    /** 当前拖入的文件列表 */
    pendingFiles: [],

    // ── Init ──────────────────────────────────────

    init() {
        this._bindTypeButtons();
        this._bindDropZone();
        this._bindPreviewActions();
        this._bindApiConfig();
        this._checkBackendHealth();
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
            this._reset();
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

            this.showSuccess(
                `上传完成：${result.succeeded} 成功 / ${result.failed} 失败`
            );

            // Reset after 3s
            setTimeout(() => this._reset(), 3000);

        } catch (err) {
            this.showError(`上传失败: ${err.message}`);
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = '✅ 确认上传';
        }
    },

    // ── Reset ───────────────────────────────────

    _reset() {
        this.pendingFiles = [];
        document.getElementById('file-input').value = '';
        document.getElementById('preview-tbody').innerHTML = '';
        document.getElementById('upload-results').innerHTML = '';
        document.getElementById('step-preview').classList.add('hidden');
        document.getElementById('step-progress').classList.add('hidden');
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
