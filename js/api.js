/**
 * API Client — fetch 封装
 *
 * 负责：
 * - Base URL 管理（开发/测试/生产可切换）
 * - 错误处理（统一 ApiError）
 * - 请求/响应日志
 */

// ── Base URL ─────────────────────────────────────
function getApiBaseUrl() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('api')) return params.get('api');
    if (localStorage.getItem('api_base_url')) return localStorage.getItem('api_base_url');
    // 默认：本地开发
    return window.location.protocol === 'https:'
        ? 'https://web-upload-backend-xxx.fcapp.run'
        : 'http://localhost:9000';
}

const API_BASE_URL = getApiBaseUrl();

// ── Custom Error ─────────────────────────────────
class ApiError extends Error {
    constructor(status, body) {
        super(body?.message || body?.detail || `API error ${status}`);
        this.status = status;
        this.body = body;
    }
}

// ── Core fetch wrapper ───────────────────────────
async function apiFetch(path, options = {}) {
    const url = `${API_BASE_URL}${path}`;

    const defaultHeaders = {};
    // Don't set Content-Type for FormData — browser sets boundary
    if (!(options.body instanceof FormData)) {
        defaultHeaders['Content-Type'] = 'application/json';
    }

    try {
        const res = await fetch(url, {
            ...options,
            headers: {
                ...defaultHeaders,
                ...options.headers,
            },
        });

        // Handle non-JSON responses
        const contentType = res.headers.get('Content-Type') || '';
        const body = contentType.includes('application/json')
            ? await res.json()
            : await res.text();

        if (!res.ok) {
            throw new ApiError(res.status, body);
        }

        return body;
    } catch (err) {
        // Network error (fetch() itself failed)
        if (err instanceof TypeError) {
            throw new ApiError(0, {
                code: 'NETWORK_ERROR',
                message: `无法连接到后端服务: ${API_BASE_URL}`,
            });
        }
        throw err;
    }
}

// ── API Methods ──────────────────────────────────
const ApiClient = {
    // Health checks
    health: () => apiFetch('/health'),
    ready: () => apiFetch('/ready'),

    // Rename preview
    renamePreview: (fileType, filenames) =>
        apiFetch('/api/rename/preview', {
            method: 'POST',
            body: JSON.stringify({ file_type: fileType, filenames }),
        }),

    // Single upload
    uploadSingle: (file, fileType) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('file_type', fileType);
        return apiFetch('/api/upload', {
            method: 'POST',
            body: formData,
        });
    },

    // Batch upload
    uploadBatch: (files, fileType) => {
        const formData = new FormData();
        files.forEach(f => formData.append('files', f));
        formData.append('file_type', fileType);
        return apiFetch('/api/upload/batch', {
            method: 'POST',
            body: formData,
        });
    },

    // File status polling
    getStatus: (fileId) =>
        apiFetch(`/api/status/${fileId}`),

    // List files
    listFiles: (projectCode = '', maxResults = 100) => {
        const params = new URLSearchParams();
        if (projectCode) params.set('project_code', projectCode);
        params.set('max_results', maxResults);
        return apiFetch(`/api/files?${params}`);
    },

    // List KB indexed documents
    listKBDocuments: () => apiFetch('/api/kb/documents'),

    // Sync to KB
    syncToKB: (fileIds) =>
        apiFetch('/api/sync', {
            method: 'POST',
            body: JSON.stringify({ file_ids: fileIds }),
        }),
};
