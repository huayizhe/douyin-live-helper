/** @charset UTF-8 */
/**
 * 预加载并发与加载槽释放单元测试。
 * 覆盖：playing 后释加载槽、_pump 能继续起新加载、录制槽仍受上限约束、防二次减槽。
 *
 * 运行：npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    computeLoadConcurrency,
    computeRecordConcurrency,
    createLoadSlotHolder
} from '../js/preload-concurrency.js';

describe('computeLoadConcurrency', () => {
    it('弱机不低于 8', () => {
        assert.equal(computeLoadConcurrency(2), 8);
        assert.equal(computeLoadConcurrency(4), 8);
        assert.equal(computeLoadConcurrency(6), 8);
    });

    it('常见 8 核为 8，12 核为 12', () => {
        assert.equal(computeLoadConcurrency(8), 8);
        assert.equal(computeLoadConcurrency(12), 12);
    });

    it('强机封顶 15', () => {
        assert.equal(computeLoadConcurrency(16), 15);
        assert.equal(computeLoadConcurrency(32), 15);
    });

    it('无效核数按 6 处理 → 8', () => {
        assert.equal(computeLoadConcurrency(0), 8);
        assert.equal(computeLoadConcurrency(NaN), 8);
    });
});

describe('computeRecordConcurrency', () => {
    it('弱机为 2', () => {
        assert.equal(computeRecordConcurrency(2), 2);
        assert.equal(computeRecordConcurrency(4), 2); // ceil(1.4)=2
    });

    it('常见 8 核为 3', () => {
        assert.equal(computeRecordConcurrency(8), 3); // ceil(2.8)=3
    });

    it('强机最高 4', () => {
        assert.equal(computeRecordConcurrency(12), 4); // ceil(4.2)=5 → min 4
        assert.equal(computeRecordConcurrency(16), 4);
    });
});

describe('createLoadSlotHolder（防二次减槽）', () => {
    it('playing 后 activeLoads 下降，且二次 release 不减槽', () => {
        const mgr = { activeLoads: 1, pumpCount: 0, _pump() { this.pumpCount++; } };
        const slot = createLoadSlotHolder(mgr);

        assert.equal(slot.release(), true);
        assert.equal(mgr.activeLoads, 0);
        assert.equal(mgr.pumpCount, 1);

        assert.equal(slot.release(), false);
        assert.equal(mgr.activeLoads, 0);
        assert.equal(mgr.pumpCount, 1);
    });
});

describe('playing 释槽后 _pump 与录制上限', () => {
    /**
     * 模拟 preload 调度：加载槽与录制槽分离。
     * playing → 释加载槽并申请录制槽；满录制则排队；释槽后 _pump 可起新加载。
     */
    function createTrackedScheduler({ maxLoad, maxRecord, queue }) {
        const tracked = {
            MAX_CONCURRENT: maxLoad,
            MAX_CONCURRENT_RECORD: maxRecord,
            activeLoads: 0,
            activeRecords: 0,
            queue: [...queue],
            _recordWaiters: [],
            startedLoads: [],
            handles: [],
            _pump() {
                while (this.activeLoads < this.MAX_CONCURRENT && this.queue.length > 0) {
                    const id = this.queue.shift();
                    this.activeLoads++;
                    this.startedLoads.push(id);
                    const slot = createLoadSlotHolder(this);
                    const h = {
                        id,
                        slot,
                        recordState: null,
                        onPlaying() {
                            slot.release();
                            if (tracked.activeRecords < tracked.MAX_CONCURRENT_RECORD) {
                                tracked.activeRecords++;
                                h.recordState = 'recording';
                            } else {
                                tracked._recordWaiters.push(h);
                                h.recordState = 'waiting';
                            }
                        },
                        onRecordDone() {
                            if (h.recordState === 'recording') {
                                tracked.activeRecords = Math.max(0, tracked.activeRecords - 1);
                                h.recordState = 'done';
                            }
                            slot.release(); // 兜底；正常路径 playing 已释 → no-op
                            if (tracked._recordWaiters.length && tracked.activeRecords < tracked.MAX_CONCURRENT_RECORD) {
                                const next = tracked._recordWaiters.shift();
                                tracked.activeRecords++;
                                next.recordState = 'recording';
                            }
                            tracked._pump();
                        },
                        onFailBeforePlaying() {
                            slot.release();
                        }
                    };
                    this.handles.push(h);
                }
            }
        };
        tracked._pump();
        return tracked;
    }

    it('满录制槽时仍可继续起新加载', () => {
        const tracked = createTrackedScheduler({
            maxLoad: 4,
            maxRecord: 2,
            queue: ['a', 'b', 'c', 'd', 'e', 'f']
        });

        assert.equal(tracked.activeLoads, 4);
        assert.deepEqual(tracked.startedLoads, ['a', 'b', 'c', 'd']);

        // 前 4 路全部 playing：加载槽应全部释放；仅 2 路在录
        const firstBatch = [...tracked.handles];
        for (const h of firstBatch) h.onPlaying();

        assert.equal(tracked.activeLoads, 2, '新起的 e/f 尚在 loading（未 playing）');
        assert.equal(tracked.activeRecords, 2, '录制槽仍受上限 2 约束');
        assert.equal(tracked._recordWaiters.length, 2, '超出录制上限的进入等待队列');
        assert.ok(tracked.startedLoads.includes('e'), '释槽后应继续加载 e');
        assert.ok(tracked.startedLoads.includes('f'), '释槽后应继续加载 f');

        // 录制结束唤起等待者，录制并发仍 ≤2
        const recording = firstBatch.filter(h => h.recordState === 'recording');
        recording[0].onRecordDone();
        assert.ok(tracked.activeRecords <= 2, '录制槽始终不超过上限');
        assert.equal(
            firstBatch.filter(h => h.recordState === 'recording').length +
            tracked.handles.filter(h => h.recordState === 'recording' && !firstBatch.includes(h)).length,
            tracked.activeRecords
        );
    });

    it('起播前失败也会释放加载槽并允许 _pump', () => {
        const tracked = createTrackedScheduler({
            maxLoad: 2,
            maxRecord: 2,
            queue: ['x', 'y']
        });
        assert.equal(tracked.activeLoads, 2);
        assert.deepEqual(tracked.startedLoads, ['x', 'y']);

        tracked.queue.push('z');
        tracked.handles[0].onFailBeforePlaying();
        assert.equal(tracked.activeLoads, 2, '失败释槽后应立刻起 z');
        assert.ok(tracked.startedLoads.includes('z'));
    });
});
