/** @charset UTF-8 */
/**
 * 性能设置：默认值 / 钳制 / reset / applyPerfConfig（auto/manual）单元测试。
 *
 * 运行：npm test
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    PERF_DEFAULTS,
    PERF_LIMITS,
    sanitizePerfConfig,
    SettingsManager
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
    it('默认值与 1.4.3 行为一致', () => {
        assert.equal(PERF_DEFAULTS.perfMode, 'auto');
        assert.equal(PERF_DEFAULTS.maxConcurrent, 15);
        assert.equal(PERF_DEFAULTS.maxConcurrentRecord, 4);
        assert.equal(PERF_DEFAULTS.recordMs, 6000);
        assert.equal(PERF_DEFAULTS.clipBitrate, 800000);
        assert.equal(PERF_DEFAULTS.clipSettleMs, 400);
        assert.equal(PERF_DEFAULTS.maxCache, 120);
        assert.equal(PERF_DEFAULTS.clipMaxAgeMin, 3);
    });

    it('空入参回落到默认', () => {
        assert.deepEqual(sanitizePerfConfig(null), { ...PERF_DEFAULTS });
        assert.deepEqual(sanitizePerfConfig({}), { ...PERF_DEFAULTS });
    });

    it('越界数值被钳制到合法区间', () => {
        const s = sanitizePerfConfig({
            maxConcurrent: 99,
            maxConcurrentRecord: 1,
            recordMs: 500,
            clipSettleMs: 5000,
            maxCache: 10,
            clipMaxAgeMin: 100
        });
        assert.equal(s.maxConcurrent, PERF_LIMITS.maxConcurrent.max);
        assert.equal(s.maxConcurrentRecord, PERF_LIMITS.maxConcurrentRecord.min);
        assert.equal(s.recordMs, PERF_LIMITS.recordMs.min);
        assert.equal(s.clipSettleMs, PERF_LIMITS.clipSettleMs.max);
        assert.equal(s.maxCache, PERF_LIMITS.maxCache.min);
        assert.equal(s.clipMaxAgeMin, PERF_LIMITS.clipMaxAgeMin.max);
    });

    it('码率就近落到允许档位', () => {
        assert.equal(sanitizePerfConfig({ clipBitrate: 400000 }).clipBitrate, 400000);
        assert.equal(sanitizePerfConfig({ clipBitrate: 1200000 }).clipBitrate, 1200000);
        assert.equal(sanitizePerfConfig({ clipBitrate: 500000 }).clipBitrate, 400000);
        assert.equal(sanitizePerfConfig({ clipBitrate: 1000000 }).clipBitrate, 800000);
    });

    it('perfMode 仅允许 auto/manual', () => {
        assert.equal(sanitizePerfConfig({ perfMode: 'manual' }).perfMode, 'manual');
        assert.equal(sanitizePerfConfig({ perfMode: 'weird' }).perfMode, 'auto');
    });

    it('recordMs 按 1000 步长对齐', () => {
        assert.equal(sanitizePerfConfig({ recordMs: 6500 }).recordMs, 7000);
        assert.equal(sanitizePerfConfig({ recordMs: 6400 }).recordMs, 6000);
    });
});

describe('SettingsManager get/set/resetPerfConfig', () => {
    beforeEach(async () => {
        mockChromeStorage();
        // 重置内存缓存为默认（避免测试间污染）
        SettingsManager._cache = {
            previewVolume: 0.3,
            globalSoundEnabled: true,
            ...PERF_DEFAULTS
        };
        SettingsManager._perfListeners = [];
        await SettingsManager.init();
    });

    it('getPerfConfig 返回默认快照', () => {
        const cfg = SettingsManager.getPerfConfig();
        assert.equal(cfg.perfMode, 'auto');
        assert.equal(cfg.maxConcurrent, 15);
        assert.equal(cfg.recordMs, 6000);
    });

    it('setPerfConfig 部分更新并钳制', () => {
        const next = SettingsManager.setPerfConfig({ maxConcurrent: 99, perfMode: 'manual' });
        assert.equal(next.perfMode, 'manual');
        assert.equal(next.maxConcurrent, 15);
        assert.equal(SettingsManager.getPerfConfig().perfMode, 'manual');
    });

    it('resetPerfConfig 写回默认', () => {
        SettingsManager.setPerfConfig({ perfMode: 'manual', maxConcurrent: 10, recordMs: 3000 });
        const reset = SettingsManager.resetPerfConfig();
        assert.deepEqual(reset, { ...PERF_DEFAULTS });
        assert.deepEqual(SettingsManager.getPerfConfig(), { ...PERF_DEFAULTS });
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

describe('applyPerfConfig 生效值（auto / manual）', () => {
    /**
     * 复刻 PreloadManager.applyPerfConfig 的核心分支，避免拉起 DOM/HLS 依赖。
     */
    function applyPerfConfig(target, cfg) {
        const cores = 8; // 固定核数便于断言
        const loadCap = Number(cfg.maxConcurrent) > 0 ? Number(cfg.maxConcurrent) : 15;
        const recordCap = Number(cfg.maxConcurrentRecord) > 0 ? Number(cfg.maxConcurrentRecord) : 4;

        if (cfg.perfMode === 'manual') {
            target.MAX_CONCURRENT = Math.max(8, Math.min(15, Math.round(loadCap)));
            target.MAX_CONCURRENT_RECORD = Math.max(2, Math.min(4, Math.round(recordCap)));
        } else {
            target.MAX_CONCURRENT = computeLoadConcurrency(cores, loadCap);
            target.MAX_CONCURRENT_RECORD = computeRecordConcurrency(cores, recordCap);
        }
        if (Number(cfg.recordMs) > 0) target.RECORD_MS = Number(cfg.recordMs);
        if (Number(cfg.clipBitrate) > 0) target.CLIP_BITRATE = Number(cfg.clipBitrate);
        if (Number(cfg.maxCache) > 0) target.MAX_CACHE = Math.round(Number(cfg.maxCache));
        if (Number(cfg.clipMaxAgeMin) > 0) {
            target.CLIP_MAX_AGE = Number(cfg.clipMaxAgeMin) * 60 * 1000;
        }
    }

    it('auto：按核数算，滑块作 cap', () => {
        const t = {};
        applyPerfConfig(t, sanitizePerfConfig({
            perfMode: 'auto',
            maxConcurrent: 15,
            maxConcurrentRecord: 4,
            recordMs: 6000,
            clipBitrate: 800000,
            maxCache: 120,
            clipMaxAgeMin: 3
        }));
        // 8 核：load=8，record=ceil(2.8)=3
        assert.equal(t.MAX_CONCURRENT, computeLoadConcurrency(8, 15));
        assert.equal(t.MAX_CONCURRENT_RECORD, computeRecordConcurrency(8, 4));
        assert.equal(t.RECORD_MS, 6000);
        assert.equal(t.CLIP_BITRATE, 800000);
        assert.equal(t.MAX_CACHE, 120);
        assert.equal(t.CLIP_MAX_AGE, 3 * 60 * 1000);
    });

    it('auto + 较低 cap：生效值不超过 cap', () => {
        const t = {};
        applyPerfConfig(t, sanitizePerfConfig({
            perfMode: 'auto',
            maxConcurrent: 8,
            maxConcurrentRecord: 2
        }));
        assert.equal(t.MAX_CONCURRENT, 8);
        assert.equal(t.MAX_CONCURRENT_RECORD, 2);
    });

    it('manual：直接使用滑块值', () => {
        const t = {};
        applyPerfConfig(t, sanitizePerfConfig({
            perfMode: 'manual',
            maxConcurrent: 12,
            maxConcurrentRecord: 3,
            recordMs: 4000,
            clipBitrate: 400000,
            maxCache: 80,
            clipMaxAgeMin: 5
        }));
        assert.equal(t.MAX_CONCURRENT, 12);
        assert.equal(t.MAX_CONCURRENT_RECORD, 3);
        assert.equal(t.RECORD_MS, 4000);
        assert.equal(t.CLIP_BITRATE, 400000);
        assert.equal(t.MAX_CACHE, 80);
        assert.equal(t.CLIP_MAX_AGE, 5 * 60 * 1000);
    });
});
