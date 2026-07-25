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
import { SettingsManager, clipQualityToBitrate, clipQualityToStreamCode } from './settings.js';
import { computeLoadConcurrency, computeRecordConcurrency, createLoadSlotHolder } from './preload-concurrency.js';
import {
    createWarmupState,
    updateWarmupSample,
    isWarmupReady,
    isWarmupTimedOut,
    createStallState,
    updateStallSample,
    shouldDiscardForStutter,
    WARMUP_NEED_MS,
    WARMUP_MAX_WAIT_MS
} from './clip-stutter.js';

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
    // 正在加载（仅拉流/起播阶段）的路数；出画面（playing）后即释放，与录制槽彻底解耦
    activeLoads: 0,
    // 正在录制（编码）的路数
    activeRecords: 0,
    // 等待录制槽的回调队列（已起播、等编码空位）
    _recordWaiters: [],
    // 暂停加载的原因集合（hover/fullscreen/hidden 任一存在即暂停启动新加载）
    _pauseReasons: new Set(),
    // 暂停整墙循环播放的原因集合（compare/fullscreen 等；非空即整墙停播，释放解码）
    _playbackPauseReasons: new Set(),
    // 整墙循环播放是否处于暂停态（守卫在途加载完成后的自动起播）
    _playbackPaused: false,

    // —— 可调参数 ——
    // 加载并发上限：多路同时拉流/起播，快速铺首屏（加载相对廉价）。滑块值即生效值，区间 [8, 15]。
    MAX_CONCURRENT: 15,
    // **录制（编码）并发上限**——每路录制一个 MediaRecorder 编码，是 CPU 主负载。
    // 与加载真正解耦：playing 后释放加载槽，录制只占本信号量；满则该路 live 继续播、排队等录位。
    // 滑块值即生效值，范围 [2, 4]。一键还原时按核数推荐。
    MAX_CONCURRENT_RECORD: 4,
    // 片段缓存软上限，超出按时间淘汰（120×~0.8MB≈100MB blob，存储非解码）
    MAX_CACHE: 120,
    // 单段录制时长（毫秒）：6s 足够「会动的缩略图」，并加快录制槽周转
    RECORD_MS: 6000,
    // 单路加载/录制整体超时（毫秒）
    LOAD_TIMEOUT: 20000,
    // 最大重试次数
    MAX_RETRY: 2,
    // 录制码率：由清晰度档 clipQuality 映射（默认高清 800k）
    CLIP_BITRATE: 800000,
    // 列表拉流清晰度代码（与 clipQuality 同步）
    CLIP_STREAM_QUALITY: 'SD2',
    // 片段过期阈值：超过则在重新进视口时后台重录刷新，避免画面陈旧（按分钟配置）
    CLIP_MAX_AGE: 3 * 60 * 1000, // 3 分钟

    init() {
        if (!HLS) {
            Logger.error('HLS.js 未加载，循环片段功能不可用');
        }
        // 从 Settings 读取可配置性能参数（须在 SettingsManager.init 之后调用）
        this.applyPerfConfig(SettingsManager.getPerfConfig());
        // 设置面板 / 跨标签变更时即时生效（已在途加载不打断，仅影响后续 _pump / 新录制）
        SettingsManager.onPerfChange((cfg) => this.applyPerfConfig(cfg));

        // C：标签页切到后台只暂停「启动新的片段加载」，不暂停循环播放（回前台恢复加载）
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) this.pauseLoading('hidden');
            else this.resumeLoading('hidden');
        });
    },

    /**
     * 应用直播墙性能配置到运行时常量。
     * 滑块值即生效上限；清晰度档同时写入拉流码与录制码率。
     * 不中断已在途的加载/录制，仅影响后续调度与新录制参数。
     * @param {object} cfg - SettingsManager.getPerfConfig() 形态
     */
    applyPerfConfig(cfg) {
        if (!cfg || typeof cfg !== 'object') return;
        const cores = navigator.hardwareConcurrency || 6;
        const load = Number(cfg.maxConcurrent) > 0 ? Number(cfg.maxConcurrent) : 15;
        const record = Number(cfg.maxConcurrentRecord) > 0 ? Number(cfg.maxConcurrentRecord) : 4;

        // 滑块值即生效（Settings 已钳制到合法区间）
        this.MAX_CONCURRENT = Math.max(8, Math.min(15, Math.round(load)));
        this.MAX_CONCURRENT_RECORD = Math.max(2, Math.min(4, Math.round(record)));

        if (Number(cfg.recordMs) > 0) this.RECORD_MS = Number(cfg.recordMs);
        // 清晰度档 → 拉流码 + 录制码率
        const tier = cfg.clipQuality != null ? Number(cfg.clipQuality) : 1;
        this.CLIP_STREAM_QUALITY = clipQualityToStreamCode(tier);
        this.CLIP_BITRATE = clipQualityToBitrate(tier);
        if (Number(cfg.maxCache) > 0) this.MAX_CACHE = Math.round(Number(cfg.maxCache));
        // clipMaxAgeMin 为分钟 → 内部毫秒
        if (Number(cfg.clipMaxAgeMin) > 0) {
            this.CLIP_MAX_AGE = Number(cfg.clipMaxAgeMin) * 60 * 1000;
        }

        Logger.log(
            `性能参数已应用：加载=${this.MAX_CONCURRENT} 录制=${this.MAX_CONCURRENT_RECORD}` +
            ` 时长=${this.RECORD_MS}ms 清晰度档=${tier}(${this.CLIP_STREAM_QUALITY}/${this.CLIP_BITRATE})` +
            ` 缓存=${this.MAX_CACHE} 过期=${cfg.clipMaxAgeMin}min` +
            `（核数 ${cores}，推荐加载 ${computeLoadConcurrency(cores)} / 录制 ${computeRecordConcurrency(cores)}）`
        );
        // 上限变大时尝试继续调度排队任务
        this._pump();
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
     * 暂停整墙的循环播放（多路对比/大屏预览打开时调用）。整墙被模态遮住时不可见，
     * 停播纯赚——释放整墙解码 CPU，让给前台实时流/录制。复用单卡 pauseCard。
     * @param {string} reason - 暂停原因（compare/fullscreen）
     */
    pausePlayback(reason) {
        this._playbackPauseReasons.add(reason);
        this._playbackPaused = true;
        for (const card of this.visible.values()) this.pauseCard(card);
    },

    /**
     * 解除某原因的播放暂停；无其它原因时恢复整墙循环播放。
     * @param {string} reason
     */
    resumePlayback(reason) {
        this._playbackPauseReasons.delete(reason);
        if (this._playbackPauseReasons.size === 0) {
            this._playbackPaused = false;
            for (const card of this.visible.values()) this.resumeCard(card);
        }
    },

    /**
     * 立即中止所有在途加载/录制（录制深度限流时调用）。pauseLoading 只拦新加载、
     * 不动在途；此法把后台仍在拉流/编码的残留也清掉，把 CPU 全让给前台录制。
     */
    abortInFlight() {
        for (const card of this.visible.values()) {
            if (card && card._clipAbort) { try { card._clipAbort(); } catch (_) {} }
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
        // 加载并发用 MAX_CONCURRENT（多路同时起播、快速铺画面）；编码另由录制信号量限制
        while (this.activeLoads < this.MAX_CONCURRENT && this.queue.length > 0) {
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
     * 申请一个录制（编码）槽：有空位立即占用并执行 fn 起录；否则把 fn 排进等待队列，
     * 等其它录制结束释放槽时再起录。期间该路 live 流仍在播（已可见、会动）。
     * @private
     */
    _acquireRecordSlot(fn) {
        if (this.activeRecords < this.MAX_CONCURRENT_RECORD) {
            this.activeRecords++;
            fn();
        } else {
            this._recordWaiters.push(fn);
        }
    },

    /**
     * 释放一个录制槽，并唤起下一个等待者（保持同时编码 ≤ MAX_CONCURRENT_RECORD）。
     * @private
     */
    _releaseRecordSlot() {
        this.activeRecords = Math.max(0, this.activeRecords - 1);
        if (this._recordWaiters.length && this.activeRecords < this.MAX_CONCURRENT_RECORD) {
            const next = this._recordWaiters.shift();
            this.activeRecords++;
            next();
        }
    },

    /**
     * 移除尚未起录的等待者（卡片离屏时调用，避免在死卡片上起录）。
     * @private
     */
    _cancelRecordWaiter(fn) {
        const i = this._recordWaiters.indexOf(fn);
        if (i >= 0) this._recordWaiters.splice(i, 1);
    },

    /**
     * 启动单路：在**可见卡片**里直接播设定清晰度实时（第 0 秒就动），
     * playing 后稳播门控约 1s，再申请录制槽；录中卡顿则丢弃并稍后重录。
     * 录满 RECORD_MS 后把同一个 video 无缝切到本地循环 blob 并断开直播。
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

        // 本路加载槽持有器：playing 后立刻释放并 _pump；finalize/cleanup/早退用同一持有器防二次减槽
        const loadSlot = createLoadSlotHolder(this);

        const url = NetworkUtils.getStreamUrlByQuality(live.streamUrlHlsMap, this.CLIP_STREAM_QUALITY);
        if (!url) {
            loadSlot.release();
            this._finishLoad(roomUrl, false, '无可用流地址', null, live, null);
            return;
        }

        // 在卡片内插入**可见**视频（录制期间就是缩略图，从第 0 秒就动）
        this._removeLoopVideo(cardPreview); // 清掉可能存在的旧循环（刷新场景）
        const video = document.createElement('video');
        Object.assign(video.style, {
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
            objectFit: 'cover', zIndex: '1' // 高于 .dy-media-blur(0)，避免横屏模糊层盖住
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
        let recordStarted = false; // 是否已占用录制槽（决定离场/收尾时如何释放）
        let aspect = null; // 宽高比 = videoWidth/videoHeight，用于横竖屏渲染
        let recordTimer = null; // RECORD_MS 定时器
        let stallTimer = null; // 录中卡顿轮询
        const chunks = [];

        // 整体超时保护
        const timeout = setTimeout(() => { if (!done) cleanup('加载超时'); }, this.LOAD_TIMEOUT);

        /** 停掉录制定时与卡顿监测 */
        const clearRecordWatchers = () => {
            if (recordTimer) { clearTimeout(recordTimer); recordTimer = null; }
            if (stallTimer) { clearInterval(stallTimer); stallTimer = null; }
        };

        // 占用录制槽后真正起录的回调（满则被排队，等释放时再调）
        const recordFn = () => {
            if (done) { this._releaseRecordSlot(); return; }
            recordStarted = true;
            startRecording();
        };

        /**
         * 丢弃本次录制但尽量保留 live 画面，走失败重试路径稍后重录。
         * 与 cleanup 不同：先停录制器，再在 _removeLoopVideo 之前由后续 _startLoad 替换。
         */
        const discardKeepLive = (reason) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            clearRecordWatchers();
            loadSlot.release();
            if (recordStarted) this._releaseRecordSlot();
            else this._cancelRecordWaiter(recordFn);
            try { if (recorder) { recorder.onstop = null; if (recorder.state !== 'inactive') recorder.stop(); } } catch (_) {}
            recorder = null;
            // 保留 hls/video 继续播 live；挂到卡片上以便 _removeLoopVideo / 离场时销毁
            if (hls) cardPreview._clipHls = hls;
            cardPreview._clipLoading = false;
            cardPreview._clipAbort = () => {
                try { if (cardPreview._clipHls) { cardPreview._clipHls.stopLoad(); cardPreview._clipHls.destroy(); } } catch (_) {}
                cardPreview._clipHls = null;
                if (cardPreview._clipVideo === video) {
                    try { video.pause(); video.src = ''; video.remove(); } catch (_) {}
                    cardPreview._clipVideo = null;
                }
                cardPreview._clipAbort = null;
            };
            Logger.warn('录制丢弃，稍后重录:', reason, roomUrl);
            this._finishLoad(roomUrl, false, reason, null, live, aspect);
        };

        // 失败/中止：销毁实例、移除可见视频；释放加载槽（若尚未在 playing 释放）与录制槽
        const cleanup = (reason) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            clearRecordWatchers();
            loadSlot.release(); // 未出画面就失败时仍须释加载槽；已释则 no-op
            if (recordStarted) this._releaseRecordSlot();
            else this._cancelRecordWaiter(recordFn); // 还在等录位就直接撤销
            try { if (recorder) { recorder.onstop = null; if (recorder.state !== 'inactive') recorder.stop(); } } catch (_) {}
            try { if (hls) { hls.stopLoad(); hls.destroy(); } } catch (_) {}
            cardPreview._clipHls = null;
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
            clearRecordWatchers();
            loadSlot.release(); // 正常路径 playing 已释；异常路径（未触发 playing）兜底防泄漏
            if (recordStarted) this._releaseRecordSlot();
            try { if (hls) { hls.stopLoad(); hls.destroy(); hls = null; } } catch (_) {}
            cardPreview._clipHls = null;
            video.loop = true;
            video.src = blobUrl;
            cardPreview._clipLoading = false;
            cardPreview._clipAbort = null;
            // 视口播放门控：录制完成时卡片若不完全可见则保持暂停（默认 true 兼容观察器未启用场景）；
            // 整墙停播期间（大屏/对比打开）也不自动起播
            if (cardPreview._shouldPlay !== false && !this._playbackPaused) {
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

        // 录满 RECORD_MS 后停止录制，落地 blob；期间监测卡顿
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
                if (done) return; // 已被 discard/cleanup
                if (!chunks.length) { cleanup('录制无数据'); return; }
                const blob = new Blob(chunks, { type: chunks[0].type || 'video/webm' });
                finalizeLoop(URL.createObjectURL(blob), blob.size);
            };
            recorder.start();

            // 录中卡顿监测：连续停滞或占比过高 → 丢弃并稍后重录（保持 live）
            let stall = createStallState(performance.now(), video.currentTime);
            stallTimer = setInterval(() => {
                if (done || !recorder) return;
                stall = updateStallSample(stall, video.currentTime, performance.now());
                if (shouldDiscardForStutter(stall)) {
                    discardKeepLive('录中卡顿');
                }
            }, 100);

            recordTimer = setTimeout(() => {
                try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
            }, this.RECORD_MS);
        };

        /**
         * playing 后稳播门控：约 1s 内 currentTime 持续推进才申请录制槽；超时则丢弃本轮。
         * @returns {Promise<boolean>}
         */
        const waitStablePlayback = () => new Promise((resolve) => {
            let state = createWarmupState(performance.now(), video.currentTime);
            const onTu = () => {
                if (done) return;
                state = updateWarmupSample(state, video.currentTime, performance.now());
            };
            video.addEventListener('timeupdate', onTu);
            const finish = (ok) => {
                video.removeEventListener('timeupdate', onTu);
                resolve(ok);
            };
            const run = () => {
                if (done) { finish(false); return; }
                const now = performance.now();
                state = updateWarmupSample(state, video.currentTime, now);
                if (isWarmupReady(state, WARMUP_NEED_MS)) { finish(true); return; }
                if (isWarmupTimedOut(state, now, WARMUP_MAX_WAIT_MS)) { finish(false); return; }
                if (typeof video.requestVideoFrameCallback === 'function') {
                    video.requestVideoFrameCallback(() => run());
                } else {
                    setTimeout(run, 100);
                }
            };
            run();
        });

        // 出画面即释放加载槽并 _pump；稳播通过后再申请录制槽
        video.addEventListener('playing', () => {
            if (done || recorder || recordStarted) return;
            loadSlot.release();
            waitStablePlayback().then((ok) => {
                if (done) return;
                if (!ok) {
                    discardKeepLive('稳播门控未通过');
                    return;
                }
                this._acquireRecordSlot(recordFn);
            });
        }, { once: true });

        if (HLS && HLS.isSupported()) {
            hls = new HLS(HLSUtils.createPreloadConfig());
            cardPreview._clipHls = hls;
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
     * 单路收尾：成功则缓存 blob 并挂到可见卡片；失败则按需重试；最后继续调度队列。
     * 加载槽已在 playing（或 cleanup/早退）释放，此处不再减 activeLoads，避免二次减槽。
     * @private
     */
    _finishLoad(roomUrl, ok, reason, blobUrl, live, aspect, size) {
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
            objectFit: 'cover', zIndex: '1' // 高于 .dy-media-blur(0)
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
        // 视口播放门控：仅完全可见时才开播；整墙停播期间（大屏/对比打开）也不自动起播
        if (cardPreview._shouldPlay !== false && !this._playbackPaused) {
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
            maxConcurrent: this.MAX_CONCURRENT,
            recording: this.activeRecords,
            maxRecord: this.MAX_CONCURRENT_RECORD,
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
     * 顺带销毁残留 HLS、清除 .dy-media-blur，避免滚回重挂时模糊层盖住画面。
     * @private
     */
    _removeLoopVideo(cardPreview) {
        if (!cardPreview) return;
        // 丢弃录制后仍挂着的 live HLS
        if (cardPreview._clipHls) {
            try { cardPreview._clipHls.stopLoad(); cardPreview._clipHls.destroy(); } catch (_) {}
            cardPreview._clipHls = null;
        }
        const v = cardPreview._clipVideo;
        if (v) {
            try { v.pause(); v.src = ''; v.remove(); } catch (_) {}
            cardPreview._clipVideo = null;
        }
        // 无 video 时清掉残留模糊层（滚走只卸 video 会留下 blur）
        const blur = cardPreview.querySelector(':scope > .dy-media-blur');
        if (blur) blur.remove();
    }
};
