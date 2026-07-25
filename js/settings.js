/**
 * 全局设置模块
 * 存储音量大小、声音总开关、直播墙性能参数，使用 chrome.storage.local（与 FavoriteManager 同款方案）。
 * 读操作从内存缓存（_cache）同步返回，写操作异步持久化，跨 www/live 子域共享。
 */

/**
 * 直播墙性能参数默认值（= 1.4.3 行为；还原与测试共用）。
 * 数值字段均带合法区间，init / set 时会钳制。
 */
export const PERF_DEFAULTS = Object.freeze({
    /** 并发模式：'auto' 按核数算上限；'manual' 用下方滑块值 */
    perfMode: 'auto',
    /** 同时加载路数（硬上限；自动时仅作 cap） */
    maxConcurrent: 15,
    /** 同时录制路数（硬上限；自动时仅作 cap） */
    maxConcurrentRecord: 4,
    /** 循环片段录制时长（毫秒） */
    recordMs: 6000,
    /** 片段码率（bps） */
    clipBitrate: 800000,
    /** 进视口停留再加载（毫秒） */
    clipSettleMs: 400,
    /** 片段缓存上限（个数） */
    maxCache: 120,
    /** 片段过期重录（分钟） */
    clipMaxAgeMin: 3
});

/** 各数值字段合法区间与步进（供 UI / 钳制共用） */
export const PERF_LIMITS = Object.freeze({
    maxConcurrent: { min: 8, max: 15, step: 1 },
    maxConcurrentRecord: { min: 2, max: 4, step: 1 },
    recordMs: { min: 3000, max: 10000, step: 1000 },
    clipBitrate: { allowed: [400000, 800000, 1200000] },
    clipSettleMs: { min: 0, max: 1000, step: 100 },
    maxCache: { min: 40, max: 200, step: 1 },
    clipMaxAgeMin: { min: 1, max: 15, step: 1 }
});

/**
 * 将数值钳制到 [min, max]，并按 step 对齐（若有 step）。
 * @param {number} v
 * @param {{ min: number, max: number, step?: number }} lim
 * @returns {number}
 */
function clampStepped(v, lim) {
    let n = Number(v);
    if (!Number.isFinite(n)) n = lim.min;
    n = Math.max(lim.min, Math.min(lim.max, n));
    if (lim.step && lim.step > 0) {
        n = Math.round(n / lim.step) * lim.step;
        n = Math.max(lim.min, Math.min(lim.max, n));
    }
    return n;
}

/**
 * 校验并钳制一份 perf 配置（返回新对象，不改入参）。
 * @param {object} raw
 * @returns {object}
 */
export function sanitizePerfConfig(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const out = { ...PERF_DEFAULTS };

    out.perfMode = src.perfMode === 'manual' ? 'manual' : 'auto';
    out.maxConcurrent = clampStepped(src.maxConcurrent ?? out.maxConcurrent, PERF_LIMITS.maxConcurrent);
    out.maxConcurrentRecord = clampStepped(
        src.maxConcurrentRecord ?? out.maxConcurrentRecord,
        PERF_LIMITS.maxConcurrentRecord
    );
    out.recordMs = clampStepped(src.recordMs ?? out.recordMs, PERF_LIMITS.recordMs);
    // 码率：落在允许列表；否则取最近一档
    {
        const allowed = PERF_LIMITS.clipBitrate.allowed;
        const br = Number(src.clipBitrate);
        if (allowed.includes(br)) {
            out.clipBitrate = br;
        } else if (Number.isFinite(br)) {
            out.clipBitrate = allowed.reduce((best, a) =>
                Math.abs(a - br) < Math.abs(best - br) ? a : best, allowed[1]);
        } else {
            out.clipBitrate = PERF_DEFAULTS.clipBitrate;
        }
    }
    out.clipSettleMs = clampStepped(src.clipSettleMs ?? out.clipSettleMs, PERF_LIMITS.clipSettleMs);
    out.maxCache = clampStepped(src.maxCache ?? out.maxCache, PERF_LIMITS.maxCache);
    out.clipMaxAgeMin = clampStepped(src.clipMaxAgeMin ?? out.clipMaxAgeMin, PERF_LIMITS.clipMaxAgeMin);

    return out;
}

