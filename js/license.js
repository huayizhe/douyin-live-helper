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

    /**
     * 由稳定的浏览器/硬件信号确定性派生设备指纹（SHA-256 取前 32 位 hex）。
     * 不依赖任何随机数与持久化，故卸载重装后能再次算出**同一个**值。
     */
    async _computeFingerprint() {
        const n = navigator || {};
        const s = (typeof window !== 'undefined' && window.screen) || {};
        let tz = '';
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) {}
        const parts = [
            n.platform || '',
            n.hardwareConcurrency || '',
            n.deviceMemory || '',
            (s.width || '') + 'x' + (s.height || '') + 'x' + (s.colorDepth || ''),
            n.language || '',
            tz,
            n.maxTouchPoints || ''
        ].join('|');
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
        const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        return 'fp-' + hex.slice(0, 32);
    },

    /**
     * 获取/生成稳定机器标识（也作为绑定取件码）。
     * 先读 local 缓存（reload 快路径）；缺失时由设备指纹**确定性派生**（而非随机），
     * 故卸载重装后能再次算出同一标识 → 旧激活码继续匹配，重新粘贴即可激活。
     */
    async getMachineId() {
        const got = await chrome.storage.local.get(_MID_KEY);
        if (got[_MID_KEY]) return got[_MID_KEY];
        let mid;
        try { mid = await this._computeFingerprint(); }
        catch (_) { mid = 'rnd-' + Date.now() + '-' + Math.random().toString(16).slice(2); }
        await chrome.storage.local.set({ [_MID_KEY]: mid });
        return mid;
    },

    // ── 在线购买（需配置 LICENSE.SERVER）──

    /** 创建订单 → { orderId, qrDataUrl, amount, plan } */
    async createOrder(plan) {
        const mid = await this.getMachineId();
        const resp = await fetch(`${LICENSE.SERVER}/api/order/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan, machineId: mid }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || '下单失败，请稍后重试');
        return body;
    },

    _pollTimer: null,
    /** 轮询订单状态，支付成功自动激活；最多 5 分钟 */
    pollOrder(orderId, onResult) {
        const deadline = Date.now() + 5 * 60 * 1000;
        const tick = async () => {
            if (Date.now() > deadline) { onResult({ timeout: true }); return; }
            try {
                const resp = await fetch(`${LICENSE.SERVER}/api/order/status?orderId=${encodeURIComponent(orderId)}`);
                const body = await resp.json().catch(() => ({}));
                if (body.status === 'paid' && body.license) {
                    await this.activate(body.license);
                    onResult({ paid: true });
                    return;
                }
            } catch { /* 网络抖动，继续轮询 */ }
            this._pollTimer = setTimeout(tick, 2500);
        };
        tick();
    },

    stopPoll() {
        if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    },

    /** 换绑到本设备：用旧许可证向服务器换发绑定本机的新许可证 */
    async rebindToThisDevice(oldLicense) {
        const mid = await this.getMachineId();
        const resp = await fetch(`${LICENSE.SERVER}/api/rebind`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ license: oldLicense, newMachineId: mid }),
        });
        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(body.error || '换绑失败');
        await this.activate(body.license);
        return body;
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
            const days = this.expiresAt ? Math.ceil((this.expiresAt - Date.now()) / 86400000) : null;
            const soon = days !== null && this.plan !== 'lifetime' && days <= 7;
            btn.setAttribute('title', soon ? `PRO 将在 ${days} 天后到期，点击续费` : 'PRO 已激活 — 点击管理授权');
            btn.innerHTML = soon
                ? `<span class="dylh-lic-badge-pro dylh-badge-soon">PRO · 剩${days}天</span>`
                : `<span class="dylh-lic-badge-pro">✓ PRO</span>`;
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

    /** 升级页 HTML（权益对比 + 套餐选择/扫码购买 + 手动激活兜底）*/
    _upgradeHTML(featureName) {
        const tip = featureName
            ? `<div class="dylh-dialog-title">🔒 「${featureName}」是 PRO 专属功能</div>`
            : `<div class="dylh-dialog-title">解锁 PRO，看播更强大</div>`;
        const hasServer = !!LICENSE.SERVER;
        const buyArea = hasServer
            ? `<button id="dylh-buy-btn" class="dylh-dialog-btn-primary dylh-btn-block">立即开通</button>`
            : `<div class="dylh-dialog-hint">在线购买暂未开通，请联系微信 <b>${LICENSE.CONTACT_WECHAT}</b> 获取激活码${LICENSE.BUY_URL ? ` · 或前往 <a href="${LICENSE.BUY_URL}" target="_blank" class="dylh-dialog-link">购买页</a>` : ''}</div>`;
        return `
            <div class="dylh-dialog-box dylh-box-wide">
                <div class="dylh-dialog-pro-badge">PRO</div>
                ${tip}
                ${this._benefitTableHTML()}
                <div id="dylh-buy-view">
                    ${this._pricingHTML()}
                    ${buyArea}
                    <div class="dylh-activate-fold">
                        <details>
                            <summary>已有激活码？点此手动激活</summary>
                            <div class="dylh-dialog-input-row" style="margin-top:10px">
                                <input id="dylh-lic-input" class="dylh-dialog-input" type="text"
                                    placeholder="粘贴许可证密钥" spellcheck="false" autocomplete="off" />
                                <button id="dylh-activate-btn" class="dylh-dialog-btn-primary">激活</button>
                            </div>
                            <button id="dylh-show-mid" class="dylh-dialog-linkbtn">查看本机标识（换绑/绑定用）</button>
                        </details>
                    </div>
                </div>
                <div id="dylh-qr-view" style="display:none">
                    <div class="dylh-qr-wrap">
                        <img id="dylh-qr-img" class="dylh-qr-img" alt="支付二维码" />
                        <div class="dylh-qr-amount" id="dylh-qr-amount"></div>
                        <div class="dylh-qr-tip">请用微信 / 支付宝扫码支付<br>支付成功后<b>自动开通</b>，无需任何手动操作</div>
                        <div id="dylh-qr-status" class="dylh-qr-status">等待支付中…</div>
                        <button id="dylh-qr-cancel" class="dylh-dialog-btn-secondary">取消</button>
                    </div>
                </div>
                <div id="dylh-msg" class="dylh-dialog-msg"></div>
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
                    ${this.plan !== 'lifetime' ? `<button id="dylh-renew-btn" class="dylh-dialog-btn-primary">立即续费</button>` : ''}
                    <button id="dylh-deactivate-btn" class="dylh-dialog-btn-danger">解除本设备激活</button>
                </div>
                <div id="dylh-msg" class="dylh-dialog-msg"></div>
                <div class="dylh-dialog-hint">换新设备？在新设备「激活 PRO」里粘贴本授权即可自动换绑</div>
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

    /** 三档价格卡（可点击单选，默认年付高亮） */
    _pricingHTML() {
        const P = LICENSE.PRICING;
        const card = (k) => {
            const it = P[k];
            return `
                <div class="dylh-price-card${it.best ? ' dylh-price-best dylh-price-selected' : ''}" data-plan="${k}">
                    ${it.best ? '<div class="dylh-price-flag">最划算</div>' : ''}
                    <div class="dylh-price-check">✓</div>
                    <div class="dylh-price-label">${it.label}</div>
                    <div class="dylh-price-num">${it.price}</div>
                    <div class="dylh-price-note">${it.note}</div>
                </div>`;
        };
        return `<div class="dylh-pricing">${card('month')}${card('year')}${card('lifetime')}</div>`;
    },

    /** 绑定对话框内的按钮事件 */
    _bindDialog(overlay) {
        const close = () => { this.stopPoll(); overlay.remove(); };
        overlay.querySelector('#dylh-close-btn')?.addEventListener('click', close);

        const msgEl = overlay.querySelector('#dylh-msg');
        const setMsg = (t, type) => {
            if (!msgEl) return;
            msgEl.textContent = t;
            msgEl.className = `dylh-dialog-msg${type ? ' dylh-msg-' + type : ''}`;
        };
        const refreshBadges = () => document.querySelectorAll('.dylh-lic-btn').forEach(b => this._refreshLicBtn(b));

        // ── 套餐单选（默认年付高亮）──
        let selectedPlan = 'year';
        const cards = overlay.querySelectorAll('.dylh-price-card');
        cards.forEach(c => c.addEventListener('click', () => {
            cards.forEach(x => x.classList.remove('dylh-price-selected'));
            c.classList.add('dylh-price-selected');
            selectedPlan = c.getAttribute('data-plan');
        }));

        // ── 立即开通：下单 → 弹码 → 轮询自动激活 ──
        const buyBtn = overlay.querySelector('#dylh-buy-btn');
        buyBtn?.addEventListener('click', async () => {
            buyBtn.disabled = true;
            buyBtn.textContent = '生成支付码…';
            try {
                const order = await this.createOrder(selectedPlan);
                overlay.querySelector('#dylh-buy-view').style.display = 'none';
                const qrView = overlay.querySelector('#dylh-qr-view');
                qrView.style.display = 'block';
                overlay.querySelector('#dylh-qr-img').src = order.qrDataUrl;
                overlay.querySelector('#dylh-qr-amount').textContent = '¥' + (order.amount / 100).toFixed(2);
                const statusEl = overlay.querySelector('#dylh-qr-status');
                this.pollOrder(order.orderId, (r) => {
                    if (r.paid) {
                        statusEl.textContent = '✓ 支付成功，已开通 PRO！';
                        statusEl.className = 'dylh-qr-status dylh-msg-success';
                        refreshBadges();
                        setTimeout(close, 1600);
                    } else if (r.timeout) {
                        statusEl.textContent = '支付超时，请重试';
                        statusEl.className = 'dylh-qr-status dylh-msg-error';
                    }
                });
            } catch (err) {
                setMsg('✗ ' + err.message, 'error');
                buyBtn.disabled = false;
                buyBtn.textContent = '立即开通';
            }
        });

        // 取消支付 → 回到套餐视图
        overlay.querySelector('#dylh-qr-cancel')?.addEventListener('click', () => {
            this.stopPoll();
            overlay.querySelector('#dylh-qr-view').style.display = 'none';
            overlay.querySelector('#dylh-buy-view').style.display = 'block';
            if (buyBtn) { buyBtn.disabled = false; buyBtn.textContent = '立即开通'; }
        });

        // ── 手动激活（兜底）；换设备时自动尝试换绑到本机 ──
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
                refreshBadges();
                setTimeout(close, 1400);
            } catch (err) {
                // 可能是换了设备（机器不符）。服务器可用时尝试自动换绑到本机
                if (LICENSE.SERVER) {
                    try {
                        await this.rebindToThisDevice(v);
                        setMsg('✓ 已换绑到本设备并激活！', 'success');
                        refreshBadges();
                        setTimeout(close, 1400);
                        return;
                    } catch (e2) {
                        setMsg('✗ ' + e2.message, 'error');
                        activateBtn.disabled = false;
                        activateBtn.textContent = '激活';
                        return;
                    }
                }
                setMsg('✗ ' + err.message, 'error');
                activateBtn.disabled = false;
                activateBtn.textContent = '激活';
            }
        };
        activateBtn?.addEventListener('click', doActivate);
        input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doActivate(); });

        // 查看本机标识
        overlay.querySelector('#dylh-show-mid')?.addEventListener('click', async (e) => {
            e.preventDefault();
            const mid = await this.getMachineId();
            setMsg('本机标识：' + mid + '（已复制）', 'success');
            try { await navigator.clipboard.writeText(mid); } catch {}
        });

        // 续费（状态弹窗）→ 打开购买
        overlay.querySelector('#dylh-renew-btn')?.addEventListener('click', () => {
            close();
            this.showUpgradePrompt();
        });

        // 解除激活（状态弹窗）
        overlay.querySelector('#dylh-deactivate-btn')?.addEventListener('click', async () => {
            if (!confirm('确认解除本设备激活？解除后 PRO 功能将不可用（可在其他设备重新激活/换绑）')) return;
            await this.deactivate();
            close();
            refreshBadges();
        });
    }
};
