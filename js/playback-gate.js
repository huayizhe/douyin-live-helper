/** @charset UTF-8 */
/**
 * 直播墙视口播放门控纯函数与常量。
 * 与加载观察器 `_clipObserver` 解耦：只决定「是否播放」，不负责拉流/释放。
 */

/** 露出比例达到此值才允许循环播放（约 1/3） */
export const PLAY_VISIBLE_RATIO = 0.35;

/** 播放门控 IntersectionObserver 的 rootMargin（上下约一排缓冲） */
export const PLAY_ROOT_MARGIN = '300px 0px';

/** 播放门控 IntersectionObserver 的 threshold 阶梯 */
export const PLAY_THRESHOLDS = Object.freeze([0, 0.25, 0.35, 0.5, 0.75, 1]);

/**
 * 根据相交状态与可见比例判断卡片是否应播放。
 * @param {boolean} isIntersecting - IntersectionObserver entry.isIntersecting
 * @param {number} intersectionRatio - entry.intersectionRatio
 * @param {number} [ratio=PLAY_VISIBLE_RATIO] - 最低可见比例
 * @returns {boolean}
 */
export function shouldPlayCard(isIntersecting, intersectionRatio, ratio = PLAY_VISIBLE_RATIO) {
    return !!(isIntersecting && intersectionRatio >= ratio);
}
