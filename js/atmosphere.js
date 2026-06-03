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
     * 初始化：迁移旧 localStorage → 从 storage.local 加载 → 监听变更。
     * 在 content.js 启动时 await 调用一次。
     */
    async init() {
        await this._migrateFromLocalStorage();
        const result = await chrome.storage.local.get(this.STORAGE_KEY);
        this._cache = result[this.STORAGE_KEY] || this._cache || {};

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[this.STORAGE_KEY]) {
                this._cache = changes[this.STORAGE_KEY].newValue || {};
            }
        });
    },

    /** 把旧的 etmosphereEntryConfig_* / etmosphereEntryEnabled_* 迁移到 storage.local */
    async _migrateFromLocalStorage() {
        try {
            const migrated = {};
            let found = false;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                let m;
                if ((m = key.match(/^etmosphereEntryConfig_(.+)$/))) {
                    const sec = m[1];
                    (migrated[sec] = migrated[sec] || {}).entries = localStorage.getItem(key);
                    found = true;
                } else if ((m = key.match(/^etmosphereEntryEnabled_(.+)$/))) {
                    const sec = m[1];
                    (migrated[sec] = migrated[sec] || {}).display = localStorage.getItem(key) === 'true';
                    found = true;
                }
            }
            if (!found) return;

            const existing = (await chrome.storage.local.get(this.STORAGE_KEY))[this.STORAGE_KEY] || {};
            for (const sec in migrated) {
                existing[sec] = { ...migrated[sec], ...existing[sec] }; // 已有 local 数据优先
            }
            await chrome.storage.local.set({ [this.STORAGE_KEY]: existing });
            this._cache = existing;

            Object.keys(migrated).forEach(sec => {
                localStorage.removeItem(`etmosphereEntryConfig_${sec}`);
                localStorage.removeItem(`etmosphereEntryEnabled_${sec}`);
            });
        } catch (_) {
            // 迁移失败不影响功能
        }
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
