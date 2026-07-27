/** @charset UTF-8 */
/**
 * 赞赏 / 交流弹窗：左右结构展示赞赏码 + 微信群码（均 CDN 托管）。
 */

import { Logger } from './logger.js';
import {
    SUPPORT_CONTACT_EMAIL,
    getDonateQrUrl,
    getGroupQrUrl
} from './support-qr.js';

/**
 * 赞赏/交流 UI 管理。
 */
export const SupportManager = {
    /** 当前弹层根节点 */
    _overlay: null,

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
                        <img class="dylh-support-img" id="dylh-support-donate-img" src="${donateUrl}" alt="赞赏二维码" />
                        <div class="dylh-support-label">赞赏支持（非强制）</div>
                    </div>
                    <div class="dylh-support-col">
                        <img class="dylh-support-img" id="dylh-support-group-img" src="${groupUrl}" alt="微信群二维码" />
                        <div class="dylh-support-label">微信交流群</div>
                        <div class="dylh-support-note">
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

        const bindImgError = (id, label) => {
            const img = overlay.querySelector(id);
            if (!img) return;
            img.addEventListener('error', () => {
                Logger.warn(`${label}加载失败:`, img.src);
                const note = img.parentElement?.querySelector('.dylh-support-note')
                    || img.parentElement?.querySelector('.dylh-support-label');
                if (note && note.classList.contains('dylh-support-note')) {
                    note.innerHTML = `二维码暂时无法加载。请发邮件至 <a class="dylh-support-mail" href="mailto:${mail}">${mail}</a>，备注「插件交流进群」`;
                }
            });
        };
        bindImgError('#dylh-support-donate-img', '赞赏二维码');
        bindImgError('#dylh-support-group-img', '微信群二维码');

        document.body.appendChild(overlay);
        this._overlay = overlay;
    },

    /**
     * 关闭赞赏/交流弹窗。
     * @returns {boolean} 是否确实关掉了一层
     */
    hidePanel() {
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
