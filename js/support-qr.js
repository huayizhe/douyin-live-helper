/** @charset UTF-8 */
/**
 * 赞赏 / 交流二维码相关常量（均走 jsDelivr 托管，换图推仓库即可）。
 *
 * - 赞赏码：个人微信收款码一般长期有效
 * - 微信群码：群邀请码约 7 天过期，换图后 bump CACHE_BUST
 */

/** jsDelivr 仓库前缀 */
export const QR_CDN_REPO_PREFIX =
    'https://cdn.jsdelivr.net/gh/huayizhe/douyin-live-helper@master/hosted';

/** 赞赏码 CDN 基址（源文件：hosted/donate-qr.png） */
export const DONATE_QR_CDN_BASE = `${QR_CDN_REPO_PREFIX}/donate-qr.png`;

/** 微信群二维码 CDN 基址（源文件：hosted/wechat-group-qr.jpg） */
export const GROUP_QR_CDN_BASE = `${QR_CDN_REPO_PREFIX}/wechat-group-qr.jpg`;

/**
 * 二维码缓存戳：换任一托管图并推送后把数字 +1，强制刷新 CDN。
 * @type {string}
 */
export const QR_CACHE_BUST = '2';

/** @deprecated 使用 QR_CACHE_BUST；保留别名以免旧引用报错 */
export const GROUP_QR_CACHE_BUST = QR_CACHE_BUST;

/** 群码过期时联系邮箱（备注：插件交流进群） */
export const SUPPORT_CONTACT_EMAIL = '1035864725@qq.com';

/**
 * 拼出带缓存戳的 CDN 图片 URL。
 * @param {string} base
 * @param {string} [bust=QR_CACHE_BUST]
 * @returns {string}
 */
export function getCdnQrUrl(base, bust = QR_CACHE_BUST) {
    const v = String(bust || '1');
    const sep = String(base).includes('?') ? '&' : '?';
    return `${base}${sep}v=${encodeURIComponent(v)}`;
}

/**
 * 赞赏码完整 URL。
 * @param {string} [bust]
 * @returns {string}
 */
export function getDonateQrUrl(bust = QR_CACHE_BUST) {
    return getCdnQrUrl(DONATE_QR_CDN_BASE, bust);
}

/**
 * 微信群码完整 URL。
 * @param {string} [bust]
 * @returns {string}
 */
export function getGroupQrUrl(bust = QR_CACHE_BUST) {
    return getCdnQrUrl(GROUP_QR_CDN_BASE, bust);
}
