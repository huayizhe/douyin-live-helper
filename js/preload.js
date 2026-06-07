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
import { NetworkUtils, DOMUtils, HLSUtils, StyleUtils } from './utils.js';
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
    // 暂停加载的原因集合（hover/fullscreen/hidden 任一存在即暂停启动新加载）
    _pauseReasons: new Set(),

    // —— 可调参数 ——
    // 加载并发**硬上限**常量（约一屏可见数）。注意：实际调度用的是 MAX_CONCURRENT_RECORD（见下）。
    MAX_CONCURRENT: 9,
    // 同时进行的**录制（编码）**并发上限——每路加载即一路 MediaRecorder 编码，编码是 CPU 主负载。
    // 把它压到 3，首次填满视口的编码尖峰被压平；其余卡片先显封面/缓存循环，节奏更稳。
    // init() 里按核数自适应（弱机更低），范围 [2, 3]。
    MAX_CONCURRENT_RECORD: 3,
    // 片段缓存软上限，超出按时间淘汰（120×~0.8MB≈100MB blob，存储非解码）
    MAX_CACHE: 120,
    // 单段录制时长（毫秒）：5s 已足够「会动的缩略图」，比 8s 再省约 37% 编码时间与缓存内存
    RECORD_MS: 5000,
    // 单路加载/录制整体超时（毫秒）
    LOAD_TIMEOUT: 20000,
    // 最大重试次数
    MAX_RETRY: 2,
    // 录制码率（缩略图够清晰即可，省内存/编码 CPU；悬浮已切实时流故片段清晰度不重要）
    CLIP_BITRATE: 400000,
    // 片段过期阈值：超过则在重新进视口时后台重录刷新，避免画面陈旧（按分钟配置）
    CLIP_MAX_AGE: 3 * 60 * 1000, // 3 分钟

    init() {
        if (!HLS) {
            Logger.error('HLS.js 未加载，循环片段功能不可用');
        }
        // E：按设备逻辑核数自适应并发上限——弱机调小防卡顿、强机满速；下限 4、不超过 MAX_CONCURRENT。
        const cores = navigator.hardwareConcurrency || 6; // 未知时按中端 6 核处理
        this.MAX_CONCURRENT = Math.max(4, Math.min(this.MAX_CONCURRENT, Math.ceil(cores * 0.75)));
        // 录制（编码）并发自适应：弱机 2、其余 3（编码尖峰削峰的关键）
        this.MAX_CONCURRENT_RECORD = Math.max(2, Math.min(this.MAX_CONCURRENT_RECORD, Math.ceil(cores * 0.3)));
        Logger.log(`加载上限 ${this.MAX_CONCURRENT}、录制上限 ${this.MAX_CONCURRENT_RECORD}（核数 ${cores}）`);

        // C：标签页切到后台只暂停「启动新的片段加载」，不暂停循环播放（回前台恢复加载）
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.pauseLoading('hidden');
            else this.resumeLoading('hidden');
        });
    },

    /**
     * 暂停启动新的片段加载（in-flight 的让其录完）。
     * @param {string} reason - 暂停原因（hover/fullscreen/hidden）
     */
    pauseLoading(reason) {
        this._pauseReasons.add(reason);
    },

    /**
     * 解除某原因的暂停；无其它原因时恢复调度。
     * @param {string} reason
     */
    resumeLoading(reason) {
        this._pauseReasons.delete(reason);
        if (this._pauseReasons.size === 0) this._pump();
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

        // 命中缓存：直接挂循环视频；若片段已过期则后台重录刷新（旧片段先顶着不黑屏）
        if (this.preloadCache.has(roomUrl)) {
            this.attachLoop(roomUrl, cardPreview);
            const cached = this.preloadCache.get(roomUrl);
            const cst = this.status.get(roomUrl);
            if (Date.now() - cached.timestamp > this.CLIP_MAX_AGE &&
                cst !== 'loading' && cst !== 'queued') {
                Logger.log('片段过期，后台刷新:', roomUrl);
                this.status.set(roomUrl, 'queued');
                this.queue.push({ live, refresh: true });
                this._pump();
            }
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
        // 离开视口：从排队中移除（严格只加载视口内 → 视口外不排队、不抢并发槽）
        this.queue = this.queue.filter(it => it.live.roomUrl !== roomUrl);
        if (this.status.get(roomUrl) === 'queued') this.status.delete(roomUrl);
        // 在录则中止（销毁实例、移除视频），避免悬空
        if (cardPreview && cardPreview._clipAbort) { try { cardPreview._clipAbort(); } catch (_) {} }
        this._removeLoopVideo(cardPreview);
    },

    /**
     * 列表重渲染（搜索/筛选/排序）时硬重置流水线：中止在录、释放所有循环视频解码、
     * 清空排队与可见集，使新视口卡片立即优先加载。**保留 preloadCache**，同主播再进视口秒显。
     * 必须在 `container.innerHTML=''` 之前调用——video 脱离 DOM 不会自动停解码，须先 pause。
     */
    resetForRerender() {
        // 先清队列：随后中止触发的 _pump() 找到空队列，不会再启动新加载
        this.queue = [];
        for (const [, card] of [...this.visible.entries()]) {
            if (card && card._clipAbort) { try { card._clipAbort(); } catch (_) {} } // 中止在录
            this._removeLoopVideo(card);                                              // 暂停+移除循环 video，释放解码
        }
        this.visible.clear();
        // 清掉残留的 queued 状态键（已无队列项指向它们）
        for (const [k, st] of [...this.status.entries()]) {
            if (st === 'queued') this.status.delete(k);
        }
    },

    /**
     * 调度队列：在并发上限内尽量多地启动加载。
     * @private
     */
    _pump() {
        // 暂停期间不启动新加载（hover/大屏/后台）
        if (this._pauseReasons.size) return;
        // 用录制并发上限调度：每路加载即一路编码，借此把同时编码数压到 MAX_CONCURRENT_RECORD
        while (this.activeLoads < this.MAX_CONCURRENT_RECORD && this.queue.length > 0) {
            const { live, refresh } = this.queue.shift();
            // 排队期间若已被其它途径缓存，跳过（刷新任务除外，它就是要重录覆盖）
            if (!refresh && this.preloadCache.has(live.roomUrl)) {
                this.status.set(live.roomUrl, 'ready');
                this._tryAttachVisible(live.roomUrl);
                continue;
            }
            this._startLoad(live);
        }
    },

    /**
     * 启动单路：在**可见卡片**里直接播低清实时（第 0 秒就动），同时录制；
     * 录满 RECORD_MS 后把同一个 video 无缝切到本地循环 blob 并断开直播。消除「录满才显示」的空窗。
     * @private
     */
    _startLoad(live) {
        const roomUrl = live.roomUrl;

        // 卡片已离场就放弃（省无用功）；下次进视口再排队
        const cardPreview = this.visible.get(roomUrl);
        if (!cardPreview) {
            this.status.delete(roomUrl);
            this._pump();
            return;
        }

        this.activeLoads++;
        this.status.set(roomUrl, 'loading');
        Logger.log('开始加载循环片段:', live.anchor);

        const url = NetworkUtils.getLowestQualityUrl(live.streamUrlHlsMap);
        if (!url) {
            this._finishLoad(roomUrl, false, '无可用流地址', null, live, null);
            return;
        }

        // 在卡片内插入**可见**视频（录制期间就是缩略图，从第 0 秒就动）
        this._removeLoopVideo(cardPreview); // 清掉可能存在的旧循环（刷新场景）
        const video = document.createElement('video');
        Object.assign(video.style, {
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
            objectFit: 'cover', zIndex: '0'
        });
        video.muted = true;
        video.volume = 0;
        video.playsInline = true;
        video.autoplay = true;
        video.disablePictureInPicture = true;
        video.oncontextmenu = (e) => e.preventDefault();
        cardPreview.insertBefore(video, cardPreview.firstChild);
        cardPreview._clipVideo = video;
        cardPreview._clipLoading = true;

        let hls = null;
        let recorder = null;
        let done = false;
        let aspect = null; // 宽高比 = videoWidth/videoHeight，用于横竖屏渲染
        const chunks = [];

        // 整体超时保护
        const timeout = setTimeout(() => { if (!done) cleanup('加载超时'); }, this.LOAD_TIMEOUT);

        // 失败/中止：销毁实例、移除可见视频
        const cleanup = (reason) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            try { if (recorder) { recorder.onstop = null; if (recorder.state !== 'inactive') recorder.stop(); } } catch (_) {}
            try { if (hls) { hls.stopLoad(); hls.destroy(); } } catch (_) {}
            if (cardPreview._clipVideo === video) {
                try { video.pause(); video.src = ''; video.remove(); } catch (_) {}
                cardPreview._clipVideo = null;
            }
            cardPreview._clipLoading = false;
            cardPreview._clipAbort = null;
            this._finishLoad(roomUrl, false, reason, null, live, aspect);
        };

        // 成功：同一个可见 video 无缝切到本地循环、断开直播
        const finalizeLoop = (blobUrl, size) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            try { if (hls) { hls.stopLoad(); hls.destroy(); hls = null; } } catch (_) {}
            video.loop = true;
            video.src = blobUrl;
            cardPreview._clipLoading = false;
            cardPreview._clipAbort = null;
            // 视口播放门控：录制完成时卡片若不完全可见则保持暂停（默认 true 兼容观察器未启用场景）
            if (cardPreview._shouldPlay !== false) {
                video.play().catch(() => {});
            }
            this._finishLoad(roomUrl, true, null, blobUrl, live, aspect, size);
        };

        // 离场中止
        cardPreview._clipAbort = () => cleanup('离场中止');

        // 真实宽高比 + 横竖屏渲染（拿到 metadata 即应用）
        video.addEventListener('loadedmetadata', () => {
            if (video.videoWidth && video.videoHeight) {
                aspect = video.videoWidth / video.videoHeight;
                StyleUtils.applyMediaOrientation(cardPreview, video, StyleUtils.isLandscapeRatio(aspect));
            }
        });

        // 录满 RECORD_MS 后停止录制，落地 blob
        const startRecording = () => {
            const mimeType = this._pickMimeType();
            try {
                const srcStream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
                recorder = new MediaRecorder(srcStream, mimeType
                    ? { mimeType, videoBitsPerSecond: this.CLIP_BITRATE }
                    : { videoBitsPerSecond: this.CLIP_BITRATE });
            } catch (e) {
                cleanup('创建录制器失败');
                return;
            }
            recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
            recorder.onstop = () => {
                if (!chunks.length) { cleanup('录制无数据'); return; }
                const blob = new Blob(chunks, { type: chunks[0].type || 'video/webm' });
                finalizeLoop(URL.createObjectURL(blob), blob.size);
            };
            recorder.start();
            setTimeout(() => { try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) {} }, this.RECORD_MS);
        };

        // 首帧开始播放即开录（此时已有真实画面）
        video.addEventListener('playing', () => { if (!done && !recorder) startRecording(); }, { once: true });

        if (HLS && HLS.isSupported()) {
            hls = new HLS(HLSUtils.createPreloadConfig());
            hls.on(HLS.Events.ERROR, (event, data) => {
                if (data && data.fatal && !recorder) cleanup('HLS致命错误');
            });
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(HLS.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); });
            video.addEventListener('error', () => { if (!recorder) cleanup('原生HLS错误'); });
        } else {
            cleanup('浏览器不支持HLS');
        }
    },

    /**
     * 单路收尾：成功则缓存 blob 并挂到可见卡片；失败则按需重试；最后释放并发槽并继续调度。
     * @private
     */
    _finishLoad(roomUrl, ok, reason, blobUrl, live, aspect, size) {
        this.activeLoads = Math.max(0, this.activeLoads - 1);

        if (ok && blobUrl) {
            this._cacheClip(roomUrl, blobUrl, aspect, size);
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
    _cacheClip(roomUrl, blobUrl, aspect, size) {
        const old = this.preloadCache.get(roomUrl);
        if (old && old.blobUrl && old.blobUrl !== blobUrl) {
            try { URL.revokeObjectURL(old.blobUrl); } catch (_) {}
        }
        // 刷新时若本次未取到宽高比，沿用旧值
        const ratio = aspect || (old && old.aspect) || null;
        this.preloadCache.set(roomUrl, { blobUrl, timestamp: Date.now(), aspect: ratio, size: size || 0 });

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
            objectFit: 'cover', zIndex: '0'
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
        // 横竖屏渲染：竖屏铺满；横屏完整居中 + 上下模糊填充
        StyleUtils.applyMediaOrientation(cardPreview, video, StyleUtils.isLandscapeRatio(cached.aspect));
        // 视口播放门控：仅完全可见时才开播
        if (cardPreview._shouldPlay !== false) {
            video.play().catch(() => {});
        }
    },

    /**
     * 资源监控用：返回片段管理器的真实快照（缓存/加载/并发/暂停/真实字节）。
     */
    getStats() {
        let cacheBytes = 0;
        for (const v of this.preloadCache.values()) cacheBytes += (v.size || 0);
        let loopVideos = 0;
        for (const card of this.visible.values()) if (card && card._clipVideo) loopVideos++;
        return {
            cached: this.preloadCache.size,
            maxCache: this.MAX_CACHE,
            cacheBytes,
            loading: this.activeLoads,
            queued: this.queue.length,
            maxConcurrent: this.MAX_CONCURRENT_RECORD,
            pauseReasons: [...this._pauseReasons],
            loopVideos
        };
    },

    /**
     * 暂停某卡片的循环视频（悬浮切实时流时调用，省解码）。
     * @param {HTMLElement} cardPreview
     */
    pauseCard(cardPreview) {
        if (!cardPreview || cardPreview._clipLoading) return; // 录制中不暂停，避免污染录制
        const v = cardPreview._clipVideo;
        if (v) { try { v.pause(); } catch (_) {} }
    },

    /**
     * 恢复某卡片的循环视频（移开实时流后调用）。
     * @param {HTMLElement} cardPreview
     */
    resumeCard(cardPreview) {
        if (!cardPreview || cardPreview._shouldPlay === false) return;
        const v = cardPreview._clipVideo;
        if (v) { v.muted = true; v.volume = 0; v.play().catch(() => {}); }
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
