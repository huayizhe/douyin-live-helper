/**
 * 本地观看统计模块
 * 记录每个主播「本周观看次数 / 时长」，用于卡片角标与「最常看」排序。
 * 纯本地 chrome.storage.local（与 FavoriteManager / SettingsManager 同款方案），
 * 不上传、不联网；按 ISO 周自动清零（跨周即重置该主播计数）。
 *
 * 读操作从内存缓存（_cache）同步返回，写操作异步持久化。
 */

const StatsManager = {
    STORAGE_KEY: 'dylh_view_stats',

    /** 计为「看了一次」的最短停留秒数（过滤掠过/误触；悬浮本身已有 200ms 去抖） */
    MIN_COUNT_SEC: 3,

    /** 持久化的统计缓存：{ [secUid]: { wk:周键, c:本周次数, s:本周秒数 } } */
    _cache: {},

    /** 进行中的会话开始时刻（内存，不持久化）：{ [secUid]: startTs } */
    _sessions: {},

    /**
     * 初始化：从 storage.local 加载 + 监听变更。需在 content.js 的 Promise.all 中 await。
     */
    async init() {
        const r = await chrome.storage.local.get(this.STORAGE_KEY);
        this._cache = (r && r[this.STORAGE_KEY]) || {};
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[this.STORAGE_KEY]) {
                this._cache = changes[this.STORAGE_KEY].newValue || {};
            }
        });
    },

    /** ISO 年-周键，如 "2026-W23" */
    _weekKey(d = new Date()) {
        const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        const day = dt.getUTCDay() || 7;                 // 周一=1…周日=7
        dt.setUTCDate(dt.getUTCDate() + 4 - day);        // 移到本周周四
        const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
        const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
        return `${dt.getUTCFullYear()}-W${week}`;
    },

    /** 取/建当前周的条目（跨周自动清零） */
    _entry(secUid) {
        const wk = this._weekKey();
        let e = this._cache[secUid];
        if (!e || e.wk !== wk) { e = { wk, c: 0, s: 0 }; this._cache[secUid] = e; }
        return e;
    },

    /**
     * 开始一次观看会话（悬浮实时流 / 打开大屏时调用）。
     * 同一 secUid 若已有进行中的会话，先结算上一段，避免悬浮+大屏并发重复计数。
     */
    startSession(secUid) {
        if (!secUid) return;
        if (this._sessions[secUid]) this.endSession(secUid);
        this._sessions[secUid] = Date.now();
    },

    /**
     * 结束观看会话：停留 ≥ MIN_COUNT_SEC 才计「一次」并累加时长（过滤掠过）。
     */
    endSession(secUid) {
        if (!secUid) return;
        const start = this._sessions[secUid];
        if (!start) return;
        delete this._sessions[secUid];
        const secs = Math.round((Date.now() - start) / 1000);
        if (secs < this.MIN_COUNT_SEC) return;
        const e = this._entry(secUid);
        e.c += 1;
        e.s += secs;
        this._persist();
    },

    /** 本周观看次数（跨周返回 0，同步） */
    getWeekCount(secUid) {
        if (!secUid) return 0;
        const e = this._cache[secUid];
        if (!e || e.wk !== this._weekKey()) return 0;
        return e.c || 0;
    },

    _persist() {
        chrome.storage.local.set({ [this.STORAGE_KEY]: this._cache });
    }
};

export { StatsManager };
