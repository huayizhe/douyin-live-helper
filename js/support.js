/** @charset UTF-8 */
/**
 * 赞赏 / 交流弹窗：左右结构展示赞赏码（本地）+ 微信群码（CDN）。
 */

import { Logger } from './logger.js';
import {
    DONATE_QR_REL_PATH,
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
        const donateUrl = (typeof chrome !== 'undefined' && chrome.runtime?.getURL)
            ? chrome.runtime.getURL(DONATE_QR_REL_PATH)
            : DONATE_QR_REL_PATH;
        const groupUrl = getGroupQrUrl();

        const overlay = document.createElement('div');
        overlay.id = 'dylh-support-overlay';
        overlay.className = 'dylh-dialog-overlay';
        overlay.innerHTML = `
            <div class="dylh-dialog-box dylh-support-box" role="dialog" aria-label="赞赏与交流">
                <button type="button" class="dylh-dialog-close" id="dylh-support-close" aria-label="关闭">×</button>
                <div class="dylh-dialog-title">赞赏 / 交流</div>
                <p class="dylh-support-hint">左侧赞赏支持（非强制）· 右侧扫码进微信交流群</p>
                <div class="dylh-support-grid">
                    <div class="dylh-support-col">
                        <div class="dylh-support-label">赞赏支持</div>
                        <img class="dylh-support-img" src="${donateUrl}" alt="赞赏二维码" />
                    </div>
                    <div class="dylh-support-col">
                        <div class="dylh-support-label">微信交流群</div>
                        <img class="dylh-support-img" id="dylh-support-group-img" src="${groupUrl}" alt="微信群二维码" />
                        <div class="dylh-support-note">群码约 7 天过期，失效请稍后再试或提 Issue</div>
                    </div>
                </div>
            </div>
        `;

        const close = () => this.hidePanel();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
        overlay.querySelector('#dylh-support-close')?.addEventListener('click', close);

        const groupImg = overlay.querySelector('#dylh-support-group-img');
        if (groupImg) {
            groupImg.addEventListener('error', () => {
                Logger.warn('微信群二维码加载失败:', groupUrl);
                const note = groupImg.parentElement?.querySelector('.dylh-support-note');
                if (note) note.textContent = '群二维码暂时无法加载，请稍后重试或到仓库 README 查看';
            });
        }

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
