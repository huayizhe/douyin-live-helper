/** @charset UTF-8 */
/**
 * 性能设置：默认值 / 钳制 / reset（按核数）/ clipQuality 档位 / applyPerfConfig 单元测试。
 *
 * 运行：npm test
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    PERF_DEFAULTS,
    PERF_LIMITS,
    CLIP_QUALITY_TIERS,
    sanitizePerfConfig,
    SettingsManager,
    clipQualityToBitrate,
    clipQualityToStreamCode,
    migrateClipBitrateToQuality
} from '../js/settings.js';
import { computeLoadConcurrency, computeRecordConcurrency } from '../js/preload-concurrency.js';

/**
 * 模拟 chrome.storage.local（供 SettingsManager 读写）。
 */
function mockChromeStorage() {
    const store = {};
    globalThis.chrome = {
        storage: {
            local: {
                async get(key) {
                    const k = typeof key === 'string' ? key : Object.keys(key || {})[0];
                    return { [k]: store[k] };
                },
                set(obj) {
                    Object.assign(store, obj);
                    return Promise.resolve();
                }
            },
            onChanged: {
                addListener() { /* no-op for unit tests */ }
            }
        }
    };
    return store;
}

describe('PERF_DEFAULTS / sanitizePerfConfig', () => {
    it('默认值无 perfMode，清晰度档为高清', () => {
        assert.equal(PERF_DEFAULTS.perfMode, undefined);
        assert.equal(PERF_DEFAULTS.clipBitrate, undefined);
        assert.equal(PERF_DEFAULTS.maxConcurrent, 15);
        assert.equal(PERF_DEFAULTS.maxConcurrentRecord, 4);
        assert.equal(PERF_DEFAULTS.recordMs, 6000);
        assert.equal(PERF_DEFAULTS.clipQuality, 1);
        assert.equal(PERF_DEFAULTS.clipSettleMs, 400);
        assert.equal(PERF_DEFAULTS.maxCache, 120);
        assert.equal(PERF_DEFAULTS.clipMaxAgeMin, 3);
    });

    it('空入参回落到默认，且不含 perfMode', () => {
        const s = sanitizePerfConfig(null);
        assert.deepEqual(s, { ...PERF_DEFAULTS });
        assert.equal('perfMode' in s, false);
        assert.deepEqual(sanitizePerfConfig({}), { ...PERF_DEFAULTS });
    });

    it('越界数值被钳制到合法区间', () => {
        const s = sanitizePerfConfig({
            maxConcurrent: 99,
            maxConcurrentRecord: 1,
            recordMs: 500,
            clipSettleMs: 5000,
            maxCache: 10,
            clipMaxAgeMin: 100,
            clipQuality: 9
        });
        assert.equal(s.maxConcurrent, PERF_LIMITS.maxConcurrent.max);
        assert.equal(s.maxConcurrentRecord, PERF_LIMITS.maxConcurrentRecord.min);
        assert.equal(s.recordMs, PERF_LIMITS.recordMs.min);
        assert.equal(s.clipSettleMs, PERF_LIMITS.clipSettleMs.max);
        assert.equal(s.maxCache, PERF_LIMITS.maxCache.min);
        assert.equal(s.clipMaxAgeMin, PERF_LIMITS.clipMaxAgeMin.max);
        assert.equal(s.clipQuality, PERF_LIMITS.clipQuality.max);
    });

    it('旧 clipBitrate 迁移到最近清晰度档', () => {
        assert.equal(sanitizePerfConfig({ clipBitrate: 400000 }).clipQuality, 0);
        assert.equal(sanitizePerfConfig({ clipBitrate: 800000 }).clipQuality, 1);
        assert.equal(sanitizePerfConfig({ clipBitrate: 1200000 }).clipQuality, 2);
        assert.equal(sanitizePerfConfig({ clipBitrate: 2000000 }).clipQuality, 3);
        assert.equal(sanitizePerfConfig({ clipBitrate: 500000 }).clipQuality, 0);
        assert.equal(migrateClipBitrateToQuality(1000000), 1);
    });

    it('忽略废弃 perfMode 字段', () => {
        const s = sanitizePerfConfig({ perfMode: 'manual', maxConcurrent: 12 });
        assert.equal('perfMode' in s, false);
        assert.equal(s.maxConcurrent, 12);
    });

    it('recordMs 按 1000 步长对齐', () => {
        assert.equal(sanitizePerfConfig({ recordMs: 6500 }).recordMs, 7000);
        assert.equal(sanitizePerfConfig({ recordMs: 6400 }).recordMs, 6000);
    });
});

describe('clipQuality 档位映射', () => {
    it('四档标签 / 码率 / 拉流码', () => {
        assert.equal(CLIP_QUALITY_TIERS.length, 4);
        assert.equal(clipQualityToStreamCode(0), 'SD1');
        assert.equal(clipQualityToBitrate(0), 400000);
        assert.equal(clipQualityToStreamCode(1), 'SD2');
        assert.equal(clipQualityToBitrate(1), 800000);
        assert.equal(clipQualityToStreamCode(2), 'HD1');
        assert.equal(clipQualityToBitrate(2), 1200000);
        assert.equal(clipQualityToStreamCode(3), 'FULL_HD1');
        assert.equal(clipQualityToBitrate(3), 2000000);
    });

    it('越界档位钳到两端', () => {
        assert.equal(clipQualityToStreamCode(-1), 'SD1');
        assert.equal(clipQualityToStreamCode(99), 'FULL_HD1');
    });
});

