/** @charset UTF-8 */
/**
 * 悬浮预览与循环片段衔接：z-index 与「何时 pauseCard」纯逻辑。
 * 循环 video 为 z-index:1；hover live 须更高才能在 opacity=1 后盖住。
 */

/** 悬浮实时预览 video 的 z-index（高于循环片段的 1） */
export const HOVER_LIVE_Z_INDEX = '2';

/**
 * live play 成功并淡入后才应暂停本卡循环；失败/取不到流则不 pause，循环继续。
 * @param {boolean} playSucceeded - playVideo() 是否成功
 * @returns {boolean}
 */
export function shouldPauseLoopAfterHoverLive(playSucceeded) {
    return playSucceeded === true;
}
