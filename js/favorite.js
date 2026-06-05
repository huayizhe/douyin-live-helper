/**
 * 特别关心模块
 * 使用 chrome.storage.local 存储，兼容 Chrome / Edge / 360极速 / QQ浏览器 / Firefox。
 * 跨设备同步需要用户已登录浏览器账号并开启同步；未登录时数据保存在本地，
 * 但可解决 www.douyin.com 与 live.douyin.com 的 localStorage 隔离问题。
 *
 * 读操作从内存缓存（_cache）同步返回，写操作异步持久化到 storage，
 * 因此 modal.js / card.js 中的所有调用点无需改动。
 */

const FavoriteManager = {
    STORAGE_KEY: 'favorite_anchors',

    /** 内存缓存，读操作从此处同步取值 */
    _cache: [],

    /**
     * 初始化：从 chrome.storage.local 加载缓存，并监听跨标签/跨设备变更。
     * 需在插件启动时 await 调用一次（content.js）。
     */
    async init() {
        // 从 storage.sync 加载
        const result = await chrome.storage.local.get(this.STORAGE_KEY);
        this._cache = result[this.STORAGE_KEY] || [];

        // 监听来自其他标签页或其他设备的变更，实时同步缓存
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[this.STORAGE_KEY]) {
                this._cache = changes[this.STORAGE_KEY].newValue || [];
            }
        });
    },

    /**
     * 获取所有特别关心的主播ID列表（同步，从缓存读）
     * @returns {string[]}
     */
    getFavoriteList() {
        return this._cache;
    },

    /**
     * 添加主播到特别关心
     * @param {string} secUid
     */
    addFavorite(secUid) {
        if (this._cache.includes(secUid)) return;
        this._cache = [...this._cache, secUid];
        chrome.storage.local.set({ [this.STORAGE_KEY]: this._cache });
    },

    /**
     * 从特别关心中移除主播
     * @param {string} secUid
     */
    removeFavorite(secUid) {
        if (!this._cache.includes(secUid)) return;
        this._cache = this._cache.filter(id => id !== secUid);
        chrome.storage.local.set({ [this.STORAGE_KEY]: this._cache });
    },

    /**
     * 检查主播是否在特别关心列表中（同步）
     * @param {string} secUid
     * @returns {boolean}
     */
    isFavorite(secUid) {
        return this._cache.includes(secUid);
    },

    /**
     * 切换主播的特别关心状态
     * @param {string} secUid
     * @returns {boolean} 切换后的状态（true = 已加入）
     */
    toggleFavorite(secUid) {
        const isFav = this.isFavorite(secUid);
        if (isFav) {
            this.removeFavorite(secUid);
        } else {
            this.addFavorite(secUid);
        }
        return !isFav;
    }
};

export { FavoriteManager };
