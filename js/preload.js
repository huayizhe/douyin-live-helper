/** @charset UTF-8 */

/**
 * 循环片段管理器（ClipManager）
 *
 * 抖音式「会动的缩略图」：可见卡片进入视口后，后台拉一小段最低清晰度直播，
 * 用 MediaRecorder 录成本地 blob，随后**销毁 HLS 实例、断开连接**，把 blob 设为
 * `<video loop muted>` 循环播放。稳态下每路几乎零带宽、零长连接，这是「整屏全部加载」
 * 能撑住的前提。封面先显示不黑屏，加载好再盖上去；按 roomUrl 缓存，再次滚动不重载。
 *
 * 为兼容历史调用，导出名仍为 PreloadManager，并保留 preloadCache / maxBufferSize / init。
 */

import { Logger } from './logger.js';
import { NetworkUtils, DOMUtils, HLSUtils } from './utils.js';
import { SettingsManager } from './settings.js';

const HLS = window.Hls;

export const PreloadManager = {
    // 录制片段缓存：Map<roomUrl, { blobUrl, timestamp }>（monitor.js 读取其 size）
    preloadCache: new Map(),
    // 每路片段的内存估算（供 monitor.js 估算占用）
    maxBufferSize: 1.5 * 1024 * 1024,

    // 状态机：Map<roomUrl, 'queued'|'loading'|'ready'|'error'>
    status: new Map(),
    // 重试计数：Map<roomUrl, number>
    retry: new Map(),
    // 当前可见且想要片段的卡片：Map<roomUrl, cardPreviewEl>
    visible: new Map(),
    // 待加载队列（{ live }）
    queue: [],
    // 正在加载/录制的路数
    activeLoads: 0,

    // —— 可调参数 ——
    // 同时加载/录制的最大并发（削平 CPU/带宽峰值，其余排队）
    MAX_CONCURRENT: 3,
    // 片段缓存软上限，超出按时间淘汰
    MAX_CACHE: 40,
    // 单段录制时长（毫秒）
    RECORD_MS: 12000,
    // 单路加载/录制整体超时（毫秒）
    LOAD_TIMEOUT: 20000,
    // 最大重试次数
    MAX_RETRY: 2,

    init() {
        if (!HLS) {
            Logger.error('HLS.js 未加载，循环片段功能不可用');
        }
    },

    /**
     * 选择录制用的 MIME 类型（优先 vp9，回退 vp8）
     * @private
     */
    _pickMimeType() {
        const candidates = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm'
        ];
        for (const t of candidates) {
            if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
        }
        return '';
    },

    /**
     * 确保某卡片拥有循环片段：命中缓存直接挂上播放，否则入队后台加载。
     * @param {Object} live - 直播信息（含 roomUrl / streamUrlHlsMap）
     * @param {HTMLElement} cardPreview - 卡片预览容器（.live-preview）
     */
    ensureClip(live, cardPreview) {
        if (!live || !live.roomUrl || !cardPreview) return;
        const roomUrl = live.roomUrl;

        // 记录当前可见卡片（重渲染后是新的 DOM 节点）
        this.visible.set(roomUrl, cardPreview);

        // 命中缓存：直接挂循环视频
        if (this.preloadCache.has(roomUrl)) {
            this.attachLoop(roomUrl, cardPreview);
            return;
        }

        // 已在加载/排队中：等其完成即可
        const st = this.status.get(roomUrl);
        if (st === 'loading' || st === 'queued') return;

        // error 状态允许再次进入视口时重试
        this.status.set(roomUrl, 'queued');
        this.queue.push({ live });
        this._pump();
    },

    /**
     * 卡片离开视口：移除正在播放的循环视频以释放解码，但保留缓存 blob。
     * @param {string} roomUrl
     * @param {HTMLElement} cardPreview
     */
    release(roomUrl, cardPreview) {
        if (this.visible.get(roomUrl) === cardPreview) {
            this.visible.delete(roomUrl);
        }
        this._removeLoopVideo(cardPreview);
    },

    /**
     * 调度队列：在并发上限内尽量多地启动加载。
     * @private
     */
    _pump() {
        while (this.activeLoads < this.MAX_CONCURRENT && this.queue.length > 0) {
            const { live } = this.queue.shift();
            // 排队期间若已被其它途径缓存，跳过
            if (this.preloadCache.has(live.roomUrl)) {
                this.status.set(live.roomUrl, 'ready');
                this._tryAttachVisible(live.roomUrl);
                continue;
            }
            this._startLoad(live);
        }
    },

    /**
     * 启动单路：拉最低清晰度 → 录制 → blob → 销毁 HLS → 缓存 → 挂载。
     * @private
     */
    _startLoad(live) {
        const roomUrl = live.roomUrl;
        this.activeLoads++;
        this.status.set(roomUrl, 'loading');
        Logger.log('开始加载循环片段:', live.anchor);

        const url = NetworkUtils.getLowestQualityUrl(live.streamUrlHlsMap);
        if (!url) {
            this._finishLoad(roomUrl, false, '无可用流地址');
            return;
        }

        // 离屏隐藏视频（用离屏定位而非 display:none，避免解码被节流影响 captureStream）
        const video = DOMUtils.createElement('video', {
            styles: {
                position: 'fixed', left: '-10000px', top: '0',
                width: '180px', height: '320px', opacity: '0', pointerEvents: 'none', zIndex: '-1'
            },
            attributes: { playsInline: 'true', preload: 'auto' }
        });
        video.muted = true;
        video.volume = 0;
        document.body.appendChild(video);

        let hls = null;
        let recorder = null;
        let done = false;
        const chunks = [];

        // 整体超时保护
        const timeout = setTimeout(() => {
            if (!done) cleanup(false, '加载超时');
        }, this.LOAD_TIMEOUT);

        const cleanup = (ok, reason, blobUrl) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
            try { if (hls) { hls.stopLoad(); hls.destroy(); } } catch (_) {}
            try { video.pause(); video.src = ''; video.remove(); } catch (_) {}
            this._finishLoad(roomUrl, ok, reason, blobUrl, live);
        };

        // 录满 RECORD_MS 后停止录制，落地 blob
        const startRecording = () => {
            const mimeType = this._pickMimeType();
            try {
                const srcStream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
                recorder = new MediaRecorder(srcStream, mimeType
                    ? { mimeType, videoBitsPerSecond: 1200000 }
                    : { videoBitsPerSecond: 1200000 });
            } catch (e) {
                cleanup(false, '创建录制器失败');
                return;
            }
            recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
            recorder.onstop = () => {
                if (!chunks.length) { cleanup(false, '录制无数据'); return; }
                const blob = new Blob(chunks, { type: chunks[0].type || 'video/webm' });
                const blobUrl = URL.createObjectURL(blob);
                cleanup(true, null, blobUrl);
            };
            recorder.start();
            setTimeout(() => { try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) {} }, this.RECORD_MS);
        };

        // 首帧开始播放即开录（此时已有真实画面）
        video.addEventListener('playing', () => { if (!done && !recorder) startRecording(); }, { once: true });

        if (HLS && HLS.isSupported()) {
            hls = new HLS(HLSUtils.createPreloadConfig());
            hls.on(HLS.Events.ERROR, (event, data) => {
                if (data && data.fatal && !recorder) cleanup(false, 'HLS致命错误');
            });
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(HLS.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); });
            video.addEventListener('error', () => { if (!recorder) cleanup(false, '原生HLS错误'); });
        } else {
            cleanup(false, '浏览器不支持HLS');
        }
    },

    /**
     * 单路收尾：成功则缓存 blob 并挂到可见卡片；失败则按需重试；最后释放并发槽并继续调度。
     * @private
     */
    _finishLoad(roomUrl, ok, reason, blobUrl, live) {
        this.activeLoads = Math.max(0, this.activeLoads - 1);

        if (ok && blobUrl) {
            this._cacheClip(roomUrl, blobUrl);
            this.status.set(roomUrl, 'ready');
            this.retry.delete(roomUrl);
            this._tryAttachVisible(roomUrl);
            Logger.log('循环片段就绪:', roomUrl);
        } else {
            const n = (this.retry.get(roomUrl) || 0) + 1;
            Logger.warn(`循环片段加载失败(${reason})，第 ${n} 次:`, roomUrl);
            if (live && n <= this.MAX_RETRY) {
                this.retry.set(roomUrl, n);
                this.status.set(roomUrl, 'queued');
                // 退避后重新入队（卡片仍在视口才有意义）
                setTimeout(() => {
                    if (this.visible.has(roomUrl) && !this.preloadCache.has(roomUrl)) {
                        this.queue.push({ live });
                        this._pump();
                    } else {
                        this.status.delete(roomUrl);
                    }
                }, 1500 * n);
            } else {
                this.status.set(roomUrl, 'error');
            }
        }

        this._pump();
    },

    /**
     * 缓存片段 blob，超出软上限按时间淘汰最旧者并释放其 URL。
     * @private
     */
    _cacheClip(roomUrl, blobUrl) {
        const old = this.preloadCache.get(roomUrl);
        if (old && old.blobUrl && old.blobUrl !== blobUrl) {
            try { URL.revokeObjectURL(old.blobUrl); } catch (_) {}
        }
        this.preloadCache.set(roomUrl, { blobUrl, timestamp: Date.now() });

        while (this.preloadCache.size > this.MAX_CACHE) {
            // 找最旧且当前不可见的条目优先淘汰
            let oldestKey = null, oldestTs = Infinity;
            for (const [k, v] of this.preloadCache.entries()) {
                if (this.visible.has(k)) continue; // 尽量不淘汰正在显示的
                if (v.timestamp < oldestTs) { oldestTs = v.timestamp; oldestKey = k; }
            }
            if (oldestKey == null) break; // 全部可见，不强淘汰
            this._evict(oldestKey);
        }
    },

    /**
     * 淘汰一条缓存：释放 blob URL 并清状态。
     * @private
     */
    _evict(roomUrl) {
        const v = this.preloadCache.get(roomUrl);
        if (v && v.blobUrl) { try { URL.revokeObjectURL(v.blobUrl); } catch (_) {} }
        this.preloadCache.delete(roomUrl);
        this.status.delete(roomUrl);
        this.retry.delete(roomUrl);
    },

    /**
     * 若该 room 当前有可见卡片，挂上循环视频。
     * @private
     */
    _tryAttachVisible(roomUrl) {
        const card = this.visible.get(roomUrl);
        if (card) this.attachLoop(roomUrl, card);
    },

    /**
     * 把缓存的循环片段挂到卡片上播放（叠在封面之上）。
     * @param {string} roomUrl
     * @param {HTMLElement} cardPreview
     */
    attachLoop(roomUrl, cardPreview) {
        const cached = this.preloadCache.get(roomUrl);
        if (!cached || !cardPreview) return;

        // 已挂同一个 blob 则不重复创建
        if (cardPreview._clipVideo && cardPreview._clipVideo.src === cached.blobUrl) return;
        this._removeLoopVideo(cardPreview);

        const video = document.createElement('video');
        Object.assign(video.style, {
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
            objectFit: 'cover', background: '#000', zIndex: '0'
        });
        video.src = cached.blobUrl;
        video.loop = true;
        video.muted = true;
        video.volume = 0;
        video.playsInline = true;
        video.autoplay = true;
        video.disablePictureInPicture = true;
        video.oncontextmenu = (e) => e.preventDefault();

        // 叠在背景封面之上，但在序号/复选框等覆盖层（z-index>=1）之下
        cardPreview.insertBefore(video, cardPreview.firstChild);
        cardPreview._clipVideo = video;
        video.play().catch(() => {});
    },

    /**
     * 给某卡片的循环视频取消静音（悬浮时调用，沿用全局声音设置）。
     * @param {HTMLElement} cardPreview
     */
    unmuteCard(cardPreview) {
        const v = cardPreview && cardPreview._clipVideo;
        if (!v) return;
        if (SettingsManager.isSoundEnabled()) {
            v.muted = false;
            v.volume = SettingsManager.getVolume();
        }
    },

    /**
     * 给某卡片的循环视频恢复静音（移出时调用）。
     * @param {HTMLElement} cardPreview
     */
    muteCard(cardPreview) {
        const v = cardPreview && cardPreview._clipVideo;
        if (!v) return;
        v.muted = true;
        v.volume = 0;
    },

    /**
     * 移除卡片上的循环视频，释放解码（保留缓存 blob）。
     * @private
     */
    _removeLoopVideo(cardPreview) {
        const v = cardPreview && cardPreview._clipVideo;
        if (v) {
            try { v.pause(); v.src = ''; v.remove(); } catch (_) {}
            cardPreview._clipVideo = null;
        }
    }
};
