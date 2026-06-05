/**
 * 氛围词条存储模块
 *
 * 用 chrome.storage.local：纯本地、不上传云端、不跨设备，但**跨 www/live 子域共享**
 * （chrome.storage 按扩展隔离，不像 localStorage 按页面域名隔离）。
 * 读从内存缓存（_cache）同步返回，写异步持久化（与 favorite.js / settings.js 同款）。
 *
 * 每个主播（secUid）独立配置：
 *   { entries: 词条文本, display: 显示开关, voice: 语音播报开关 }
 * 全部存于单个键 dylh_atmosphere = { [secUid]: {...} }（storage.local 单项无 8KB 限制）。
 */

const AtmosphereManager = {
    STORAGE_KEY: 'dylh_atmosphere',

    /** 内存缓存：{ [secUid]: { entries, display, voice } } */
    _cache: {},

    /**
     * 初始化：从 storage.local 加载 → 监听变更。
     * 在 content.js 启动时 await 调用一次。
     */
    async init() {
        const result = await chrome.storage.local.get(this.STORAGE_KEY);
        this._cache = result[this.STORAGE_KEY] || this._cache || {};

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[this.STORAGE_KEY]) {
                this._cache = changes[this.STORAGE_KEY].newValue || {};
            }
        });
    },

    _get(secUid) { return this._cache[secUid] || {}; },
    _persist() { chrome.storage.local.set({ [this.STORAGE_KEY]: this._cache }); },

    /** 词条文本（无则返回 null，调用方用默认词条兜底）*/
    getEntries(secUid) { return this._get(secUid).entries || null; },
    setEntries(secUid, str) {
        this._cache[secUid] = { ...this._get(secUid), entries: str };
        this._persist();
    },
    removeEntries(secUid) {
        if (this._cache[secUid]) { delete this._cache[secUid].entries; this._persist(); }
    },

    /** 显示开关（默认关）*/
    isDisplay(secUid) { return this._get(secUid).display === true; },
    setDisplay(secUid, b) {
        this._cache[secUid] = { ...this._get(secUid), display: !!b };
        this._persist();
    },

    /** 语音播报开关（默认开）*/
    isVoice(secUid) {
        const v = this._get(secUid).voice;
        return v === undefined ? true : v === true;
    },
    setVoice(secUid, b) {
        this._cache[secUid] = { ...this._get(secUid), voice: !!b };
        this._persist();
    },
};

export { AtmosphereManager };
