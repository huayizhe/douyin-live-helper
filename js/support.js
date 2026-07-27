/** @charset UTF-8 */
/**
 * 赞赏 / 交流弹窗：左右结构展示赞赏码 + 微信群码。
 *
 * 优先 CDN（fetch→blob 绕过抖音 CSP）；失败回退扩展包 hosted/ 本地图。
 */

import { Logger } from './logger.js';
import {
    DONATE_QR_LOCAL_PATH,
    GROUP_QR_LOCAL_PATH,
    SUPPORT_CONTACT_EMAIL,
    getDonateQrUrl,
    getGroupQrUrl,
    resolveQrDisplaySrc
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
        overlay.innerHTML = `
            <div class="dylh-dialog-box dylh-support-box" role="dialog" aria-label="赞赏与交流">
                <button type="button" class="dylh-dialog-close" id="dylh-support-close" aria-label="关闭">×</button>
                <div class="dylh-dialog-title">赞赏 / 交流</div>
                <div class="dylh-support-grid">
                    <div class="dylh-support-col">
                        <img class="dylh-support-img" id="dylh-support-donate-img" alt="赞赏二维码" />
                        <div class="dylh-support-label">赞赏作者（自愿支持）</div>
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

        this._fillQrImg(overlay, '#dylh-support-donate-img', donateUrl, DONATE_QR_LOCAL_PATH, {
            statusSel: '#dylh-support-donate-status',
            clearStatusOnOk: true,
            failText: `赞赏码加载失败。可发邮件至 <a class="dylh-support-mail" href="mailto:${mail}">${mail}</a>`
        });
        this._fillQrImg(overlay, '#dylh-support-group-img', groupUrl, GROUP_QR_LOCAL_PATH, {
            statusSel: '#dylh-support-group-note',
            clearStatusOnOk: false,
            failText: `群二维码加载失败。请发邮件至 <a class="dylh-support-mail" href="mailto:${mail}">${mail}</a>，备注「插件交流进群」`
        });
    },

    /**
     * CDN → blob；失败则 hosted 本地兜底。
     * @private
     */
    async _fillQrImg(root, imgSel, cdnUrl, localRelPath, opts) {
        const img = root.querySelector(imgSel);
        const status = root.querySelector(opts.statusSel);
        if (!img) return;
        try {
            const { src, from, revoke } = await resolveQrDisplaySrc(cdnUrl, localRelPath);
            if (!this._overlay || this._overlay !== root) {
                if (revoke) {
                    try { URL.revokeObjectURL(src); } catch (_) { /* ignore */ }
                }
                return;
            }
            if (revoke) this._blobUrls.push(src);
            img.src = src;
            if (from === 'local') {
                Logger.log('二维码使用本地 hosted 兜底:', localRelPath);
            }
            if (opts.clearStatusOnOk && status) status.remove();
        } catch (e) {
            Logger.warn('二维码加载失败（CDN 与本地均不可用）:', cdnUrl, e);
            if (status) status.innerHTML = opts.failText;
        }
    },

    /**
     * 关闭赞赏/交流弹窗。
     * @returns {boolean}
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
     * @returns {boolean}
     */
    isOpen() {
        return !!(this._overlay || document.getElementById('dylh-support-overlay'));
    }
};
