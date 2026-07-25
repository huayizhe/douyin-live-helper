/** @charset UTF-8 */

/**
 * 循环片段「稳播门控 / 录中卡顿」纯函数（供 preload.js 与单元测试共用）。
 *
 * 起录前：playing 后需累计约 1s 的 currentTime 连续推进，才申请录制槽。
 * 录制中：连续停滞过久或停滞占比过高则丢弃本次 blob，保持 live，稍后重录。
 */

/** 稳播门控：需要累计推进的墙钟毫秒 */
export const WARMUP_NEED_MS = 1000;
/** 稳播门控：最长等待（仍不稳则放弃本轮） */
export const WARMUP_MAX_WAIT_MS = 4000;
/** 录中：连续 currentTime 不前进超过此毫秒视为卡顿 */
export const STALL_CONSECUTIVE_MS = 300;
/** 录中：总停滞占比超过此值则丢弃（需先录满至少 1s 再判） */
export const STALL_MAX_RATIO = 0.15;
/** currentTime 推进判定阈值（秒） */
export const TIME_EPSILON = 0.01;

/**
 * 创建稳播门控初始状态。
 * @param {number} nowMs
 * @param {number} currentTime
 * @returns {{ startMs: number, lastTime: number, lastSampleAt: number, advancingMs: number }}
 */
export function createWarmupState(nowMs, currentTime) {
    return {
        startMs: nowMs,
        lastTime: Number(currentTime) || 0,
        lastSampleAt: nowMs,
        advancingMs: 0
    };
}

/**
 * 喂入一次播放进度样本，更新稳播累计推进毫秒。
 * @param {ReturnType<typeof createWarmupState>} state
 * @param {number} currentTime
 * @param {number} nowMs
 * @param {number} [epsilon=TIME_EPSILON]
 * @returns {ReturnType<typeof createWarmupState>}
 */
export function updateWarmupSample(state, currentTime, nowMs, epsilon = TIME_EPSILON) {
    const ct = Number(currentTime) || 0;
    const elapsed = Math.max(0, nowMs - state.lastSampleAt);
    const next = {
        startMs: state.startMs,
        lastTime: state.lastTime,
        lastSampleAt: nowMs,
        advancingMs: state.advancingMs
    };
    if (ct > state.lastTime + epsilon) {
        next.advancingMs = state.advancingMs + elapsed;
        next.lastTime = ct;
    }
    return next;
}

/**
 * 稳播是否已达标。
 * @param {{ advancingMs: number }} state
 * @param {number} [needMs=WARMUP_NEED_MS]
 * @returns {boolean}
 */
export function isWarmupReady(state, needMs = WARMUP_NEED_MS) {
    return state.advancingMs >= needMs;
}

/**
 * 稳播等待是否超时。
 * @param {{ startMs: number }} state
 * @param {number} nowMs
 * @param {number} [maxWaitMs=WARMUP_MAX_WAIT_MS]
 * @returns {boolean}
 */
export function isWarmupTimedOut(state, nowMs, maxWaitMs = WARMUP_MAX_WAIT_MS) {
    return nowMs - state.startMs >= maxWaitMs;
}

/**
 * 创建录中卡顿跟踪状态。
 * @param {number} nowMs
 * @param {number} currentTime
 * @returns {{ lastTime: number, lastSampleAt: number, consecutiveStallMs: number, totalStallMs: number, totalMs: number }}
 */
export function createStallState(nowMs, currentTime) {
    return {
        lastTime: Number(currentTime) || 0,
        lastSampleAt: nowMs,
        consecutiveStallMs: 0,
        totalStallMs: 0,
        totalMs: 0
    };
}

/**
 * 喂入一次录中进度样本。
 * @param {ReturnType<typeof createStallState>} state
 * @param {number} currentTime
 * @param {number} nowMs
 * @param {number} [epsilon=TIME_EPSILON]
 * @returns {ReturnType<typeof createStallState>}
 */
export function updateStallSample(state, currentTime, nowMs, epsilon = TIME_EPSILON) {
    const ct = Number(currentTime) || 0;
    const elapsed = Math.max(0, nowMs - state.lastSampleAt);
    const next = {
        lastTime: state.lastTime,
        lastSampleAt: nowMs,
        consecutiveStallMs: state.consecutiveStallMs,
        totalStallMs: state.totalStallMs,
        totalMs: state.totalMs + elapsed
    };
    if (ct > state.lastTime + epsilon) {
        next.lastTime = ct;
        next.consecutiveStallMs = 0;
    } else {
        next.consecutiveStallMs = state.consecutiveStallMs + elapsed;
        next.totalStallMs = state.totalStallMs + elapsed;
    }
    return next;
}

/**
 * 是否应因卡顿丢弃本次录制。
 * @param {ReturnType<typeof createStallState>} state
 * @param {{ consecutiveMs?: number, maxRatio?: number, minSampleMs?: number }} [opts]
 * @returns {boolean}
 */
export function shouldDiscardForStutter(state, opts = {}) {
    const consecutiveMs = opts.consecutiveMs ?? STALL_CONSECUTIVE_MS;
    const maxRatio = opts.maxRatio ?? STALL_MAX_RATIO;
    const minSampleMs = opts.minSampleMs ?? 1000;
    if (state.consecutiveStallMs >= consecutiveMs) return true;
    if (state.totalMs >= minSampleMs && state.totalStallMs / state.totalMs > maxRatio) return true;
    return false;
}
