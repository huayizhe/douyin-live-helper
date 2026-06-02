/**
 * 许可证管理模块（阶段一：离线 ECDSA 验签）
 *
 * 安全原理：
 *   - 你用私钥（在本地，绝不进版本库）签发许可证字符串，插件用内置公钥本地验签。
 *   - 拿不到私钥就无法伪造有效许可证；改动任意一个字节验签即失败。
 *   - 许可证 payload 含到期时间，可选机器绑定（防转卖）。
 *   - 全程离线：粘贴密钥即可激活，无需联网、无需服务器（阶段二再加联网续期）。
 *
 * 套餐不分功能档位：月/年/买断都解锁全部 PRO，差异仅在到期时间 e。
 */

import { LICENSE } from './constants.js';

// ── 内置公钥（仅含验签字段，无私钥）──
// ⚠️ 运行 `node tools/keygen-pair.js` 会自动把真实公钥写入这里的 _PK。
const _PK = {"kty":"EC","crv":"P-256","x":"XTlNQEDy631qGxXP5xSg4tpsbkwVoQTIIx5YuM0K8kM","y":"i1_5PNKQt5FwqtSoRMQPTyQI8QQcp-7aH7CABoeZ70M"};

// ── 私有存储键 ──
const _LIC_KEY = '_dylh_lic';
const _MID_KEY = '_dylh_mid';

// ── base64url 工具 ──
function _b64uToBytes(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function _jsonFromB64u(s) {
    return JSON.parse(new TextDecoder().decode(_b64uToBytes(s)));
}

// ── 验签（ECDSA ES256，本地完成，无需网络）──
async function _verify(licStr, machineId) {
    try {
        const parts = String(licStr).trim().split('.');
        if (parts.length !== 3) return null;
        const [h, p, sig] = parts;

        const key = await crypto.subtle.importKey(
            'jwk', _PK,
            { name: 'ECDSA', namedCurve: 'P-256' },
            false, ['verify']
        );
        const data = new TextEncoder().encode(`${h}.${p}`);
        const ok = await crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' },
            key, _b64uToBytes(sig), data
        );
        if (!ok) return null;

        const payload = _jsonFromB64u(p);
        if (!payload || typeof payload.e !== 'number') return null;
        if (payload.e < Date.now()) return null;               // 已过期
        if (payload.m && payload.m !== machineId) return null;  // 机器绑定不符
        return payload;
    } catch {
        return null;
    }
}

