/**
 * Upload Module — 文件上传 + 状态轮询
 *
 * 职责：
 * - 批量上传文件到后端
 * - 轮询解析状态直到完成
 */

const UploadModule = {

    /** 待轮询的 file_id 集合 */
    _pollingIds: new Map(), // file_id → {name, startTime}

    /**
     * 批量上传文件
     * @param {File[]} files - 文件列表
     * @param {string} fileType - 文件类型
     * @param {Function} onProgress - 进度回调
     */
    async uploadBatch(files, fileType, onProgress) {
        try {
            const result = await ApiClient.uploadBatch(files, fileType);

            // 启动状态轮询
            result.results
                .filter(r => r.file_id)
                .forEach(r => {
                    this.startPolling(r.file_id, r.aunv_name || r.original_name);
                });

            return result;
        } catch (err) {
            if (err instanceof ApiError) {
                throw new Error(err.body?.message || err.message);
            }
            throw err;
        }
    },

    /**
     * 轮询文件解析状态
     */
    startPolling(fileId, displayName) {
        this._pollingIds.set(fileId, { name: displayName, startTime: Date.now() });

        const poll = async () => {
            const MAX_POLLS = 60; // 60次 × 5s = 300s
            const INTERVAL = 5000;
            let count = 0;

            while (count < MAX_POLLS) {
                try {
                    const status = await ApiClient.getStatus(fileId);

                    if (status.status === 'SUCCESS') {
                        this._updateStatus(fileId, '✅ 解析完成', 'success');
                        this._pollingIds.delete(fileId);
                        return;
                    }

                    if (status.status === 'FAILED') {
                        this._updateStatus(fileId, '❌ 解析失败', 'error');
                        this._pollingIds.delete(fileId);
                        return;
                    }

                    count++;
                    await this._sleep(INTERVAL);
                } catch (err) {
                    count++;
                    await this._sleep(INTERVAL);
                }
            }

            // 超时
            this._updateStatus(fileId, '⏰ 解析超时', 'warning');
            this._pollingIds.delete(fileId);
        };

        poll();
    },

    /**
     * 更新上传结果中的状态
     */
    _updateStatus(fileId, text, type) {
        const statusEl = document.querySelector(
            `[data-file-id="${fileId}"] .parse-status`
        );
        if (statusEl) {
            statusEl.textContent = text;
            statusEl.className = `parse-status status-${type === 'success' ? 'ok' : type === 'error' ? 'error' : 'uploading'}`;
        }
    },

    /**
     * 渲染上传结果
     */
    renderResults(result) {
        const container = document.getElementById('upload-results');
        container.innerHTML = '';

        result.results.forEach(item => {
            const div = document.createElement('div');
            const isSuccess = item.file_id;

            div.className = `upload-result-item ${isSuccess ? 'success' : 'failed'}`;
            div.dataset.fileId = item.file_id || '';

            div.innerHTML = `
                <div class="result-icon">${isSuccess ? '✅' : '❌'}</div>
                <div class="result-info">
                    <div class="result-name">${item.aunv_name || item.original_name}</div>
                    <div class="result-detail">
                        ${item.original_name}
                        ${item.file_id ? ` · ${this._formatSize(item.size_bytes)}` : ''}
                        ${item.error ? ` · ${item.error}` : ''}
                    </div>
                </div>
                ${isSuccess ? '<div class="parse-status status-uploading">⏳ 解析中...</div>' : ''}
            `;

            container.appendChild(div);
        });
    },

    /**
     * 格式化文件大小
     */
    _formatSize(bytes) {
        if (!bytes) return '';
        const kb = bytes / 1024;
        if (kb < 1024) return `${kb.toFixed(0)}KB`;
        return `${(kb / 1024).toFixed(1)}MB`;
    },

    /**
     * sleep
     */
    _sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    },
};
