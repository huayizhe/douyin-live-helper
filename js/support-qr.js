/** @charset UTF-8 */
/**
 * 赞赏 / 交流二维码相关常量。
 *
 * - 赞赏码：打进扩展包，本地展示（个人微信收款码一般长期有效）
 * - 微信群码：走 CDN 托管链接（群邀请码约 7 天过期，换图后推仓库并 bump CACHE_BUST）
 */

/** 扩展包内赞赏码路径（相对扩展根目录） */
export const DONATE_QR_REL_PATH = 'icons/qr-donate.png';

/**
 * 微信群二维码 jsDelivr 托管基址（源文件：仓库 hosted/wechat-group-qr.jpg）。
 * 国内经 CDN 拉取；替换步骤见 DEV.md / README。
 */
export const GROUP_QR_CDN_BASE =
    'https://cdn.jsdelivr.net/gh/huayizhe/douyin-live-helper@master/hosted/wechat-group-qr.jpg';

/**
 * 群二维码缓存戳：换新图并推送后把数字 +1，强制刷新 CDN 缓存。
 * @type {string}
 */
export const GROUP_QR_CACHE_BUST = '1';

/**
 * 拼出带缓存戳的群二维码完整 URL。
 * @param {string} [bust=GROUP_QR_CACHE_BUST]
 * @param {string} [base=GROUP_QR_CDN_BASE]
 * @returns {string}
 */
export function getGroupQrUrl(bust = GROUP_QR_CACHE_BUST, base = GROUP_QR_CDN_BASE) {
    const v = String(bust || '1');
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}v=${encodeURIComponent(v)}`;
}
