/** @charset UTF-8 */

/**
 * 预加载并发上限计算公式（纯函数，供 preload.js 与单元测试共用）。
 *
 * 加载与录制彻底解耦：
 * - 加载槽：playing 出画面后即释放，上限偏高以尽快铺首屏 live；
 * - 录制槽：仅约束 MediaRecorder 编码峰，弱机 2 / 常见 3 / 强机最高 4。
 */

/**
 * 计算加载并发上限。
 * @param {number} cores - 逻辑核数（navigator.hardwareConcurrency）
 * @param {number} [cap=15] - 字面/硬上限
 * @returns {number} 范围 [8, cap]
 */
export function computeLoadConcurrency(cores, cap = 15) {
    const n = Number(cores) > 0 ? Number(cores) : 6;
    return Math.max(8, Math.min(cap, Math.ceil(n * 1.0)));
}

/**
 * 计算录制（编码）并发上限。
 * @param {number} cores - 逻辑核数
 * @param {number} [cap=4] - 字面/硬上限
 * @returns {number} 范围 [2, cap]
 */
export function computeRecordConcurrency(cores, cap = 4) {
    const n = Number(cores) > 0 ? Number(cores) : 6;
    return Math.max(2, Math.min(cap, Math.ceil(n * 0.35)));
}

/**
 * 加载槽持有器：与 preload._startLoad 内 releaseLoadSlot 语义一致。
 * playing / cleanup / finalize / 早退均可调用 release；仅首次真正减 activeLoads。
 *
 * @param {{ activeLoads: number, _pump?: Function }} mgr - 至少含 activeLoads 的管理器
 * @returns {{ release: () => boolean, isHeld: () => boolean }}
 */
export function createLoadSlotHolder(mgr) {
    let held = true;
    return {
        /** @returns {boolean} 是否本次真正释放了槽 */
        release() {
            if (!held) return false;
            held = false;
            mgr.activeLoads = Math.max(0, mgr.activeLoads - 1);
            if (typeof mgr._pump === 'function') mgr._pump();
            return true;
        },
        isHeld() { return held; }
    };
}
