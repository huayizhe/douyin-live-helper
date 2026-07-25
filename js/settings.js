/**
 * 全局设置模块
 * 存储音量大小、声音总开关、直播墙性能参数，使用 chrome.storage.local（与 FavoriteManager 同款方案）。
 * 读操作从内存缓存（_cache）同步返回，写操作异步持久化，跨 www/live 子域共享。
 */

import { computeLoadConcurrency, computeRecordConcurrency } from './preload-concurrency.js';

/**
 * 清晰度档位（0–3）：同时控制列表拉流码与片段录制码率。
 * 标清 SD1 / 高清 SD2 / 超清 HD1 / 蓝光 FULL_HD1
 */
export const CLIP_QUALITY_TIERS = Object.freeze([
    Object.freeze({ label: '标清', quality: 'SD1', bitrate: 400000 }),
    Object.freeze({ label: '高清', quality: 'SD2', bitrate: 800000 }),
    Object.freeze({ label: '超清', quality: 'HD1', bitrate: 1200000 }),
    Object.freeze({ label: '蓝光', quality: 'FULL_HD1', bitrate: 2000000 })
]);

/**
 * 将 clipQuality 档位映射为录制码率（bps）。
 * @param {number} tier
 * @returns {number}
 */
export function clipQualityToBitrate(tier) {
    const t = Math.max(0, Math.min(CLIP_QUALITY_TIERS.length - 1, Math.round(Number(tier) || 0)));
    return CLIP_QUALITY_TIERS[t].bitrate;
}

/**
 * 将 clipQuality 档位映射为直播流清晰度代码。
 * @param {number} tier
 * @returns {string}
 */
export function clipQualityToStreamCode(tier) {
    const t = Math.max(0, Math.min(CLIP_QUALITY_TIERS.length - 1, Math.round(Number(tier) || 0)));
    return CLIP_QUALITY_TIERS[t].quality;
}

/**
 * 旧 clipBitrate（bps）迁移到最近清晰度档。
 * @param {number} bps
 * @returns {number} 0–3
 */
export function migrateClipBitrateToQuality(bps) {
    const n = Number(bps);
    // 默认档 1（高清）；PERF_DEFAULTS 在下方定义，此处用字面量避免 TDZ
    if (!Number.isFinite(n) || n <= 0) return 1;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < CLIP_QUALITY_TIERS.length; i++) {
        const d = Math.abs(CLIP_QUALITY_TIERS[i].bitrate - n);
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

/**
 * 直播墙性能参数默认值。
 * 数值字段均带合法区间，init / set 时会钳制。
 * 一键还原时：并发按本机核数重算，其余字段回本对象。
 */
export const PERF_DEFAULTS = Object.freeze({
    /** 同时加载路数（滑块值即生效值） */
    maxConcurrent: 15,
    /** 同时录制路数（滑块值即生效值） */
    maxConcurrentRecord: 4,
    /** 循环片段录制时长（毫秒） */
    recordMs: 6000,
    /** 清晰度档 0–3（默认 1=高清）；同时控拉流 + 录制码率 */
    clipQuality: 1,
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
    clipQuality: { min: 0, max: 3, step: 1 },
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
 * 兼容迁移：旧 `perfMode` 忽略；旧 `clipBitrate` 映射为最近 `clipQuality`。
 * @param {object} raw
 * @returns {object}
 */
export function sanitizePerfConfig(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const out = { ...PERF_DEFAULTS };

    out.maxConcurrent = clampStepped(src.maxConcurrent ?? out.maxConcurrent, PERF_LIMITS.maxConcurrent);
    out.maxConcurrentRecord = clampStepped(
        src.maxConcurrentRecord ?? out.maxConcurrentRecord,
        PERF_LIMITS.maxConcurrentRecord
    );
    out.recordMs = clampStepped(src.recordMs ?? out.recordMs, PERF_LIMITS.recordMs);

    // 清晰度档：优先 clipQuality；否则从旧 clipBitrate 迁移
    if (src.clipQuality != null && src.clipQuality !== '') {
        out.clipQuality = clampStepped(src.clipQuality, PERF_LIMITS.clipQuality);
    } else if (src.clipBitrate != null && src.clipBitrate !== '') {
        out.clipQuality = migrateClipBitrateToQuality(src.clipBitrate);
    } else {
        out.clipQuality = PERF_DEFAULTS.clipQuality;
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
            // 旧版仅有 clipBitrate：按最近档迁移到 clipQuality（覆盖默认档）
            if (stored.clipBitrate != null && stored.clipQuality == null) {
                this._cache.clipQuality = migrateClipBitrateToQuality(stored.clipBitrate);
            }
        }
        // 校验数值落在合法区间（越界钳制）；若有修正则回写（顺带清掉旧 perfMode/clipBitrate）
        this._applyPerfSanitize(true);

        // 监听跨标签变更
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes[this.STORAGE_KEY]) {
                const nv = changes[this.STORAGE_KEY].newValue;
                if (nv && typeof nv === 'object') {
                    this._cache = { ...this._cache, ...nv };
                    if (nv.clipBitrate != null && nv.clipQuality == null) {
                        this._cache.clipQuality = migrateClipBitrateToQuality(nv.clipBitrate);
                    }
                    this._applyPerfSanitize(false);
                    this._notifyPerfChange();
                }
            }
        });
    },

    /**
     * 将 _cache 中的 perf 字段钳制到合法区间，并移除已废弃键。
     * @param {boolean} persistIfChanged - 若钳制改动了值，是否写回 storage
     * @private
     */
    _applyPerfSanitize(persistIfChanged) {
        const before = this.getPerfConfig();
        const clean = sanitizePerfConfig({ ...this._cache, ...before });
        let changed = false;
        for (const k of Object.keys(PERF_DEFAULTS)) {
            if (this._cache[k] !== clean[k]) {
                this._cache[k] = clean[k];
                changed = true;
            }
        }
        // 清除已废弃字段，避免 storage 长期残留
        if ('perfMode' in this._cache) { delete this._cache.perfMode; changed = true; }
        if ('clipBitrate' in this._cache) { delete this._cache.clipBitrate; changed = true; }
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
        // 迁移期：若缓存仍只有旧 clipBitrate，一并传入 sanitize
        if (this._cache.clipBitrate != null && snap.clipQuality == null) {
            snap.clipBitrate = this._cache.clipBitrate;
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
        if ('perfMode' in this._cache) delete this._cache.perfMode;
        if ('clipBitrate' in this._cache) delete this._cache.clipBitrate;
        this._persist();
        this._notifyPerfChange();
        return next;
    },

    /**
     * 一键还原：并发按本机核数推荐，其余字段回 PERF_DEFAULTS。
     * @returns {object}
     */
    resetPerfConfig() {
        const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 6;
        return this.setPerfConfig({
            ...PERF_DEFAULTS,
            maxConcurrent: computeLoadConcurrency(cores),
            maxConcurrentRecord: computeRecordConcurrency(cores)
        });
    },

    _persist() {
        chrome.storage.local.set({ [this.STORAGE_KEY]: this._cache });
    }
};

export { SettingsManager };