const SettingsManager = {
    STORAGE_KEY: 'dylh_settings',

    /** 内存缓存，读操作从此处同步取值（含声音 + 性能） */
    _cache: {
        previewVolume: 0.3,
        globalSoundEnabled: true,
        ...PERF_DEFAULTS
    },

    /**
     * 配置变更回调列表（setPerfConfig / reset / 跨标签 sync 后触发，供 PreloadManager 即时 apply）。
     * @type {Array<(cfg: object) => void>}
     */
    _perfListeners: [],

    /**
     * 注册性能配置变更监听（返回取消函数）。
     * @param {(cfg: object) => void} fn
     * @returns {() => void}
     */
    onPerfChange(fn) {
        if (typeof fn !== 'function') return () => {};
        this._perfListeners.push(fn);
        return () => {
            this._perfListeners = this._perfListeners.filter(f => f !== fn);
        };
    },

    /** @private 通知所有 perf 监听者 */
    _notifyPerfChange() {
        const cfg = this.getPerfConfig();
        for (const fn of this._perfListeners) {
            try { fn(cfg); } catch (_) { /* 监听者异常不影响其它 */ }
        }
    },

    /**
     * 初始化：从 storage.local 加载 → 钳制 perf → 监听变更。
     * 需在插件启动时 await 调用一次（content.js）。
     */
    async init() {
        // 从 storage.local 加载（已有则覆盖默认值）
        const result = await chrome.storage.local.get(this.STORAGE_KEY);
        const stored = result[this.STORAGE_KEY];
        if (stored && typeof stored === 'object') {
            this._cache = { ...this._cache, ...stored };
        }
        // 校验数值落在合法区间（越界钳制）；若有修正则回写
        this._applyPerfSanitize(true);

        // 监听跨标签变更
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[this.STORAGE_KEY]) {
                const nv = changes[this.STORAGE_KEY].newValue;
                if (nv && typeof nv === 'object') {
                    this._cache = { ...this._cache, ...nv };
                    this._applyPerfSanitize(false);
                    this._notifyPerfChange();
                }
            }
        });
    },

    /**
     * 将 _cache 中的 perf 字段钳制到合法区间。
     * @param {boolean} persistIfChanged - 若钳制改动了值，是否写回 storage
     * @private
     */
    _applyPerfSanitize(persistIfChanged) {
        const before = this.getPerfConfig();
        const clean = sanitizePerfConfig(before);
        let changed = false;
        for (const k of Object.keys(PERF_DEFAULTS)) {
            if (this._cache[k] !== clean[k]) {
                this._cache[k] = clean[k];
                changed = true;
            }
        }
        if (changed && persistIfChanged) this._persist();
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

    /**
     * 读取直播墙性能配置（已钳制的快照）。
     * @returns {object}
     */
    getPerfConfig() {
        const snap = {};
        for (const k of Object.keys(PERF_DEFAULTS)) {
            snap[k] = this._cache[k];
        }
        return sanitizePerfConfig(snap);
    },

    /**
     * 部分更新性能配置：合并 → 钳制 → 持久化 → 通知监听者。
     * @param {object} partial
     * @returns {object} 更新后的完整 perf 配置
     */
    setPerfConfig(partial) {
        const next = sanitizePerfConfig({ ...this.getPerfConfig(), ...(partial || {}) });
        for (const k of Object.keys(PERF_DEFAULTS)) {
            this._cache[k] = next[k];
        }
        this._persist();
        this._notifyPerfChange();
        return next;
    },

    /**
     * 一键还原为 PERF_DEFAULTS，并立即持久化 / 通知。
     * @returns {object}
     */
    resetPerfConfig() {
        return this.setPerfConfig({ ...PERF_DEFAULTS });
    },

    _persist() {
        chrome.storage.local.set({ [this.STORAGE_KEY]: this._cache });
    }
};

export { SettingsManager };
