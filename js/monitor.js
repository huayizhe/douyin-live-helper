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
            recording: pm.recording,
            maxRecord: pm.maxRecord,
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
        const sub = dark ? '#8a8f99' : '#9aa0a6';
        const heapPct = s.heap ? (s.heap.used / s.heap.limit * 100) : 0;

        // 键值行：label 左（muted）…… value 右（等宽、可染色）
        const row = (label, value, valColor) =>
            `<div class="mon-row"><span class="mon-k">${label}</span><span class="mon-v"${valColor ? ` style="color:${valColor}"` : ''}>${value}</span></div>`;
        const note = (text) => `<div class="mon-note">${text}</div>`;

        // ① 健康概览（三张 stat 卡）
        const stat = (label, val, color, unit = '') => `
            <div class="mon-stat">
                <div class="mon-stat-v" style="color:${color}">${val}<span class="mon-stat-u">${unit}</span></div>
                <div class="mon-stat-l">${label}</div>
            </div>`;
        this.panel.querySelector('.mon-overview').innerHTML =
            stat('JS 堆使用率', s.heap ? heapPct.toFixed(0) : '—', this.color(heapPct, this.TH.heapWarn, this.TH.heapBad), s.heap ? '%' : '') +
            stat('活跃 HLS', s.hls.total, this.color(s.hls.total, this.TH.hlsWarn, this.TH.hlsBad)) +
            stat('加载中', s.loading, this.color(s.loading, s.maxConcurrent, s.maxConcurrent + 1));

        // ② JS 堆
        this.panel.querySelector('.mon-heap').innerHTML = s.heap
            ? row('已用 / 总量', `${this.fmt(s.heap.used)} / ${this.fmt(s.heap.total)}`) +
              row('上限', this.fmt(s.heap.limit)) +
              row('使用率', `${heapPct.toFixed(1)}%`, this.color(heapPct, this.TH.heapWarn, this.TH.heapBad)) +
              note('⚠️ 仅 JS 堆，<b>不含视频解码 / MSE 内存</b>（崩溃常来自后者，需结合「活跃 HLS / video 数」判断）')
            : note('该浏览器不支持 performance.memory（非 Chrome 内核）');

        // ③ 直播资源
        this.panel.querySelector('.mon-live').innerHTML =
            row('活跃 HLS 合计', s.hls.total, this.color(s.hls.total, this.TH.hlsWarn, this.TH.hlsBad)) +
            row('— 加载 / 悬浮 / 大屏 / 对比', `${s.hls.loading} / ${s.hls.hover} / ${s.hls.full} / ${s.hls.compare}`) +
            row('&lt;video&gt; 元素（含抖音 / 我方循环）', `${s.videoTotal} / ${s.loopVideos}`) +
            row('片段加载 进行 / 排队 / 上限', `${s.loading} / ${s.queued} / ${s.maxConcurrent}`) +
            row('录制（编码） 进行 / 上限', `${s.recording || 0} / ${s.maxRecord || 0}`, this.color(s.recording || 0, s.maxRecord || 3, (s.maxRecord || 3) + 1)) +
            row('暂停状态', s.pauseReasons.length ? s.pauseReasons.join('、') : '无') +
            row('媒体缓冲 / 解码路数（估算）', `${s.media.bufferedSec.toFixed(0)}s / ${s.media.decoding}`) +
            note('媒体缓冲为 MSE 代理（精确解码 / GPU 内存无 JS API）');

        // ④ 缓存
        this.panel.querySelector('.mon-cache').innerHTML =
            row('循环片段缓存', `${s.cached} / ${s.maxCache} 个 · ${this.fmt(s.cacheBytes)}`) +
            row('截图缓存', `${s.previewCount} 个 · ${this.fmt(s.previewBytes)}`) +
            note('缓存数 ≠ 播放数——离屏卡片保留 blob、移除 video 释放解码。');

        // ⑤ 持久化存储
        this.panel.querySelector('.mon-storage').innerHTML =
            row('特别关心 + 设置 + 氛围词条', this.fmt(s.storage.local)) +
            note('存于 <b>chrome.storage.local</b>（本机磁盘）+ 内存缓存；<b>不随账号同步、不联网</b>，非页面 localStorage。');

        // ⑥ 设备
        this.panel.querySelector('.mon-device').innerHTML =
            row('逻辑核数 / 并发上限', `${s.cores || '未知'} / ${s.maxConcurrent}`);

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
        const sub = dark ? '#8a8f99' : '#9aa0a6';
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
            <div class="mon-accent"></div>
            <div class="mon-header" style="cursor:move;user-select:none;">
                <h3>📊 资源监控 <span class="mon-hint">可拖动</span></h3>
                <button class="mon-close" title="关闭">✕</button>
            </div>
            <div class="mon-body">
                <div class="mon-overview"></div>
                <div class="mon-sec mon-trend">
                    <canvas class="mon-spark"></canvas>
                    <div class="mon-legend"><span style="color:#1890ff">●</span> JS 堆　<span style="color:#fa8c16">●</span> 活跃 HLS　<span class="mon-note-inline">线持续上扬＝可能泄漏</span></div>
                </div>
                <div class="mon-sec"><h4>JS 堆内存</h4><div class="mon-box mon-heap"></div></div>
                <div class="mon-sec"><h4>直播资源（实时驱动）</h4><div class="mon-box mon-live"></div></div>
                <div class="mon-sec"><h4>缓存</h4><div class="mon-box mon-cache"></div></div>
                <div class="mon-sec"><h4>持久化存储</h4><div class="mon-box mon-storage"></div></div>
                <div class="mon-sec"><h4>设备</h4><div class="mon-box mon-device"></div></div>
                <button class="mon-copy">复制诊断信息</button>
            </div>
        `;

        const mono = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        const cardBg = dark ? '#23252b' : '#f7f8fa';
        const cardBd = dark ? '#33363d' : '#e8eaed';
        const style = document.createElement('style');
        style.textContent = `
            .resource-monitor-panel { overflow:hidden; }
            .resource-monitor-panel .mon-accent { height:3px; background:linear-gradient(90deg,#1890ff,#52c41a,#fa8c16); }
            .resource-monitor-panel .mon-header { padding:13px 18px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid ${cardBd}; }
            .resource-monitor-panel .mon-header h3 { margin:0; font-size:15px; font-weight:600; }
            .resource-monitor-panel .mon-hint { font-size:11px; color:${sub}; font-weight:400; margin-left:4px; }
            .resource-monitor-panel .mon-close { background:none; border:none; cursor:pointer; padding:4px 6px; font-size:15px; border-radius:6px; color:${dark ? '#bbb' : '#666'}; }
            .resource-monitor-panel .mon-close:hover { background:${dark ? '#33363d' : '#eee'}; }
            .resource-monitor-panel .mon-body { padding:14px 16px; overflow-y:auto; flex:1; min-height:0; }
            .resource-monitor-panel .mon-overview { display:flex; gap:10px; margin-bottom:14px; }
            .resource-monitor-panel .mon-stat { flex:1; text-align:center; padding:12px 6px; background:${cardBg}; border:1px solid ${cardBd}; border-radius:10px; }
            .resource-monitor-panel .mon-stat-v { font-size:26px; font-weight:700; line-height:1.05; font-family:${mono}; }
            .resource-monitor-panel .mon-stat-u { font-size:14px; font-weight:600; margin-left:1px; }
            .resource-monitor-panel .mon-stat-l { font-size:11px; color:${sub}; margin-top:5px; }
            .resource-monitor-panel .mon-sec { margin-bottom:12px; }
            .resource-monitor-panel .mon-sec h4 { margin:0 0 7px 2px; font-size:12px; font-weight:600; color:${dark ? '#c7ccd4' : '#5f6368'}; }
            .resource-monitor-panel .mon-box, .resource-monitor-panel .mon-trend { background:${cardBg}; border:1px solid ${cardBd}; border-radius:10px; padding:10px 12px; }
            .resource-monitor-panel .mon-trend { margin-bottom:14px; }
            .resource-monitor-panel .mon-spark { width:100%; height:54px; display:block; }
            .resource-monitor-panel .mon-legend { font-size:11px; color:${sub}; margin-top:6px; }
            .resource-monitor-panel .mon-note-inline { margin-left:6px; }
            .resource-monitor-panel .mon-row { display:flex; justify-content:space-between; align-items:baseline; gap:12px; padding:3px 0; }
            .resource-monitor-panel .mon-k { color:${sub}; font-size:12.5px; }
            .resource-monitor-panel .mon-v { font-family:${mono}; font-weight:600; font-size:13px; text-align:right; white-space:nowrap; }
            .resource-monitor-panel .mon-note { color:${sub}; font-size:11px; line-height:1.5; margin-top:6px; padding-top:6px; border-top:1px dashed ${cardBd}; }
            .resource-monitor-panel .mon-copy { margin-top:6px; width:100%; padding:11px; border:none; border-radius:9px; background:linear-gradient(135deg,#1890ff,#0e6fd6); color:#fff; font-size:14px; font-weight:600; cursor:pointer; }
            .resource-monitor-panel .mon-copy:hover { filter:brightness(1.06); }
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
        // 若面板未创建或曾因报错只创建未挂载（detached），重新创建，避免「点了打不开」
        if (!this.panel || !document.body.contains(this.panel)) {
            this.panel = null;
            this.createMonitorPanel();
        }
        this.panel.style.display = 'flex';
        this.isVisible = true;
        try { this.sample(); this.render(); } catch (e) { Logger.error('资源监控渲染失败:', e); }
        clearInterval(this.timer);
        this.timer = setInterval(() => {
            try { this.sample(); this.render(); } catch (e) { Logger.error('资源监控采样失败:', e); }
        }, 1000);
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
