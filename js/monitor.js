/**
 * 资源监控模块（重做）
 *
 * 面向生产环境性能排查：只展示**真实/可计算**的指标，估算项明确标注。
 * 聚焦真正的性能/OOM 驱动因子——活跃 HLS 实例数（带宽/媒体内存主因）、加载并发、
 * 片段缓存真实字节、video 元素数。提供一键「复制诊断」便于用户反馈。
 *
 * 重要：performance.memory 只反映 **JS 堆**，不含视频解码/MSE 内存（OOM 常来自后者），面板已注明。
 */

import { Logger } from './logger.js';
import { DOMUtils, StyleUtils } from './utils.js';
import { PreloadManager } from './preload.js';
import { PreviewManager } from './preview.js';
import { ToastManager } from './toast.js';
import { TOAST } from './constants.js';

export const ResourceMonitor = {
    panel: null,
    isVisible: false,
    timer: null,

    // 最近一次快照 + 趋势历史（环形，仅面板可见时采样）
    last: null,
    history: [],          // [{ ts, heapUsed, hlsTotal }]
    maxHistory: 60,

    // 阈值
    TH: { heapWarn: 60, heapBad: 80, hlsWarn: 8, hlsBad: 12 },

    // chrome.storage 真实占用（异步取，缓存于此）
    _storage: { local: 0, sync: 0 },

    /**
     * 异步取 chrome.storage 真实字节（氛围词条=local、特别关心/设置=sync）
     * @private
     */
    _fetchStorageBytes() {
        try {
            if (chrome?.storage?.local?.getBytesInUse) {
                chrome.storage.local.getBytesInUse(null).then(b => { this._storage.local = b || 0; }).catch(() => {});
            }
            if (chrome?.storage?.sync?.getBytesInUse) {
                chrome.storage.sync.getBytesInUse(null).then(b => { this._storage.sync = b || 0; }).catch(() => {});
            }
        } catch (_) {}
    },

    init() {
        if (!this.panel) this.createMonitorPanel();
    },

    /**
     * 采集一次真实快照（不依赖假估算）。
     * @private
     */
    sample() {
        const pm = PreloadManager.getStats();
        const vm = PreviewManager.getHlsStats();

        const heap = performance.memory ? {
            used: performance.memory.usedJSHeapSize,
            total: performance.memory.totalJSHeapSize,
            limit: performance.memory.jsHeapSizeLimit
        } : null;

        // 活跃 HLS 合计 = 片段加载中(每路1个) + 悬浮 + 大屏 + 对比
        const hls = {
            loading: pm.loading,
            hover: vm.hover,
            full: vm.full,
            compare: vm.compare,
            total: pm.loading + vm.hover + vm.full + vm.compare
        };

        // 媒体缓冲代理（精确解码/GPU 内存无 JS API）：我方视频已缓冲秒数 + 解码视频数
        const ours = document.querySelectorAll('.live-preview video, #dy-preview-container video, #dy-compare-modal video');
        let bufferedSec = 0, decoding = 0;
        ours.forEach(v => {
            try {
                if (v.buffered && v.buffered.length) bufferedSec += v.buffered.end(v.buffered.length - 1) - v.buffered.start(0);
                if (v.readyState >= 2 && !v.paused) decoding++;
            } catch (_) {}
        });

        // chrome.storage 真实占用（异步刷新缓存）
        this._fetchStorageBytes();

        const snap = {
            ts: Date.now(),
            heap,
            hls,
            videoTotal: document.querySelectorAll('video').length,
            loopVideos: pm.loopVideos,
            loading: pm.loading,
            queued: pm.queued,
            maxConcurrent: pm.maxConcurrent,
            pauseReasons: pm.pauseReasons,
            cached: pm.cached,
            maxCache: pm.maxCache,
            cacheBytes: pm.cacheBytes,
            previewCount: vm.previewCacheCount,
            previewBytes: vm.previewCacheBytes,
            media: { bufferedSec, decoding, count: ours.length },
            storage: { local: this._storage.local, sync: this._storage.sync },
            cores: navigator.hardwareConcurrency || 0
        };
        this.last = snap;

        this.history.push({ ts: snap.ts, heapUsed: heap ? heap.used : 0, hlsTotal: hls.total });
        if (this.history.length > this.maxHistory) this.history.shift();

        return snap;
    },

    /**
     * 颜色阈值
     * @private
     */
    color(value, warn, bad) {
        if (value >= bad) return '#ff4d4f';
        if (value >= warn) return '#faad14';
        return '#52c41a';
    },

    /**
     * 刷新面板显示
     * @private
     */
    render() {
        if (!this.panel || !this.last) return;
        const s = this.last;
        const dark = StyleUtils.isDarkMode();
        const sub = dark ? '#aaa' : '#888';
        const heapPct = s.heap ? (s.heap.used / s.heap.limit * 100) : 0;

        // ① 健康概览（三个带色大数字）
        const big = (label, val, color, unit = '') => `
            <div style="flex:1;text-align:center;">
                <div style="font-size:24px;font-weight:bold;color:${color};line-height:1.1;">${val}${unit}</div>
                <div style="font-size:12px;color:${sub};margin-top:4px;">${label}</div>
            </div>`;
        this.panel.querySelector('.mon-overview').innerHTML =
            big('JS堆使用率', s.heap ? heapPct.toFixed(0) : '—', this.color(heapPct, this.TH.heapWarn, this.TH.heapBad), s.heap ? '%' : '') +
            big('活跃HLS', s.hls.total, this.color(s.hls.total, this.TH.hlsWarn, this.TH.hlsBad)) +
            big('加载中', s.loading, this.color(s.loading, s.maxConcurrent, s.maxConcurrent + 1));

        // ② JS 堆
        this.panel.querySelector('.mon-heap').innerHTML = s.heap ? `
            <div>已用：${this.fmt(s.heap.used)} ／ 总量：${this.fmt(s.heap.total)} ／ 限制：${this.fmt(s.heap.limit)}</div>
            <div>使用率：<b style="color:${this.color(heapPct, this.TH.heapWarn, this.TH.heapBad)}">${heapPct.toFixed(1)}%</b></div>
            <div style="color:${sub};font-size:12px;margin-top:4px;">⚠️ 仅 JS 堆，<b>不含视频解码/MSE 内存</b>（崩溃常来自后者，需结合「活跃HLS/video数」判断）</div>
        ` : `<div style="color:${sub}">该浏览器不支持 performance.memory（非 Chrome 内核）</div>`;

        // ③ 直播资源
        this.panel.querySelector('.mon-live').innerHTML = `
            <div>活跃 HLS 合计：<b style="color:${this.color(s.hls.total, this.TH.hlsWarn, this.TH.hlsBad)}">${s.hls.total}</b>
                <span style="color:${sub}">（加载 ${s.hls.loading} ／ 悬浮 ${s.hls.hover} ／ 大屏 ${s.hls.full} ／ 对比 ${s.hls.compare}）</span></div>
            <div>&lt;video&gt; 元素：${s.videoTotal} <span style="color:${sub}">（含抖音自身；我方循环视频 ${s.loopVideos}）</span></div>
            <div>片段加载：进行中 ${s.loading} ／ 排队 ${s.queued} ／ 并发上限 ${s.maxConcurrent}</div>
            <div>暂停状态：${s.pauseReasons.length ? s.pauseReasons.join('、') : '无'}</div>
            <div>媒体缓冲（估算）：${s.media.bufferedSec.toFixed(0)}s ／ 解码中 ${s.media.decoding} 路
                <span style="color:${sub}">（精确解码/GPU 内存无 JS API，此为代理）</span></div>
        `;

        // ④ 缓存
        this.panel.querySelector('.mon-cache').innerHTML = `
            <div>循环片段缓存：${s.cached} / ${s.maxCache} 个，真实占用 <b>${this.fmt(s.cacheBytes)}</b></div>
            <div>截图缓存：${s.previewCount} 个 <span style="color:${sub}">（估算 ${this.fmt(s.previewBytes)}）</span></div>
            <div style="color:${sub};font-size:12px;margin-top:4px;">注：缓存数≠播放数——离屏卡片保留 blob、移除 video 释放解码。</div>
        `;

        // ⑤ 持久化存储（chrome.storage：磁盘 + 内存缓存）
        this.panel.querySelector('.mon-storage').innerHTML = `
            <div>氛围词条（storage.local）：<b>${this.fmt(s.storage.local)}</b></div>
            <div>特别关心/设置（storage.sync）：<b>${this.fmt(s.storage.sync)}</b> <span style="color:${sub}">（sync 单项上限 8KB、总 100KB）</span></div>
            <div style="color:${sub};font-size:12px;margin-top:4px;">存于 chrome.storage（磁盘）+ 一份内存缓存。氛围词条按主播数 × 文本长度增长。</div>
        `;

        // ⑥ 设备
        this.panel.querySelector('.mon-device').innerHTML = `
            <div>逻辑核数：${s.cores || '未知'} <span style="color:${sub}">（并发上限据此自适应为 ${s.maxConcurrent}）</span></div>
        `;

        this.drawSparkline();
    },

    /**
     * 趋势 sparkline：JS堆使用（蓝）+ 活跃HLS（橙）
     * @private
     */
    drawSparkline() {
        const canvas = this.panel.querySelector('.mon-spark');
        if (!canvas || this.history.length < 2) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth, h = canvas.clientHeight;
        canvas.width = w * dpr; canvas.height = h * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const pts = this.history;
        const n = pts.length;
        const line = (getY, max, stroke) => {
            ctx.beginPath();
            pts.forEach((p, i) => {
                const x = (i / (this.maxHistory - 1)) * w;
                const y = h - Math.min(1, getY(p) / max) * (h - 4) - 2;
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        };
        // JS堆：归一到当前 limit；HLS：归一到 16（够用的上限刻度）
        const limit = (this.last && this.last.heap) ? this.last.heap.limit : 1;
        line(p => p.heapUsed, limit, '#1890ff');
        line(p => p.hlsTotal, 16, '#fa8c16');
    },

    /**
     * 生成纯文本诊断报告（供用户复制反馈）
     * @private
     */
    buildDiagnostics() {
        const s = this.last || this.sample();
        const heap = s.heap
            ? `${this.fmt(s.heap.used)} / 限 ${this.fmt(s.heap.limit)} (${(s.heap.used / s.heap.limit * 100).toFixed(1)}%)`
            : '不支持';
        return [
            `[抖音关注直播助手 诊断] ${new Date(s.ts).toLocaleString()}`,
            `UA: ${navigator.userAgent}`,
            `核数: ${s.cores}  并发上限: ${s.maxConcurrent}`,
            `JS堆(不含媒体内存): ${heap}`,
            `活跃HLS: ${s.hls.total} (加载${s.hls.loading}/悬浮${s.hls.hover}/大屏${s.hls.full}/对比${s.hls.compare})`,
            `<video>元素: ${s.videoTotal} (我方循环 ${s.loopVideos})  媒体缓冲~${s.media.bufferedSec.toFixed(0)}s/解码${s.media.decoding}`,
            `片段加载: 进行中${s.loading} 排队${s.queued}  暂停: ${s.pauseReasons.join(',') || '无'}`,
            `片段缓存: ${s.cached}/${s.maxCache} (${this.fmt(s.cacheBytes)})  截图缓存: ${s.previewCount} (~${this.fmt(s.previewBytes)})`,
            `存储: local ${this.fmt(s.storage.local)} / sync ${this.fmt(s.storage.sync)}`
        ].join('\n');
    },

    /**
     * 复制诊断到剪贴板
     * @private
     */
    async copyDiagnostics() {
        const text = this.buildDiagnostics();
        try {
            await navigator.clipboard.writeText(text);
            ToastManager.show('诊断信息已复制，可粘贴反馈', TOAST.TYPE.SUCCESS);
        } catch (_) {
            // 回退：临时 textarea
            try {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
                ToastManager.show('诊断信息已复制，可粘贴反馈', TOAST.TYPE.SUCCESS);
            } catch (e) {
                Logger.error('复制诊断失败:', e);
                ToastManager.show('复制失败，请手动截图', TOAST.TYPE.ERROR);
            }
        }
    },

    /**
     * 创建监控面板
     * @private
     */
    createMonitorPanel() {
        const dark = StyleUtils.isDarkMode();
        this.panel = DOMUtils.createElement('div', {
            className: 'resource-monitor-panel',
            styles: {
                position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                width: '560px', maxHeight: '86vh', background: dark ? '#1f1f1f' : '#fff',
                borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)', zIndex: 20002,
                display: 'none', flexDirection: 'column', color: dark ? '#fff' : '#000',
                fontSize: '13px'
            }
        });

        this.panel.innerHTML = `
            <div class="mon-header" style="padding:14px 18px;border-bottom:1px solid ${dark ? '#333' : '#eee'};display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none;">
                <h3 style="margin:0;font-size:16px;">资源监控 <span style="font-size:11px;color:${dark ? '#888' : '#999'};font-weight:normal;">（可拖动）</span></h3>
                <button class="mon-close" style="background:none;border:none;cursor:pointer;padding:4px;color:${dark ? '#fff' : '#000'};">✕</button>
            </div>
            <div style="padding:16px 18px;overflow-y:auto;">
                <div class="mon-overview" style="display:flex;gap:8px;margin-bottom:16px;"></div>
                <canvas class="mon-spark" style="width:100%;height:56px;display:block;margin-bottom:6px;"></canvas>
                <div style="font-size:11px;color:${dark ? '#888' : '#999'};margin-bottom:16px;">趋势：<span style="color:#1890ff">▮</span> JS堆　<span style="color:#fa8c16">▮</span> 活跃HLS（线持续上扬＝可能泄漏）</div>

                <div class="mon-sec"><h4>JS 堆内存</h4><div class="mon-box mon-heap"></div></div>
                <div class="mon-sec"><h4>直播资源（实时驱动）</h4><div class="mon-box mon-live"></div></div>
                <div class="mon-sec"><h4>缓存</h4><div class="mon-box mon-cache"></div></div>
                <div class="mon-sec"><h4>持久化存储</h4><div class="mon-box mon-storage"></div></div>
                <div class="mon-sec"><h4>设备</h4><div class="mon-box mon-device"></div></div>

                <button class="mon-copy" style="margin-top:8px;width:100%;padding:10px;border:none;border-radius:6px;
                    background:#1890ff;color:#fff;font-size:14px;cursor:pointer;">复制诊断信息</button>
            </div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            .resource-monitor-panel .mon-sec { margin-bottom: 14px; }
            .resource-monitor-panel .mon-sec h4 { margin:0 0 8px 0; font-size:13px; color:${dark ? '#aaa' : '#666'}; }
            .resource-monitor-panel .mon-box { background:${dark ? '#2a2a2a' : '#f6f6f6'}; padding:10px 12px; border-radius:6px; line-height:1.7; }
        `;
        document.head.appendChild(style);

        this.panel.querySelector('.mon-close').onclick = () => this.hidePanel();
        this.panel.querySelector('.mon-copy').onclick = () => this.copyDiagnostics();
        this._setupDrag(this.panel.querySelector('.mon-header'));
        document.body.appendChild(this.panel);
    },

    /**
     * 表头拖拽移动面板（首次拖动把 transform 居中换成 left/top 绝对定位）
     * @private
     */
    _setupDrag(handle) {
        if (!handle) return;
        let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
        const onMove = (e) => {
            if (!dragging) return;
            this.panel.style.left = (ox + e.clientX - sx) + 'px';
            this.panel.style.top = (oy + e.clientY - sy) + 'px';
        };
        const onUp = () => {
            dragging = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('.mon-close')) return;
            const r = this.panel.getBoundingClientRect();
            this.panel.style.transform = 'none';
            this.panel.style.left = r.left + 'px';
            this.panel.style.top = r.top + 'px';
            dragging = true; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
        });
    },

    /**
     * 显示面板（启动 1s 采样）
     */
    showPanel() {
        if (!this.panel) this.createMonitorPanel();
        this.panel.style.display = 'flex';
        this.isVisible = true;
        this.sample();
        this.render();
        clearInterval(this.timer);
        this.timer = setInterval(() => { this.sample(); this.render(); }, 1000);
    },

    /**
     * 隐藏面板（停止采样，省开销）
     */
    hidePanel() {
        if (this.panel) this.panel.style.display = 'none';
        this.isVisible = false;
        clearInterval(this.timer);
        this.timer = null;
    },

    /**
     * 字节格式化
     * @private
     */
    fmt(bytes) {
        if (!bytes) return '0 B';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    }
};
