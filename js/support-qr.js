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
export const QR_CACHE_BUST = '3';

/** @deprecated 使用 QR_CACHE_BUST */
export const GROUP_QR_CACHE_BUST = QR_CACHE_BUST;

/** 群码过期时联系邮箱（备注：插件交流进群） */
export const SUPPORT_CONTACT_EMAIL = '1035864725@qq.com';

/**
 * 赞赏码下方鼓励文案（打开弹窗时随机一条，无道德绑架）。
 * @type {readonly string[]}
 */
export const DONATE_COPY_TEXTS = Object.freeze([
    '如果这个插件帮到了你，随意扫一下就好，完全自愿。',
    '做这个纯属兴趣；喜欢的话请我喝杯奶茶也行。',
    '你的支持会让我更有动力继续维护和更新。',
    '用得顺手就很开心；想支持的话扫码即可，不扫也完全没问题。'
]);

/**
 * 随机取一条赞赏鼓励文案。
 * @param {() => number} [rand=Math.random] 可注入随机源便于单测
 * @returns {string}
 */
export function pickRandomDonateCopy(rand = Math.random) {
    const list = DONATE_COPY_TEXTS;
    if (!list.length) return '';
    const r = typeof rand === 'function' ? rand() : Math.random();
    const i = Math.floor(Math.max(0, Math.min(0.999999, Number(r) || 0)) * list.length);
    return list[i];
}

/**
 * 转义文本以便安全写入 HTML。
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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