describe('SettingsManager get/set/resetPerfConfig', () => {
    beforeEach(async () => {
        mockChromeStorage();
        SettingsManager._cache = {
            previewVolume: 0.3,
            globalSoundEnabled: true,
            ...PERF_DEFAULTS
        };
        SettingsManager._perfListeners = [];
        await SettingsManager.init();
    });

    it('getPerfConfig 返回默认快照（无 perfMode）', () => {
        const cfg = SettingsManager.getPerfConfig();
        assert.equal('perfMode' in cfg, false);
        assert.equal(cfg.maxConcurrent, 15);
        assert.equal(cfg.clipQuality, 1);
        assert.equal(cfg.recordMs, 6000);
    });

    it('setPerfConfig 部分更新并钳制', () => {
        const next = SettingsManager.setPerfConfig({ maxConcurrent: 99, clipQuality: 3 });
        assert.equal(next.maxConcurrent, 15);
        assert.equal(next.clipQuality, 3);
        assert.equal(SettingsManager.getPerfConfig().clipQuality, 3);
    });

    it('resetPerfConfig：并发跟核数，其余回产品默认', () => {
        SettingsManager.setPerfConfig({ maxConcurrent: 10, recordMs: 3000, clipQuality: 3 });
        const cores = navigator.hardwareConcurrency || 6;
        const reset = SettingsManager.resetPerfConfig();
        assert.equal(reset.maxConcurrent, computeLoadConcurrency(cores));
        assert.equal(reset.maxConcurrentRecord, computeRecordConcurrency(cores));
        assert.equal(reset.recordMs, PERF_DEFAULTS.recordMs);
        assert.equal(reset.clipQuality, PERF_DEFAULTS.clipQuality);
        assert.equal(reset.clipSettleMs, PERF_DEFAULTS.clipSettleMs);
        assert.equal(reset.maxCache, PERF_DEFAULTS.maxCache);
        assert.equal(reset.clipMaxAgeMin, PERF_DEFAULTS.clipMaxAgeMin);
    });

    it('onPerfChange 在 set/reset 时触发', () => {
        let calls = 0;
        let last = null;
        const off = SettingsManager.onPerfChange((cfg) => { calls++; last = cfg; });
        SettingsManager.setPerfConfig({ clipSettleMs: 200 });
        assert.equal(calls, 1);
        assert.equal(last.clipSettleMs, 200);
        SettingsManager.resetPerfConfig();
        assert.equal(calls, 2);
        assert.equal(last.clipSettleMs, PERF_DEFAULTS.clipSettleMs);
        off();
        SettingsManager.setPerfConfig({ clipSettleMs: 100 });
        assert.equal(calls, 2, '取消后不再通知');
    });
});

describe('applyPerfConfig 生效值（滑块即生效）', () => {
    /**
     * 复刻 PreloadManager.applyPerfConfig 的核心分支，避免拉起 DOM/HLS 依赖。
     */
    function applyPerfConfig(target, cfg) {
        const load = Number(cfg.maxConcurrent) > 0 ? Number(cfg.maxConcurrent) : 15;
        const record = Number(cfg.maxConcurrentRecord) > 0 ? Number(cfg.maxConcurrentRecord) : 4;
        target.MAX_CONCURRENT = Math.max(8, Math.min(15, Math.round(load)));
        target.MAX_CONCURRENT_RECORD = Math.max(2, Math.min(4, Math.round(record)));
        if (Number(cfg.recordMs) > 0) target.RECORD_MS = Number(cfg.recordMs);
        const tier = cfg.clipQuality != null ? Number(cfg.clipQuality) : 1;
        target.CLIP_STREAM_QUALITY = clipQualityToStreamCode(tier);
        target.CLIP_BITRATE = clipQualityToBitrate(tier);
        if (Number(cfg.maxCache) > 0) target.MAX_CACHE = Math.round(Number(cfg.maxCache));
        if (Number(cfg.clipMaxAgeMin) > 0) {
            target.CLIP_MAX_AGE = Number(cfg.clipMaxAgeMin) * 60 * 1000;
        }
    }

    it('滑块值直接生效，清晰度档映射拉流+码率', () => {
        const t = {};
        applyPerfConfig(t, sanitizePerfConfig({
            maxConcurrent: 12,
            maxConcurrentRecord: 3,
            recordMs: 4000,
            clipQuality: 2,
            maxCache: 80,
            clipMaxAgeMin: 5
        }));
        assert.equal(t.MAX_CONCURRENT, 12);
        assert.equal(t.MAX_CONCURRENT_RECORD, 3);
        assert.equal(t.RECORD_MS, 4000);
        assert.equal(t.CLIP_STREAM_QUALITY, 'HD1');
        assert.equal(t.CLIP_BITRATE, 1200000);
        assert.equal(t.MAX_CACHE, 80);
        assert.equal(t.CLIP_MAX_AGE, 5 * 60 * 1000);
    });

    it('蓝光档：FULL_HD1 + 2Mbps', () => {
        const t = {};
        applyPerfConfig(t, sanitizePerfConfig({ clipQuality: 3 }));
        assert.equal(t.CLIP_STREAM_QUALITY, 'FULL_HD1');
        assert.equal(t.CLIP_BITRATE, 2000000);
    });
});
