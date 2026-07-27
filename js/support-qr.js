/** @charset UTF-8 */
/**
 * 赞赏 / 交流二维码相关常量。
 *
 * 优先 CDN（换图推仓库即可）；失败时回退扩展包内 hosted/ 同名文件。
 */

/** jsDelivr 仓库前缀 */
export const QR_CDN_REPO_PREFIX =
    'https://cdn.jsdelivr.net/gh/huayizhe/douyin-live-helper@master/hosted';

/** 赞赏码 CDN 基址（源文件：hosted/donate-qr.png） */
export const DONATE_QR_CDN_BASE = `${QR_CDN_REPO_PREFIX}/donate-qr.png`;

/** 微信群二维码 CDN 基址（源文件：hosted/wechat-group-qr.jpg） */
export const GROUP_QR_CDN_BASE = `${QR_CDN_REPO_PREFIX}/wechat-group-qr.jpg`;

/** 扩展包内赞赏码相对路径（CDN 失败兜底） */
export const DONATE_QR_LOCAL_PATH = 'hosted/donate-qr.png';

/** 扩展包内群码相对路径（CDN 失败兜底） */
export const GROUP_QR_LOCAL_PATH = 'hosted/wechat-group-qr.jpg';

/**
 * 二维码缓存戳：换任一托管图并推送后把数字 +1，强制刷新 CDN。
 * @type {string}
 */
export const QR_CACHE_BUST = '2';

/** @deprecated 使用 QR_CACHE_BUST */
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
 * 赞赏码 CDN URL。
 * @param {string} [bust]
 * @returns {string}
 */
export function getDonateQrUrl(bust = QR_CACHE_BUST) {
    return getCdnQrUrl(DONATE_QR_CDN_BASE, bust);
}

/**
 * 微信群码 CDN URL。
 * @param {string} [bust]
 * @returns {string}
 */
export function getGroupQrUrl(bust = QR_CACHE_BUST) {
    return getCdnQrUrl(GROUP_QR_CDN_BASE, bust);
}

/**
 * 扩展包内本地二维码 URL（chrome-extension://…）。
 * @param {string} relPath 相对扩展根目录
 * @returns {string}
 */
export function getLocalQrUrl(relPath) {
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
        return chrome.runtime.getURL(relPath);
    }
    return relPath;
}

/**
 * 用扩展权限拉取图片 URL，转为 blob:（绕过抖音页 CSP 对 https 图的限制）。
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchQrObjectUrl(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    const blob = await res.blob();
    if (!blob || blob.size === 0) {
        throw new Error('empty image');
    }
    return URL.createObjectURL(blob);
}

/**
 * 优先 CDN → blob；失败则回退扩展包 hosted 本地路径。
 * @param {string} cdnUrl
 * @param {string} localRelPath
 * @returns {Promise<{ src: string, from: 'cdn' | 'local', revoke?: boolean }>}
 */
export async function resolveQrDisplaySrc(cdnUrl, localRelPath) {
    try {
        const src = await fetchQrObjectUrl(cdnUrl);
        return { src, from: 'cdn', revoke: true };
    } catch (cdnErr) {
        const localUrl = getLocalQrUrl(localRelPath);
        try {
            // 本地 chrome-extension:// 也可 fetch 成 blob，统一显示路径
            const src = await fetchQrObjectUrl(localUrl);
            return { src, from: 'local', revoke: true };
        } catch (localErr) {
            // 最后直接用 extension URL（需 web_accessible_resources）
            if (localUrl) {
                return { src: localUrl, from: 'local', revoke: false };
            }
            throw cdnErr;
        }
    }
}
