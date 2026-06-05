/**
 * 全局设置模块
 * 存储音量大小、声音总开关，使用 chrome.storage.sync（与 FavoriteManager 同款方案）。
 * 读操作从内存缓存（_cache）同步返回，写操作异步持久化，跨 www/live 子域与设备同步。
 */

const SettingsManager = {
    STORAGE_KEY: 'dylh_settings',

    /** 内存缓存，读操作从此处同步取值 */
    _cache: {
        previewVolume: 0.3,
        globalSoundEnabled: true
    },

    /**
     * 初始化：从 storage.sync 加载 → 监听变更。
     * 需在插件启动时 await 调用一次（content.js）。
     */
    async init() {
        // 从 storage.sync 加载（已有则覆盖默认值）
        const result = await chrome.storage.sync.get(this.STORAGE_KEY);
        const stored = result[this.STORAGE_KEY];
        if (stored && typeof stored === 'object') {
            this._cache = { ...this._cache, ...stored };
        }

        // 监听跨标签/跨设备变更
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes[this.STORAGE_KEY]) {
                const nv = changes[this.STORAGE_KEY].newValue;
                if (nv && typeof nv === 'object') {
                    this._cache = { ...this._cache, ...nv };
                }
            }
        });
    },

    /** 获取预览音量（0~1，同步） */
    getVolume() {
        return this._cache.previewVolume;
    },

    /** 设置预览音量 */
    setVolume(v) {
        this._cache.previewVolume = v;
        this._persist();
    },

    /** 声音总开关是否开启（同步） */
    isSoundEnabled() {
        return this._cache.globalSoundEnabled;
    },

    /** 设置声音总开关 */
    setSoundEnabled(b) {
        this._cache.globalSoundEnabled = b;
        this._persist();
    },

    _persist() {
        chrome.storage.sync.set({ [this.STORAGE_KEY]: this._cache });
    }
};

export { SettingsManager };