// ── 主管理器 ──
export const LicenseManager = {
    _isPro: false,
    _payload: null,

    /** 是否为 PRO（多处取值点，分散增加反逆向成本）*/
    get isPro() { return this._isPro === true; },

    get expiresAt() { return this._payload ? this._payload.e : null; },
    get plan() { return this._payload ? this._payload.p : null; },

    /**
     * 初始化：从 storage.local 读取许可证并本地验签。
     * 在 content.js 的 Promise.all 中 await 调用。
     */
    async init() {
        try {
            const mid = await this.getMachineId();
            const got = await chrome.storage.local.get(_LIC_KEY);
            const licStr = got[_LIC_KEY];
            if (!licStr) { this._isPro = false; return; }
            const payload = await _verify(licStr, mid);
            if (payload) { this._isPro = true; this._payload = payload; }
            else { this._isPro = false; this._payload = null; }
        } catch {
            this._isPro = false;
        }
    },

    /**
     * 激活：验签通过则持久化
     * @param {string} licStr 用户粘贴的许可证字符串
     * @returns {Promise<object>} payload
     */
    async activate(licStr) {
        const s = String(licStr || '').trim();
        if (!s) throw new Error('请输入许可证密钥');
        const mid = await this.getMachineId();
        const payload = await _verify(s, mid);
        if (!payload) throw new Error('密钥无效、已过期，或与本设备不匹配');
        await chrome.storage.local.set({ [_LIC_KEY]: s });
        this._isPro = true;
        this._payload = payload;
        return payload;
    },

    /** 解除本设备激活 */
    async deactivate() {
        await chrome.storage.local.remove(_LIC_KEY);
        this._isPro = false;
        this._payload = null;
    },

    /** 获取/生成稳定机器标识（也作为绑定取件码） */
    async getMachineId() {
        const got = await chrome.storage.local.get(_MID_KEY);
        if (got[_MID_KEY]) return got[_MID_KEY];
        const mid = (crypto.randomUUID && crypto.randomUUID()) ||
            (Date.now() + '-' + Math.random().toString(16).slice(2));
        await chrome.storage.local.set({ [_MID_KEY]: mid });
        return mid;
    },

    // ── UI ──

    /**
     * 弹出升级页（点击 PRO 功能时调用）
     * @param {string} featureName 触发的功能名，如 '直播录制'
     */
    showUpgradePrompt(featureName) {
        this._openDialog({ mode: 'upgrade', featureName });
    },

    /** 许可证状态/管理对话框（点击标题栏 PRO 按钮时调用）*/
    showStatusDialog() {
        this._openDialog({ mode: this.isPro ? 'status' : 'upgrade' });
    },

    /**
     * 在标题栏创建 PRO 状态按钮
     * @param {boolean} isDarkMode
     */
    createLicenseBtn(isDarkMode) {
        const btn = document.createElement('div');
        btn.className = 'dylh-lic-btn';
        this._refreshLicBtn(btn);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showStatusDialog();
        });
        return btn;
    },

    _refreshLicBtn(btn) {
        if (this.isPro) {
            btn.setAttribute('title', 'PRO 已激活 — 点击管理授权');
            btn.innerHTML = `<span class="dylh-lic-badge-pro">✓ PRO</span>`;
        } else {
            btn.setAttribute('title', '点击激活 PRO 授权');
            btn.innerHTML = `<span class="dylh-lic-badge-free">激活 PRO</span>`;
        }
    },

    // ── 对话框内部实现 ──

    _openDialog({ mode, featureName }) {
        if (document.getElementById('dylh-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'dylh-overlay';
        overlay.className = 'dylh-dialog-overlay';

        if (mode === 'status') {
            overlay.innerHTML = this._statusHTML();
        } else {
            overlay.innerHTML = this._upgradeHTML(featureName);
        }

        document.body.appendChild(overlay);
        this._bindDialog(overlay);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    },

    /** 升级页 HTML（含权益对比表 + 价格卡 + 激活框）*/
    _upgradeHTML(featureName) {
        const tip = featureName
            ? `<div class="dylh-dialog-title">🔒 「${featureName}」是 PRO 专属功能</div>`
            : `<div class="dylh-dialog-title">解锁 PRO，看播更强大</div>`;
        return `
            <div class="dylh-dialog-box dylh-box-wide">
                <div class="dylh-dialog-pro-badge">PRO</div>
                ${tip}
                ${this._benefitTableHTML()}
                ${this._pricingHTML()}
                <div class="dylh-dialog-input-row">
                    <input id="dylh-lic-input" class="dylh-dialog-input" type="text"
                        placeholder="已购买？在此粘贴许可证密钥激活" spellcheck="false" autocomplete="off" />
                    <button id="dylh-activate-btn" class="dylh-dialog-btn-primary">激活</button>
                </div>
                <div id="dylh-msg" class="dylh-dialog-msg"></div>
                <div class="dylh-dialog-hint">
                    购买请联系微信 <b>${LICENSE.CONTACT_WECHAT}</b>
                    ${LICENSE.BUY_URL ? `· 或前往 <a href="${LICENSE.BUY_URL}" target="_blank" class="dylh-dialog-link">购买页</a>` : ''}
                    <button id="dylh-show-mid" class="dylh-dialog-linkbtn">查看本机标识</button>
                </div>
                <button id="dylh-close-btn" class="dylh-dialog-close">×</button>
            </div>
        `;
    },

    /** 已激活状态页 HTML */
    _statusHTML() {
        const planMap = { month: '月付', year: '年付', lifetime: '永久买断' };
        const planStr = planMap[this.plan] || 'PRO';
        const expStr = (this.plan === 'lifetime' || !this.expiresAt)
            ? '永久'
            : new Date(this.expiresAt).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
        return `
            <div class="dylh-dialog-box">
                <div class="dylh-dialog-pro-badge">PRO</div>
                <div class="dylh-dialog-title">✓ 已激活 PRO</div>
                <div class="dylh-dialog-kv">
                    <span class="dylh-kv-label">套餐</span><span class="dylh-kv-val">${planStr}</span>
                    <span class="dylh-kv-label">到期</span><span class="dylh-kv-val">${expStr}</span>
                </div>
                <div class="dylh-dialog-btn-row" style="margin-top:20px">
                    <button id="dylh-deactivate-btn" class="dylh-dialog-btn-danger">解除本设备激活</button>
                    <button id="dylh-close-btn2" class="dylh-dialog-btn-secondary">关闭</button>
                </div>
                <div id="dylh-msg" class="dylh-dialog-msg"></div>
                <div class="dylh-dialog-hint">解除后可在其他设备重新激活同一密钥</div>
                <button id="dylh-close-btn" class="dylh-dialog-close">×</button>
            </div>
        `;
    },

    /** 免费 vs PRO 权益对比表（PRO 拆细条目以显超值）*/
    _benefitTableHTML() {
        const free = [
            '关注主播开播一览（卡片式列表）',
            '搜索 · 人气排序 · 深色模式自适应',
            '悬停即可预览，无需逐个点进直播间',
            '大屏预览 · 全屏 · 三联屏镜像',
            '声音开关 · 音量记忆 · 特别关心（无限）',
            '🚫 天然无广告，无打赏/消费引导弹窗',
            '🪟 清爽安静地浏览你关注的直播',
        ];
        const pro = [
            '多路对比预览（2–3 个不同主播同屏）',
            '大屏单路录制',
            '对比模式下每路独立录制',
            '多路合并录制（三画面合成一个文件 + 混音）',
            '高码率清晰画质 · 意外关闭自动保存',
            'TTS 氛围词条 + 语音播报',
        ];
        const freeLi = free.map(t => `<li>${t}</li>`).join('');
        const proLi = pro.map(t => `<li>${t}</li>`).join('');
        return `
            <div class="dylh-compare">
                <div class="dylh-compare-col dylh-col-free">
                    <div class="dylh-compare-head">免费版</div>
                    <ul class="dylh-compare-list">${freeLi}</ul>
                </div>
                <div class="dylh-compare-col dylh-col-pro">
                    <div class="dylh-compare-head">PRO <span class="dylh-col-pro-tag">含免费版全部</span></div>
                    <ul class="dylh-compare-list dylh-list-pro">${proLi}</ul>
                </div>
            </div>
        `;
    },

    /** 三档价格卡 */
    _pricingHTML() {
        const P = LICENSE.PRICING;
        const card = (k) => {
            const it = P[k];
            return `
                <div class="dylh-price-card${it.best ? ' dylh-price-best' : ''}">
                    ${it.best ? '<div class="dylh-price-flag">最划算</div>' : ''}
                    <div class="dylh-price-label">${it.label}</div>
                    <div class="dylh-price-num">${it.price}</div>
                    <div class="dylh-price-note">${it.note}</div>
                </div>`;
        };
        return `<div class="dylh-pricing">${card('month')}${card('year')}${card('lifetime')}</div>`;
    },

    /** 绑定对话框内的按钮事件 */
    _bindDialog(overlay) {
        const close = () => overlay.remove();
        overlay.querySelector('#dylh-close-btn')?.addEventListener('click', close);
        overlay.querySelector('#dylh-close-btn2')?.addEventListener('click', close);

        const msgEl = overlay.querySelector('#dylh-msg');
        const setMsg = (t, type) => {
            if (!msgEl) return;
            msgEl.textContent = t;
            msgEl.className = `dylh-dialog-msg${type ? ' dylh-msg-' + type : ''}`;
        };

        // 激活
        const activateBtn = overlay.querySelector('#dylh-activate-btn');
        const input = overlay.querySelector('#dylh-lic-input');
        const doActivate = async () => {
            const v = input?.value?.trim();
            if (!v) { setMsg('请输入许可证密钥', 'error'); return; }
            activateBtn.disabled = true;
            activateBtn.textContent = '激活中…';
            try {
                await this.activate(v);
                setMsg('✓ 激活成功！PRO 功能已全部解锁', 'success');
                document.querySelectorAll('.dylh-lic-btn').forEach(b => this._refreshLicBtn(b));
                setTimeout(close, 1400);
            } catch (err) {
                setMsg('✗ ' + err.message, 'error');
                activateBtn.disabled = false;
                activateBtn.textContent = '激活';
            }
        };
        activateBtn?.addEventListener('click', doActivate);
        input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doActivate(); });

        // 查看本机标识（机器绑定模式下发给店主）
        overlay.querySelector('#dylh-show-mid')?.addEventListener('click', async () => {
            const mid = await this.getMachineId();
            setMsg('本机标识：' + mid + '（已复制，可发给店主绑定）', 'success');
            try { await navigator.clipboard.writeText(mid); } catch {}
        });

        // 解除激活
        overlay.querySelector('#dylh-deactivate-btn')?.addEventListener('click', async () => {
            if (!confirm('确认解除本设备激活？解除后 PRO 功能将不可用（密钥可在其他设备重新激活）')) return;
            await this.deactivate();
            close();
            document.querySelectorAll('.dylh-lic-btn').forEach(b => this._refreshLicBtn(b));
        });
    }
};
