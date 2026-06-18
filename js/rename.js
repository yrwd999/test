/**
 * Rename Module — 重命名预览逻辑
 *
 * 职责：
 * - 调用后端 /api/rename/preview 获取预览结果
 * - 渲染预览表格
 */

const RenameModule = {

    /**
     * 请求重命名预览
     * @param {string} fileType - 文件类型
     * @param {File[]} files - 文件列表
     * @returns {Promise<Object>} 预览结果
     */
    async preview(fileType, files) {
        const filenames = files.map(f => f.name);

        try {
            const result = await ApiClient.renamePreview(fileType, filenames);
            return result;
        } catch (err) {
            if (err instanceof ApiError) {
                App.showError(`重命名预览失败: ${err.body?.message || err.message}`);
            } else {
                App.showError(`重命名预览请求失败: ${err.message}`);
            }
            return null;
        }
    },

    /**
     * 渲染预览表格
     * @param {Object} result - 后端返回的预览结果
     */
    renderTable(result) {
        const tbody = document.getElementById('preview-tbody');
        tbody.innerHTML = '';

        result.results.forEach(item => {
            const tr = document.createElement('tr');

            const statusClass = item.status === 'ok' ? 'status-ok' : 'status-error';
            const statusText = item.status === 'ok' ? '✅ 正常' : `❌ ${item.error || '错误'}`;

            tr.innerHTML = `
                <td title="${item.original_name}">${this._truncate(item.original_name, 40)}</td>
                <td>${item.project_code || '—'}</td>
                <td>${item.aunv_name || '<span class="text-muted">无法重命名</span>'}</td>
                <td><span class="${statusClass}">${statusText}</span></td>
            `;

            tbody.appendChild(tr);
        });
    },

    /**
     * 检查是否有错误项
     */
    hasErrors(result) {
        return result.results.some(item => item.status === 'error');
    },

    /**
     * 截断长文本
     */
    _truncate(text, maxLen) {
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen) + '...';
    },
};
