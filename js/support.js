/** @charset UTF-8 */
/**
 * 赞赏 / 交流弹窗：左右结构展示赞赏码 + 微信群码（CDN 托管）。
 *
 * 注意：抖音页 CSP 会拦截页面直接加载外链图片，因此用扩展权限 fetch CDN，
 * 再转成 blob: URL 赋给 <img>（blob 不受页面 img-src 限制）。
 */

import { Logger } from './logger.js';
import {
    SUPPORT_CONTACT_EMAIL,
    fetchQrObjectUrl,
    getDonateQrUrl,
    getGroupQrUrl
} from './support-qr.js';

/**
 * 赞赏/交流 UI 管理。
 */
export const SupportManager = {
    /** 当前弹层根节点 */
    _overlay: null,

    /** @type {string[]} 待 revoke 的 blob URL */
    _blobUrls: [],

    /**
     * 打开赞赏/交流弹窗（已打开则先关再开，避免叠多层）。
     */
    showPanel() {
        this.hidePanel();
        const donateUrl = getDonateQrUrl();
        const groupUrl = getGroupQrUrl();
        const mail = SUPPORT_CONTACT_EMAIL;

        const overlay = document.createElement('div');
        overlay.id = 'dylh-support-overlay';
        overlay.className = 'dylh-dialog-overlay';
        // 先不写外链 src，等 fetch 成 blob 再填，避免被抖音 CSP 直接拦截
        overlay.innerHTML = `
            <div class="dylh-dialog-box dylh-support-box" role="dialog" aria-label="赞赏与交流">
                <button type="button" class="dylh-dialog-close" id="dylh-support-close" aria-label="关闭">×</button>
                <div class="dylh-dialog-title">赞赏 / 交流</div>
                <div class="dylh-support-grid">
                    <div class="dylh-support-col">
                        <img class="dylh-support-img" id="dylh-support-donate-img" alt="赞赏二维码" />
                        <div class="dylh-support-label">赞赏支持（非强制）</div>
                        <div class="dylh-support-note" id="dylh-support-donate-status">加载中…</div>
                    </div>
                    <div class="dylh-support-col">
                        <img class="dylh-support-img" id="dylh-support-group-img" alt="微信群二维码" />
                        <div class="dylh-support-label">微信交流群</div>
                        <div class="dylh-support-note" id="dylh-support-group-note">
                            群码约 7 天过期；若已失效，请发邮件至
                            <a class="dylh-support-mail" href="mailto:${mail}?subject=${encodeURIComponent('插件交流进群')}">${mail}</a>
                            ，备注「插件交流进群」
                        </div>
                    </div>
                </div>
            </div>
        `;

        const close = () => this.hidePanel();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        overlay.querySelector('#dylh-support-close')?.addEventListener('click', close);

        document.body.appendChild(overlay);
        this._overlay = overlay;

        this._fillQrImg(overlay, '#dylh-support-donate-img', donateUrl, {
            statusSel: '#dylh-support-donate-status',
            clearStatusOnOk: true,
            failText: `赞赏码加载失败。可发邮件至 <a class="dylh-support-mail" href="mailto:${mail}">${mail}</a>`
        });
        this._fillQrImg(overlay, '#dylh-support-group-img', groupUrl, {
            statusSel: '#dylh-support-group-note',
            clearStatusOnOk: false,
            failText: `群二维码加载失败。请发邮件至 <a class="dylh-support-mail" href="mailto:${mail}">${mail}</a>，备注「插件交流进群」`
        });
    },

    /**
     * fetch CDN → blob URL → 赋给 img。
     * @private
     * @param {HTMLElement} root
     * @param {string} imgSel
     * @param {string} cdnUrl
     * @param {{ statusSel: string, clearStatusOnOk: boolean, failText: string }} opts
     */
    async _fillQrImg(root, imgSel, cdnUrl, opts) {
        const img = root.querySelector(imgSel);
        const status = root.querySelector(opts.statusSel);
        if (!img) return;
        try {
            const blobUrl = await fetchQrObjectUrl(cdnUrl);
            // 弹窗可能已关
            if (!this._overlay || this._overlay !== root) {
                URL.revokeObjectURL(blobUrl);
                return;
            }
            this._blobUrls.push(blobUrl);
            img.src = blobUrl;
            if (opts.clearStatusOnOk && status) status.remove();
        } catch (e) {
            Logger.warn('二维码 CDN 加载失败:', cdnUrl, e);
            if (status) status.innerHTML = opts.failText;
        }
    },

    /**
     * 关闭赞赏/交流弹窗。
     * @returns {boolean} 是否确实关掉了一层
     */
    hidePanel() {
        for (const u of this._blobUrls) {
            try { URL.revokeObjectURL(u); } catch (_) { /* ignore */ }
        }
        this._blobUrls = [];

        if (!this._overlay) {
            const existing = document.getElementById('dylh-support-overlay');
            if (existing) existing.remove();
            return !!existing;
        }
        this._overlay.remove();
        this._overlay = null;
        return true;
    },

    /**
     * 当前是否有赞赏/交流弹窗打开。
     * @returns {boolean}
     */
    isOpen() {
        return !!(this._overlay || document.getElementById('dylh-support-overlay'));
    }
};
