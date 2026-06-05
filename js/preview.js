/** @charset UTF-8 */

/**
 * 预览处理模块
 */

import { Logger } from './logger.js';
import { StyleUtils, SpeechUtils, NetworkUtils, TextUtils } from './utils.js';
import { PreloadManager } from './preload.js';
import { ToastManager } from './toast.js';
import { TOAST, LIVE_QUALITY } from './constants.js';
import { SettingsManager } from './settings.js';
import { LicenseManager } from './license.js';
import { AtmosphereManager } from './atmosphere.js';

// 确保 HLS.js 可用
const HLS = window.Hls;

// 「已预览」角标开关：自动循环预览上线后已冗余，默认隐藏（代码保留，置 true 可恢复）
const SHOW_PREVIEW_BADGE = false;

/**
 * 预览处理器
 */
export const PreviewManager = {
    /** 预览定时器,用于延迟加载预览 */
    previewTimer: null,

    /** 视频元素，用于播放直播流 */
    videoElement: null,

    /** HLS 实例,用于处理直播流 */
    hls: null,

    /** 当前正在预览的直播信息 */
    currentLive: null,

    /** 当前预览是否静音 */
    currentPreviewMuted: false,

    /** 
     * 当前氛围词条配置，包含：
     * 1. entryListStr: 氛围词条字符串，包含换行符
     * 2. positionList: 位置列表
     * 3. colorList: 颜色列表
     * 4. entryPerBatchCount: 批量显示词条数量，默认5个
     * 5. currentEntryIndex: 当前词条索引，默认0
     */
    currentEtmosphereEntryConfig: {
        entryListStr: '@你真美\n我好喜欢你呀\nwow，好热闹\n爱了爱了\n爱你呦，@\n今日已打卡\n@美无敌哦\n@老婆\n加油呀\n甜言蜜语不如陪伴你',
        positionList: [
            // 上边缘
            { left: 10, top: 5 },
            { left: 30, top: 3 },
            { left: 50, top: 4 },
            { left: 70, top: 6 },
            // 下边缘
            { left: 15, top: 85 },
            { left: 35, top: 87 },
            { left: 55, top: 86 },
            { left: 75, top: 84 },
            // 左边缘
            { left: 5, top: 25 },
            { left: 3, top: 45 },
            { left: 4, top: 65 },
            // 右边缘
            { left: 85, top: 20 },
            { left: 87, top: 40 },
            { left: 86, top: 60 }
        ],
        colorList: [
            'rgb(255, 0, 128)', // 亮粉色
            'rgb(0, 255, 255)', // 青色
            'rgb(255, 255, 0)', // 黄色
            'rgb(0, 255, 128)', // 亮绿色
            'rgb(255, 128, 0)', // 橙色
            'rgb(255, 0, 255)', // 紫色
            'rgb(0, 255, 0)',   // 亮绿色
            'rgb(255, 128, 255)' // 粉紫色
        ],
        entryPerBatchCount: 5,
        currentEntryIndex: 0
    },

    // 在 PreviewHandler 对象中添加默认词条配置
    defaultFloatingText: `@你真美;
我好喜欢你呀;
wow，好热闹;
爱了爱了;
爱你呦，@;
今日已打卡;
@美无敌哦;
@老婆;
加油呀;
你是我努力的目标;`,

    // 在 PreviewHandler 对象中添加默认配置
    defaultPositions: [
        // 上边缘
        { left: 10, top: 5 },
        { left: 30, top: 3 },
        { left: 50, top: 4 },
        { left: 70, top: 6 },
        // 下边缘
        { left: 15, top: 85 },
        { left: 35, top: 87 },
        { left: 55, top: 86 },
        { left: 75, top: 84 },
        // 左边缘
        { left: 5, top: 25 },
        { left: 3, top: 45 },
        { left: 4, top: 65 },
        // 右边缘
        { left: 85, top: 20 },
        { left: 87, top: 40 },
        { left: 86, top: 60 }
    ],

    defaultColors: [
        'rgb(255, 0, 128)', // 亮粉色
        'rgb(0, 255, 255)', // 青色
        'rgb(255, 255, 0)', // 黄色
        'rgb(0, 255, 128)', // 亮绿色
        'rgb(255, 128, 0)', // 橙色
        'rgb(255, 0, 255)', // 紫色
        'rgb(0, 255, 0)',   // 亮绿色
        'rgb(255, 128, 255)' // 粉紫色
    ],

    /** 当前文字更新定时器 */
    currentTextInterval: null,

    /** 媒体录制器实例,用于录制直播内容 */
    mediaRecorder: null,

    /** 录制的视频数据块数组 */
    recordedChunks: [],

    /** 是否正在录制 */
    isRecording: false,

    /** 录制开始时间戳 */
    recordStartTime: null,
    previewErrorId: 'preview-error',
    // 氛围词条
    etmosphereEntry: 'etmosphere-entry',
    // 预览图片缓存
    previewCache: new Map(),

    // 大屏预览模态框 id
    modalId: 'dy-modal',
    // 大屏预览容器 id
    previewContainerId: 'dy-preview-container',

    // 大屏预览创建的 HLS 实例（用于退出时统一销毁）
    fullPreviewHlsInstances: [],

    // 多路对比预览创建的 HLS 实例（独立于大屏预览）
    compareHlsInstances: [],

    /**
     * 资源监控用：返回各来源的 HLS 实例数与截图缓存占用。
     * （片段加载中的 HLS 在 PreloadManager.activeLoads，监控里另算）
     */
    getHlsStats() {
        let previewBytes = 0;
        for (const d of this.previewCache.values()) {
            if (typeof d === 'string') previewBytes += d.length;
        }
        return {
            hover: this.hls ? 1 : 0,
            full: this.fullPreviewHlsInstances.length,
            compare: this.compareHlsInstances.length,
            previewCacheCount: this.previewCache.size,
            previewCacheBytes: Math.round(previewBytes * 0.75) // dataURL base64 → 实际字节约 ×0.75
        };
    },

    /**
     * 获取直播流地址的工具方法
     * @param {Object} streamUrlHlsMap - 直播流地址映射
     * @returns {string|null} 直播流地址或 null
     */
    getStreamUrl(streamUrlHlsMap) {
        const quality = NetworkUtils.getAppropriateQuality();
        const streamUrl = NetworkUtils.getStreamUrlByQuality(streamUrlHlsMap, quality);
        
        if (!streamUrl) {
            Logger.error('无法获取直播流地址');
            return null;
        }
        
        return streamUrl;
    },

    /**
     * 设置预览
     * @param {Element} cardPreview - 预览容器
     * @param {Object} live - 直播信息
     */
    setupPreview(cardPreview, live) {
        let isHovering = false;
        
        // 预先添加加载动画（非破坏性插入，避免重建已绑定监听的子节点）
        cardPreview.insertAdjacentHTML('beforeend', `
            <div class="dy-loading" style="
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 48px;
                height: 48px;
                display: none;
                z-index: 6;
            ">
                <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="#666" stroke-width="4" stroke-dasharray="80,80" stroke-dashoffset="0">
                        <animateTransform
                            attributeName="transform"
                            type="rotate"
                            from="0 24 24"
                            to="360 24 24"
                            dur="1s"
                            repeatCount="indefinite"
                        />
                    </circle>
                </svg>
            </div>
        `);

        const loadingEl = cardPreview.querySelector('.dy-loading');

        cardPreview.addEventListener('mouseenter', () => {
            isHovering = true;
            Logger.log('开始预览:', live.anchor);

            // 悬浮即暂停循环片段，改播这一路的真·实时流（最新画面 + 可出声）
            PreloadManager.pauseCard(cardPreview);
            // A：用户停滚专注这一路，暂停启动新的片段预加载，带宽/CPU 让给实时流
            PreloadManager.pauseLoading('hover');

            // 短延迟防快速划过误加载
            this.previewTimer = setTimeout(() => {
                if (isHovering && live.streamUrlHlsMap) {
                    loadingEl.style.display = 'block';
                    this.startStreamPreview(cardPreview, live, loadingEl);
                }
            }, 200);
        });

        cardPreview.addEventListener('mouseleave', () => {
            isHovering = false;
            Logger.log('结束预览:', live.anchor);
            this.clearPreview(cardPreview, live, this.videoElement, loadingEl);
            // 恢复循环片段与片段预加载
            PreloadManager.resumeCard(cardPreview);
            PreloadManager.resumeLoading('hover');
        });
    },

    /**
     * 开始流预览
     * @param {Element} cardPreview - 预览容器
     * @param {Object} live - 直播信息
     * @param {Element} loadingEl - 加载动画元素
     */
    async startStreamPreview(cardPreview, live, loadingEl) {
        try {
            this.currentLive = live;
            this.videoElement = document.createElement('video');
            Object.assign(this.videoElement.style, {
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                opacity: 0,
                transition: 'opacity 0.3s',
                zIndex: '1'  // 叠在循环片段(0)之上、信息条/序号/复选框等覆盖层之下
            });

            // 拿到真实宽高比后按横竖屏渲染（竖屏铺满 / 横屏完整居中+模糊填充）
            this.videoElement.addEventListener('loadedmetadata', () => {
                if (!this.videoElement) return;
                const aspect = this.videoElement.videoWidth / this.videoElement.videoHeight;
                StyleUtils.applyMediaOrientation(cardPreview, this.videoElement, StyleUtils.isLandscapeRatio(aspect));
            });

            const streamUrl = this.getStreamUrl(live.streamUrlHlsMap);
            if (!streamUrl) {
                loadingEl.style.display = 'none';
                return; // 取不到流：静默回落到循环片段/封面（不弹失败提示）
            }

            // 根据全局声音总开关决定是否静音
            this.videoElement.muted = !SettingsManager.isSoundEnabled();
            // 设置视频播放模式为内联
            this.videoElement.playsInline = true;
            // 设置视频音量（沿用全局缓存的预览音量）
            this.videoElement.volume = SettingsManager.getVolume();
            // 将视频元素添加到预览容器中
            cardPreview.appendChild(this.videoElement);

            if (Hls.isSupported()) {
                Logger.log('使用 HLS.js 播放');
                this.hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    backBufferLength: 5,
                    maxBufferSize: 5 * 1000 * 1000, // 限制缓冲区大小为 5MB
                    maxBufferLength: 5,             // 限制缓冲时长为 5 秒
                    timeout: 10000,
                    manifestLoadingTimeOut: 10000,
                    manifestLoadingMaxRetry: 3,
                    manifestLoadingRetryDelay: 1000,
                    enableSoftwareAES: true,
                    recovery: {
                        enabled: true,
                        maxRetries: 3,
                        retryDelay: 1000
                    }
                });

                // 添加错误处理
                this.hls.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                // 网络错误，尝试重新加载
                                Logger.warn('网络错误，尝试重新加载:', data);
                                this.hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                // 媒体错误，尝试恢复
                                Logger.warn('媒体错误，尝试恢复:', data);
                                this.hls.recoverMediaError();
                                break;
                            default:
                                // 无法恢复的错误
                                Logger.error('HLS 致命错误:', data);
                                const message = data.type === Hls.ErrorTypes.NETWORK_ERROR ? 
                                    '直播已结束或暂时无法访问' : '直播加载失败';
                                this.showPlaybackError(cardPreview, message);
                                loadingEl.style.display = 'none';
                                this.cleanupResources();
                                break;
                        }
                    }
                });

                try {
                    this.hls.loadSource(streamUrl);
                    this.hls.attachMedia(this.videoElement);

                    // 添加加载成功处理
                    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        this.playVideo()
                            .then(() => {
                                loadingEl.style.display = 'none';
                                this.scheduleProactiveCapture(cardPreview, live);
                            })
                            .catch(() => {
                                this.showPlaybackError(cardPreview, '播放失败');
                                loadingEl.style.display = 'none';
                            });
                    });
                } catch (error) {
                    Logger.error('加载直流失败:', error);
                    this.showPlaybackError(cardPreview, '直播加载失败');
                    loadingEl.style.display = 'none';
                    throw error;
                }
            } else if (this.videoElement.canPlayType('application/vnd.apple.mpegurl')) {
                // Safari 原生支持 HLS
                Logger.log('使用原生 HLS 播放');
                this.videoElement.src = streamUrl;
                this.videoElement.addEventListener('error', (e) => {
                    Logger.error('视频加载错误:', e);
                    this.showPlaybackError(cardPreview, '直播加载失败');
                    loadingEl.style.display = 'none';
                });
                this.videoElement.addEventListener('loadedmetadata', () => {
                    this.playVideo()
                        .then(() => {
                            loadingEl.style.display = 'none';
                            this.scheduleProactiveCapture(cardPreview, live);
                        })
                        .catch(() => {
                            this.showPlaybackError(cardPreview, '播放失败');
                            loadingEl.style.display = 'none';
                        });
                });
            } else {
                throw new Error('浏览器不支持 HLS 播放');
            }
        } catch (error) {
            Logger.error('初始化播放器失败:', error);
            this.showPlaybackError(cardPreview, '预览加载失败');
            loadingEl.style.display = 'none';
            this.cleanupResources();
        }
    },

    /**
     * 播放成功后主动抓一帧作为封面（比 mouseleave 抓取更可靠：此时 videoWidth>0、有真实画面）。
     * 抓取结果写入 live.capturedPreview 并即时更新卡片背景，同时缓存到 previewCache。
     * @param {HTMLElement} cardPreview - 卡片预览容器
     * @param {Object} live - 直播信息
     */
    scheduleProactiveCapture(cardPreview, live) {
        setTimeout(() => {
            // 仍在预览同一个主播、视频有效时才抓帧
            if (!this.videoElement || this.currentLive !== live) return;
            const img = this.captureLastFramePreview(this.videoElement, live.roomUrl);
            if (img) {
                live.capturedPreview = img;
                cardPreview.style.backgroundImage = `url(${img})`;
            }
        }, 1500);
    },

    /**
     * 捕获最后一帧预览画面
     * @param {HTMLElement} videoElement - 视频元素
     * @param {string} roomUrl - 直播房间URL
     * @returns {string|null} - 捕获的预览画面URL或null
     */
    captureLastFramePreview(videoElement, roomUrl) {
        if (!videoElement) return;
        // 视频未加载完成时 videoWidth/videoHeight 为 0，强行操作会抛 IndexSizeError
        if (!videoElement.videoWidth || !videoElement.videoHeight) {
            return this.previewCache.get(roomUrl);
        }

        try {
            // 创建canvas进行截图
            const canvas = document.createElement('canvas');
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoElement, 0, 0);

            // 检查截图是否为空（纯黑色或未载）
            const isEmptyFrame = () => {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const data = imageData.data;
                // 检查是否所有像素都是黑色或透明
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    const a = data[i + 3];
                    if (r > 0 || g > 0 || b > 0 || a > 0) {
                        return false;
                    }
                }
                return true;
            };

            if (isEmptyFrame()) {
                Logger.log('预览画面为空，继续使用上次缓存的预览画面');
                return this.previewCache.get(roomUrl);
            }

            // 将截图转为base64并缓存
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            this.previewCache.set(roomUrl, dataUrl);
            Logger.log('预览画面已缓存:', roomUrl);
            return dataUrl;
        } catch (error) {
            Logger.error('截图失败，使用上次缓存的预览画面', error);
            return this.previewCache.get(roomUrl);
        }
    },

    /**
     * 停止播放和清理视频元素，清理HLS实例
     */
    cleanupResources() {
        // 停止播放和清理视频元素
        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.src = '';
            this.videoElement.remove();
            this.videoElement = null;
        }

        // 清理HLS实例
        if (this.hls) {
            this.hls.stopLoad();
            this.hls.destroy();
            this.hls = null;
        }

        // 清理大屏预览创建的 HLS 实例
        if (this.fullPreviewHlsInstances.length > 0) {
            this.fullPreviewHlsInstances.forEach(hls => { hls.stopLoad(); hls.destroy(); });
            this.fullPreviewHlsInstances = [];
        }
    },

    /**
     * 播放视频
     * @returns {Promise<void>}
     */
    playVideo() {
        return new Promise((resolve, reject) => {
            this.videoElement.play().then(() => {
                // 淡入显示视频
                this.videoElement.style.opacity = '1';
                resolve();
            }).catch(err => {
                // AbortError 是正常竞态（用户快速移开鼠标时 pause() 中断了 play()），静默处理
                if (err.name === 'AbortError') {
                    reject(err);
                    return;
                }
                Logger.error('播放预览失败:', err);
                // videoElement 可能已被 cleanupResources 置为 null，需判断
                if (this.videoElement?.parentElement) {
                    this.showPlaybackError(this.videoElement.parentElement, '播放失败');
                }
                reject(err);
            });
        });
    },

    /**
     * 清除预览
     * @param {HTMLElement} cardPreview - 预览容器
     * @param {Object} live - 直播数据
     * @param {HTMLElement} videoElement - 视频元素
     * @param {HTMLElement} loadingEl - 加载动画元素
     */
    clearPreview(cardPreview, live, videoElement, loadingEl) {

        // 清除定时器
        if (this.previewTimer) {
            clearTimeout(this.previewTimer);
            this.previewTimer = null;
        }

        // 停止语音播放
        SpeechUtils.stopPlayback();

        // 停止视频播放前捕获最后一帧
        if (videoElement) {
                // 捕获最后一帧作为预览图
                const previewImg = this.captureLastFramePreview(videoElement, live.roomUrl);
                // 如果捕获成功，设置预览图，并挂到 live 对象上（搜索/排序重渲染时保留）
                if (previewImg) {
                    cardPreview.style.backgroundImage = `url(${previewImg})`;
                    live.capturedPreview = previewImg;
                }

                Logger.log('退出大屏预览', {
                    previewImg,
                    cardPreview
                });

                // 添加已预览标记（左下角，避开右上角的对比复选框；去重避免叠加）
                if (SHOW_PREVIEW_BADGE && !cardPreview.querySelector('.preview-badge')) {
                    const badge = document.createElement('div');
                    badge.className = 'preview-badge';
                    badge.innerHTML = '已预览';
                    Object.assign(badge.style, {
                        position: 'absolute',
                        bottom: '8px',
                        left: '8px',
                        background: 'rgba(0, 0, 0, 0.8)',
                        color: '#fff',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        zIndex: 1
                    });
                    cardPreview.appendChild(badge);
                }


            // 停止播放和清理视频元素，清理HLS实例
            this.cleanupResources();
        }

        // 隐藏加载动画
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }

        // 移除错误提示
        const previewError = cardPreview.querySelector(`#${this.previewErrorId}`);
        if (previewError) {
            previewError.remove();
        }

        // 重置音量状态为默认值
        this.currentPreviewMuted = false;
    },

    /**
     * 显示播放错误
     * @param {Element} cardPreview - 预览容器
     * @param {string} message - 错误消息
     */
    showPlaybackError(cardPreview, message = '预览加载失败') {
        // 按需求：不再显示「播放失败/加载失败」提示，静默回落到封面/循环片段
    },

    /**
     * 抓取视频当前帧做成覆盖层，用于升清切换时遮住黑屏空档。跨域污染则回退到模糊封面/截图。
     * 遮罩挂到**稳定全屏的 host（previewContainer）**而非会随视频塌缩的 vc0，避免「从小到大」闪缩。
     * @param {HTMLVideoElement} v0 - 主画面视频
     * @param {HTMLElement} host - 稳定的全屏容器（previewContainer）
     * @returns {HTMLElement|null}
     */
    _makeFreezeMask(v0, host) {
        let dataUrl = null;
        try {
            if (v0.videoWidth && v0.videoHeight) {
                const c = document.createElement('canvas');
                c.width = v0.videoWidth;
                c.height = v0.videoHeight;
                c.getContext('2d').drawImage(v0, 0, 0);
                dataUrl = c.toDataURL('image/jpeg', 0.85);
            }
        } catch (_) { dataUrl = null; } // 跨域污染
        if (!dataUrl) {
            const live = this.currentLive;
            dataUrl = (live && (live.capturedPreview || live.cover)) || null;
        }
        if (!dataUrl || !host) return null;
        const mask = document.createElement('div');
        Object.assign(mask.style, {
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
            backgroundImage: `url(${dataUrl})`,
            backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
            opacity: '1', transition: 'opacity 0.4s ease', zIndex: '1', pointerEvents: 'none'
        });
        host.appendChild(mask);
        return mask;
    },

    /**
     * 大屏渐进升清：后台用临时 video 预拉蓝光，就绪后无缝替换到同一个 videos[0]（不换 DOM 元素）。
     * 三联屏/对比已加视频（videos 增多）则跳过，保活 captureStream 镜像。全程 best-effort，失败则维持低清。
     * @param {HTMLVideoElement[]} videos - 大屏视频数组（videos[0] 为主画面）
     * @param {string} highUrl - 蓝光流地址
     * @param {HTMLElement} previewContainer - 稳定全屏容器（冻结帧遮罩挂这里）
     */
    _crossfadeBigScreenQuality(videos, highUrl, previewContainer) {
        const v0 = videos[0];
        if (!v0 || !window.Hls) return;
        if (this.isRecording || videos.length !== 1) return; // 录制中/三联屏不切换

        let highHls;
        try { highHls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 0 }); }
        catch (_) { return; }
        this.fullPreviewHlsInstances.push(highHls);
        const drop = () => { this.fullPreviewHlsInstances = this.fullPreviewHlsInstances.filter(h => h !== highHls); };

        // 蓝光在独立可见视频上预缓冲，叠在 v0 上、初始透明
        const vc0 = v0.parentElement;
        const vHigh = document.createElement('video');
        vHigh.muted = true; vHigh.playsInline = true; vHigh.autoplay = true;
        vHigh.disablePictureInPicture = true;
        vHigh.oncontextmenu = (e) => e.preventDefault();
        Object.assign(vHigh.style, {
            position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
            objectFit: 'contain', opacity: '0', zIndex: '1'
        });
        if (vc0) {
            if (getComputedStyle(vc0).position === 'static') vc0.style.position = 'relative';
            vc0.appendChild(vHigh);
        }

        const FADE_MS = 1500;
        let started = false, failed = false;

        const fail = () => {
            failed = true;
            try { highHls.destroy(); } catch (_) {}
            try { vHigh.remove(); } catch (_) {}
            drop();
        };

        const finish = (targetMuted, targetVol) => {
            try {
                // 蓝光成为正式主视频：转成 v0 同款 flex 子元素样式
                Object.assign(vHigh.style, {
                    position: 'static', top: '', left: '', width: 'auto', height: '100%', opacity: '1', zIndex: ''
                });
                vHigh.muted = targetMuted;
                vHigh.volume = targetMuted ? 0 : targetVol;
                // 销毁低清、移除低清 v0
                const oldHls = this.fullPreviewHlsInstances.find(h => h !== highHls);
                if (oldHls) { try { oldHls.destroy(); } catch (_) {} }
                try { v0.pause(); v0.src = ''; v0.remove(); } catch (_) {}
                // 引用切到蓝光（videos 即 previewContainer._videos，控制条/镜像随之生效）
                videos[0] = vHigh;
                this.currentBigVideo = vHigh;
                this.fullPreviewHlsInstances = [highHls];
                Logger.log('大屏已交叉淡入到蓝光');
            } catch (e) { Logger.error('升清收尾失败:', e); }
        };

        const startCrossfade = () => {
            if (started || failed) return;
            if (this.isRecording || videos.length !== 1 || !vHigh.isConnected) { fail(); return; }
            started = true;
            clearTimeout(fb);

            const targetMuted = v0.muted || v0.volume === 0;
            const targetVol = v0.volume;
            if (!targetMuted) { vHigh.muted = false; vHigh.volume = 0; } // 允许音量淡入

            const t0 = performance.now();
            const ramp = (now) => {
                const k = Math.min(1, (now - t0) / FADE_MS);
                v0.style.opacity = String(1 - k);
                vHigh.style.opacity = String(k);
                if (!targetMuted) {
                    try { v0.volume = targetVol * (1 - k); } catch (_) {}
                    try { vHigh.volume = targetVol * k; } catch (_) {}
                }
                if (k < 1) requestAnimationFrame(ramp);
                else finish(targetMuted, targetVol);
            };
            requestAnimationFrame(ramp);
        };

        highHls.on(Hls.Events.MANIFEST_PARSED, () => { vHigh.play().catch(() => {}); });
        vHigh.addEventListener('canplay', startCrossfade, { once: true });
        const fb = setTimeout(startCrossfade, 6000); // 兜底
        highHls.on(Hls.Events.ERROR, (event, data) => {
            if (data && data.fatal && !started) { clearTimeout(fb); fail(); }
        });
        try { highHls.loadSource(highUrl); highHls.attachMedia(vHigh); }
        catch (_) { clearTimeout(fb); fail(); }
    },

    /**
     * 大屏右下角「手动切清晰度」按钮：chip 显示当前档，点开列出可用档位，选则平滑交叉淡入切换。
     * 录制中 / 三联屏开启时禁止切换。
     * @param {HTMLVideoElement[]} videos - 大屏视频数组
     * @param {HTMLElement} previewContainer - 大屏容器（存当前档位 _curQuality）
     * @param {Object} live - 直播数据（streamUrlHlsMap）
     * @returns {HTMLElement}
     */
    createQualityBtn(previewContainer, live) {
        const map = (live && live.streamUrlHlsMap) || {};
        const LABELS = { FULL_HD1: '蓝光', HD1: '超清', SD2: '高清', SD1: '标清' };
        const avail = LIVE_QUALITY.ORDER.filter(q => map[q]);

        // 当前清晰度 = 自适应实际落到的档位
        let cur = NetworkUtils.getAppropriateQuality();
        if (!map[cur]) cur = avail[0];
        previewContainer._curQuality = cur;

        // 与控制栏其它按钮同款外观，仅宽度自适应文字
        const btn = document.createElement('div');
        btn.setAttribute('title', '切换清晰度');
        this.createCtrlBtnBaseStyle(btn);
        Object.assign(btn.style, {
            width: 'auto', minWidth: '46px', padding: '0 10px', color: '#fff',
            fontSize: '13px', fontWeight: '600', position: 'relative'
        });
        if (avail.length <= 1) btn.style.display = 'none'; // 只有一档就不显示

        const label = document.createElement('span');
        const renderLabel = () => { label.textContent = LABELS[previewContainer._curQuality] || '清晰度'; };
        renderLabel();

        // 上弹菜单
        const menu = document.createElement('div');
        Object.assign(menu.style, {
            position: 'absolute', right: '0', bottom: '40px', background: 'rgba(0,0,0,0.88)',
            borderRadius: '6px', overflow: 'hidden', display: 'none', minWidth: '72px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.4)'
        });
        const buildMenu = () => {
            menu.innerHTML = '';
            avail.forEach(q => {
                const item = document.createElement('div');
                item.textContent = LABELS[q] || q;
                Object.assign(item.style, {
                    padding: '8px 14px', color: q === previewContainer._curQuality ? '#ff2c55' : '#fff',
                    fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: 'center'
                });
                item.addEventListener('mouseenter', () => { item.style.background = 'rgba(255,255,255,0.14)'; });
                item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
                item.onclick = (e) => {
                    e.stopPropagation();
                    menu.style.display = 'none';
                    if (q === previewContainer._curQuality) return;
                    if (this.isRecording) { ToastManager.show('录制中不可切换清晰度', TOAST.TYPE.ERROR); return; }
                    const videos = previewContainer._videos || [];
                    if (videos.length !== 1) { ToastManager.show('三联屏下不可切换清晰度', TOAST.TYPE.ERROR); return; }
                    previewContainer._curQuality = q;
                    renderLabel();
                    this._crossfadeBigScreenQuality(videos, map[q], previewContainer);
                };
                menu.appendChild(item);
            });
        };

        btn.onclick = (e) => {
            e.stopPropagation();
            if (menu.style.display === 'none') { buildMenu(); menu.style.display = 'block'; }
            else menu.style.display = 'none';
        };
        // 点别处收起菜单
        previewContainer.addEventListener('click', () => { menu.style.display = 'none'; });

        btn.appendChild(label);
        btn.appendChild(menu);
        return btn;
    },

    /**
     * 添加大屏预览方法
     * @param {HTMLElement} cardPreview - 卡片预览元素
     * @param {Object} live - 直播数据
     */
    openFullPreview(cardPreview, live) {
        this.currentLive = live;
        // B：大屏看真直播时背后整墙不可见，暂停全部片段加载 + 循环播放（先暂停，再清掉可能残留的 hover 标记，
        // 因 fullscreen 仍在集合中故不会触发加载；避免点开大屏时 mouseleave 不触发导致加载被永久挂起）
        PreloadManager.pauseLoading('fullscreen');
        PreloadManager.resumeLoading('hover');
        // 注：只暂停「启动新的片段加载」，不暂停整墙循环播放（暂停播放体验差）

        // 不复用悬浮流：若有悬浮预览在播，先释放（大屏直接请求自适应清晰度，1~2s 出画面）
        if (this.videoElement || this.hls) { try { this.cleanupResources(); } catch (_) {} }

        // 占位封面元素（首帧到达后移除）
        let placeholderEl = null;
        // 创建大屏预览模态框
        const modal = document.createElement('div');
        modal.id = this.modalId;
        Object.assign(modal.style, {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0, 0, 0, 0.9)',
            zIndex: 10000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
        });

        // 将大屏视频容器添加到 body 中
        document.body.appendChild(modal);

        // 创建视频预览容器
        const previewContainer = document.createElement('div');
        previewContainer.id = this.previewContainerId;
        Object.assign(previewContainer.style, {
            width: '100vw',
            height: '100vh',
            position: 'relative',
            background: '#000',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
        });

        // 占位封面：真直播首帧出来前用「当前帧/封面」作模糊背景，避免纯黑屏
        const placeholderImg = live.capturedPreview || this.previewCache.get(live.roomUrl) || live.cover;
        if (placeholderImg) {
            const placeholder = document.createElement('div');
            Object.assign(placeholder.style, {
                position: 'absolute', inset: '0', zIndex: '0',
                backgroundImage: `url(${placeholderImg})`,
                backgroundSize: 'cover', backgroundPosition: 'center',
                filter: 'blur(24px) brightness(0.6)', transform: 'scale(1.1)'
            });
            previewContainer.appendChild(placeholder);
            // 首帧开始播放即移除占位（见下方 videos[0] 的 playing 监听）
            placeholderEl = placeholder;
        }

        // 创建视频组容器
        const videoGroupContainer = document.createElement('div');
        Object.assign(videoGroupContainer.style, {
            display: 'flex',
            flexDirection: 'row',
            flexWrap: 'nowrap',
            justifyContent: 'center',
            alignItems: 'center',
            width: 'fit-content',  // 让容器宽度适应内容
            height: '100%'
        });

        // 默认单屏；三联屏通过按钮动态添加
        const videoContainers = [];
        const videos = [];

        // 辅助：创建单个视频容器
        const _makeVideoContainer = () => {
            const vc = document.createElement('div');
            Object.assign(vc.style, {
                flex: '0 0 auto',
                height: '100%',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center'
            });
            return vc;
        };

        // 辅助：创建单个视频元素（idx=0 有声，其余静音）
        const globalSoundEnabled = SettingsManager.isSoundEnabled();
        const savedVolume = SettingsManager.getVolume();
        const _makeVideo = (idx) => {
            const video = document.createElement('video');
            Object.assign(video.style, { height: '100%', width: 'auto', objectFit: 'contain' });
            video.disablePictureInPicture = true;
            video.oncontextmenu = (e) => e.preventDefault();
            video.muted = idx !== 0;
            video.volume = idx === 0 ? (globalSoundEnabled ? savedVolume : 0) : 0;
            video.playsInline = true;
            video.autoplay = true;
            // 直播流永远从直播边缘起播：绝不 seek 到 hover 的旧 currentTime
            // （对 live HLS 设 currentTime = seek 到陈旧时间点，会让 hls.js 长时间拉取卡住 → 大屏直点十几秒）
            return video;
        };

        // 辅助：为视频创建并启动 HLS 实例
        const _makeHls = (streamUrl, video) => {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 0 });
            hls.loadSource(streamUrl);
            hls.attachMedia(video);
            return hls;
        };

        // 初始化第一个视频（新建，直接请求自适应清晰度）
        const vc0 = _makeVideoContainer();
        const v0 = _makeVideo(0);
        vc0.appendChild(v0);
        videoContainers.push(vc0);
        videos.push(v0);
        this.currentBigVideo = v0; // 控制条动态指向的「当前主视频」，手动切清晰度后会更新

        // 将视频容器挂入视频组容器
        videoContainers.forEach(container => {
            videoGroupContainer.appendChild(container);
        });

        // 将视频组容器添加到主容器
        previewContainer.appendChild(videoGroupContainer);

        // 1. 声明定时器变量
        let timerInterval;
        let textInterval;

        // 2. 创建控制按钮（包括退出大屏按钮），传入 previewContainer
        const controls = this.createControls(cardPreview, videos[0], timerInterval, textInterval, previewContainer, live);
        previewContainer.appendChild(controls);
        // 初始隐藏（visibility:hidden + pointerEvents:none），由鼠标移动控制显隐

        // 3. 创建观看时长计时容器
        const timer = document.createElement('div');
        Object.assign(timer.style, {
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            background: 'rgba(255, 255, 255, 0.2)',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            zIndex: 2,
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            transition: 'all 0.3s ease',
            whiteSpace: 'nowrap',
            lineHeight: '1'
        });

        // 添加鼠标悬浮效果
        timer.addEventListener('mouseenter', () => {
            timer.style.background = 'rgba(0, 0, 0, 0.6)';
        });
        // 添加鼠标移出效果
        timer.addEventListener('mouseleave', () => {
            timer.style.background = 'rgba(255, 255, 255, 0.2)';
        });

        previewContainer.appendChild(timer);

        const anchorName = live.remark || live.anchor;
        let seconds = 0;
        timerInterval = setInterval(() => {
            seconds++;
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;
            timer.textContent = `已观看 ${anchorName} ${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
        }, 1000);
        timer.textContent = `已观看 ${anchorName} 00:00`;

        // 添加大屏视频容器到模态框
        modal.appendChild(previewContainer);

        // 加载提示层（直播画面出来前显示）
        const loadingOverlay = document.createElement('div');
        Object.assign(loadingOverlay.style, {
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
            zIndex: 3,
            pointerEvents: 'none'
        });
        loadingOverlay.innerHTML = `
            <svg width="56" height="56" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="4" stroke-dasharray="80,50" stroke-linecap="round">
                    <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="0.9s" repeatCount="indefinite"/>
                </circle>
            </svg>
            <div class="dy-big-loading-text" style="color:#fff;font-size:15px;letter-spacing:1px;text-shadow:0 1px 4px rgba(0,0,0,0.6);">直播加载中…</div>
        `;
        previewContainer.appendChild(loadingOverlay);

        // 首帧开始播放即隐藏加载层并移除占位封面
        videos[0].addEventListener('playing', () => {
            loadingOverlay.style.display = 'none';
            if (placeholderEl) { placeholderEl.remove(); placeholderEl = null; }
        }, { once: true });

        // 修改视频同步逻辑
        const syncVideos = (sourceVideo) => {
            const currentTime = sourceVideo.currentTime;
            videos.forEach(video => {
                if (video !== sourceVideo && Math.abs(video.currentTime - currentTime) > 0.3) {
                    video.currentTime = currentTime;
                }
            });
        };

        // 每秒同步一次视频时间
        const syncInterval = setInterval(() => {
            if (videos[0] && !videos[0].paused) {
                syncVideos(videos[0]);
            }
        }, 1000);

        // 检查是否可以关闭大屏（录制中则提示并阻止）
        const canClose = () => {
            if (this.isRecording) {
                ToastManager.show('录制中，请先停止录制再关闭大屏预览', TOAST.TYPE.ERROR);
                return false;
            }
            return true;
        };

        // 在清理时记得清除同步定时器（每步都容错，确保最终一定 modal.remove()，避免 ESC 关不掉）
        const cleanupHandler = () => {
            try { document.removeEventListener('keydown', handleEscKey, true); } catch (_) {}
            try { if (previewContainer._fullscreenCleanup) previewContainer._fullscreenCleanup(); } catch (_) {}
            clearInterval(syncInterval);
            clearInterval(timerInterval);
            clearInterval(textInterval);
            if (this.currentTextInterval) {
                clearInterval(this.currentTextInterval);
            }
            try { this.cleanupResources(); } catch (_) {} // 销毁大屏 HLS 实例及卡片预览资源
            try { videos.forEach(video => { video.pause(); video.src = ''; }); } catch (_) {}
            this.currentBigVideo = null;
            // B：退出大屏，恢复整墙的片段加载（循环播放本就没暂停）
            try { PreloadManager.resumeLoading('fullscreen'); } catch (_) {}
            modal.remove();
        };
        // 暴露给控制栏退出按钮，三条关闭路径（ESC/遮罩/退出按钮）统一走完整清理
        previewContainer._closeBig = cleanupHandler;

        // ESC 关闭大屏（捕获阶段，确保一定能收到；浏览器全屏时 ESC 由浏览器处理，不触发关闭）
        const handleEscKey = (e) => {
            if (e.key !== 'Escape') return;
            if (document.fullscreenElement) return; // 浏览器全屏中的 ESC 交给浏览器处理
            if (!canClose()) return;
            e.stopPropagation();
            cleanupHandler();
        };
        document.addEventListener('keydown', handleEscKey, true);

        // 大屏直接请求**自适应清晰度**（打开时已暂停其它加载、带宽充足）；右下角可手动切换
        const streamUrl = this.getStreamUrl(live.streamUrlHlsMap);
        if (!streamUrl) {
            cleanupHandler(); // 取不到流：静默关掉空大屏并恢复整墙（不弹失败提示）
            return;
        }

        // 加载失败时静默隐藏加载层（按需求不再显示「直播加载失败」文字）
        const showLoadFail = () => {
            loadingOverlay.style.display = 'none';
        };

        if (Hls.isSupported()) {
            const hls0 = _makeHls(streamUrl, videos[0]);
            this.fullPreviewHlsInstances = [hls0];
            hls0.on(Hls.Events.MANIFEST_PARSED, () => {
                videos.forEach(video => {
                    video.play().catch(err => {
                        if (err.name !== 'AbortError') Logger.error('大屏播放失败:', err);
                    });
                });
            });
            hls0.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) showLoadFail();
            });
        } else if (videos[0].canPlayType('application/vnd.apple.mpegurl')) {
            videos[0].src = streamUrl;
            videos[0].play().catch(err => {
                if (err.name !== 'AbortError') Logger.error('大屏播放失败canPlayType:', err);
            });
        }

        // 点击遮罩背景时关闭大屏预览（含录制检测）
        modal.onclick = (e) => {
            if (e.target !== modal) return;
            if (!canClose()) return;
            cleanupHandler();
        };

        // 暴露辅助方法供三联屏按钮动态添加视频用（额外两路走 captureStream 镜像，无需 streamUrl/HLS）
        previewContainer._makeVideo = _makeVideo;
        previewContainer._makeVideoContainer = _makeVideoContainer;
        previewContainer._videos = videos;
        previewContainer._videoContainers = videoContainers;
        previewContainer._videoGroupContainer = videoGroupContainer;
    },

    /**
     * 多路对比预览：同屏并排播放多个不同直播间（每路独立 HLS、独立控声）
     * 复用大屏预览的 modal/ESC/cleanup 基建，但不碰 openFullPreview / 三联屏逻辑。
     * @param {Object[]} lives - 直播信息数组（2~3 个）
     */

    // ── 共享网格布局助手（与三联屏同款：零缝隙、竖屏无黑边） ──

    /** 视频组：行容器，宽度贴合内容、整体居中 */
    _createGridGroup() {
        const g = document.createElement('div');
        Object.assign(g.style, {
            display: 'flex', flexDirection: 'row', flexWrap: 'nowrap',
            justifyContent: 'center', alignItems: 'center',
            width: 'fit-content', maxWidth: '92vw', height: '100%'
        });
        return g;
    },

    /** 单元格：贴合视频宽度、相对定位以承载叠加层（名字/音量/加载） */
    _createGridCell() {
        const c = document.createElement('div');
        Object.assign(c.style, {
            flex: '0 0 auto', height: '100%', position: 'relative',
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        });
        return c;
    },

    /** 视频元素：高度铺满、宽度自适应（竖屏无黑边）；maxWidth 防多路横屏溢出 */
    _createGridVideo({ muted, volume, maxWidthVw }) {
        const v = document.createElement('video');
        Object.assign(v.style, {
            height: '100%', width: 'auto', objectFit: 'contain',
            maxWidth: `${maxWidthVw}vw`
        });
        v.disablePictureInPicture = true;
        v.oncontextmenu = (e) => e.preventDefault();
        v.playsInline = true;
        v.autoplay = true;
        v.muted = muted;
        v.volume = volume;
        return v;
    },

    // ── 录制公共助手 ──

    /** 生成文件名时间戳 YYYYMMDD_HHMMSS */
    _recTimestamp() {
        const n = new Date();
        const p = (x) => x.toString().padStart(2, '0');
        return `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
    },

    /** 清洗主播名用于文件名（去非法字符、限长） */
    _sanitizeName(name) {
        return (name || '主播').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 16);
    },

    /** 把录制 chunks 存为 webm 下载 */
    _downloadWebm(chunks, fileName) {
        if (!chunks || !chunks.length) return;
        const blob = new Blob(chunks, { type: 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(a.href);
        document.body.removeChild(a);
    },

    /** 毫秒 → HH:MM:SS */
    _fmtDur(ms) {
        return new Date(Math.max(0, ms)).toISOString().slice(11, 19);
    },

    /** 设置录制按钮图标（红点 / 停止方块） */
    _setRecIcon(btn, recording) {
        btn.setAttribute('title', recording ? '停止录制' : '开始录制');
        btn.innerHTML = recording
            ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" stroke-width="2"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>`
            : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="6" fill="#ff2c55"/></svg>`;
    },

    /** 创建录制计时指示器（红点 [+标签] + 时间，录制时常驻可见） */
    _makeRecIndicator(position, label) {
        const el = document.createElement('div');
        Object.assign(el.style, {
            position: 'absolute', zIndex: 4, display: 'none',
            alignItems: 'center', gap: '6px',
            background: 'rgba(0, 0, 0, 0.65)', color: '#fff',
            padding: '4px 10px', borderRadius: '4px', fontSize: '12px',
            lineHeight: '1', whiteSpace: 'nowrap'
        }, position);
        const labelHtml = label ? `<span>${label}</span>` : '';
        el.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:#ff2c55;display:inline-block;animation:loading-fade-in 1s ease-in-out infinite alternate;"></span>${labelHtml}<span class="t">00:00:00</span>`;
        return el;
    },

    /** 选择支持的录制 mime（vp8 优先：对 canvas.captureStream 最可靠且能正常保存） */
    _pickRecorderMime() {
        const cands = [
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp9,opus',
            'video/webm'
        ];
        for (const m of cands) {
            try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
        }
        return '';
    },

    /** 高码率录制选项（避免默认低码率把高清流压糊） */
    _getRecorderOptions() {
        const mimeType = this._pickRecorderMime();
        const opts = { videoBitsPerSecond: 10000000, audioBitsPerSecond: 128000 };
        if (mimeType) opts.mimeType = mimeType;
        return opts;
    },

    openComparePreview(lives) {
        if (!lives || lives.length < 2) return;
        this.compareHlsInstances = [];

        // 模态遮罩
        const modal = document.createElement('div');
        modal.id = 'dy-compare-modal';
        Object.assign(modal.style, {
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0, 0, 0, 0.9)', zIndex: 10000,
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        });
        document.body.appendChild(modal);

        // 面板默认铺满整屏（100% 宽高），不自动进入浏览器全屏；全屏由按钮手动触发

        // 外层预览容器：铺满整屏，承载控件
        const previewContainer = document.createElement('div');
        Object.assign(previewContainer.style, {
            position: 'relative', width: '100vw', height: '100vh',
            background: '#000', display: 'flex', justifyContent: 'center', alignItems: 'center'
        });
        // 视频组：复用三联屏网格布局（零缝隙、竖屏无黑边）
        const container = this._createGridGroup();
        container.style.maxWidth = '100vw';

        // 声音从全局总配置读取
        const soundOn = SettingsManager.isSoundEnabled();
        const volume = SettingsManager.getVolume();
        // 横屏溢出防护：每路最大宽度按路数均分（整屏 98vw）
        const maxWidthVw = Math.floor(98 / lives.length);

        // ── 录制状态（闭包内，与单路大屏录制完全隔离）──
        const cellVideos = [];                 // [{ video, live }]
        const indivRecorders = new Map();      // video -> { recorder, chunks, btn, indicator, timer, beforeUnload }
        const recordButtons = [];              // 各 cell 录制按钮（用于互斥禁用）
        let mergeActive = false;
        let merge = null;                       // { recorder, chunks, raf, audioCtx, timer, beforeUnload }
        let mergeBtn = null;
        const overlays = [];                    // 自动隐显的叠加层（名字 + 控件行）

        const setDisabled = (el, d) => {
            el._disabled = d;
            el.style.opacity = d ? '0.4' : '1';
            el.style.cursor = d ? 'not-allowed' : 'pointer';
        };
        // 互斥：有单路在录则禁用合并；合并在录则禁用所有单路（二者不可能同时为真）
        const refreshRecAvailability = () => {
            if (mergeBtn) setDisabled(mergeBtn, indivRecorders.size > 0);
            recordButtons.forEach(({ btn }) => setDisabled(btn, mergeActive));
        };

        const makeBeforeUnload = (chunks, fileName) => {
            const handler = (e) => {
                this._downloadWebm(chunks, fileName);
                e.preventDefault();
                e.returnValue = '正在录制，关闭页面将保存已录制内容，确定离开？';
            };
            return handler;
        };

        // 单路录制开始/停止
        const startIndiv = (video, live, btn, indicator) => {
            if (mergeActive) return;
            let stream;
            try { stream = video.captureStream(); } catch (err) { ToastManager.show('该路无法录制', TOAST.TYPE.ERROR); return; }
            const recorder = new MediaRecorder(stream, this._getRecorderOptions());
            const chunks = [];
            recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
            const name = this._sanitizeName(live.remark || live.anchor);
            recorder.onstop = () => {
                this._downloadWebm(chunks, `抖音对比-单路_${name}_${this._recTimestamp()}.webm`);
                ToastManager.show('单路录制已保存', TOAST.TYPE.INFO);
            };
            recorder.start(1000);
            const startTime = Date.now();
            indicator.style.display = 'flex';
            const tEl = indicator.querySelector('.t');
            tEl.textContent = '00:00:00';
            const timer = setInterval(() => { tEl.textContent = this._fmtDur(Date.now() - startTime); }, 500);
            const beforeUnload = makeBeforeUnload(chunks, `抖音对比-单路_${name}_未完成.webm`);
            window.addEventListener('beforeunload', beforeUnload);
            indivRecorders.set(video, { recorder, chunks, btn, indicator, timer, beforeUnload });
            this._setRecIcon(btn, true);
            refreshRecAvailability();
        };
        const stopIndiv = (video) => {
            const r = indivRecorders.get(video);
            if (!r) return;
            try { r.recorder.stop(); } catch (_) {}
            clearInterval(r.timer);
            r.indicator.style.display = 'none';
            window.removeEventListener('beforeunload', r.beforeUnload);
            this._setRecIcon(r.btn, false);
            indivRecorders.delete(video);
            refreshRecAvailability();
        };

        lives.forEach((live, idx) => {
            // 单路单元格（贴合视频宽度、相对定位承载叠加层）
            const cell = this._createGridCell();

            const video = this._createGridVideo({
                muted: !soundOn,          // 跟随总开关：放音全开、静音全关
                volume,
                maxWidthVw
            });
            cell.appendChild(video);
            cellVideos.push({ video, live });

            // 主播名标签（左下，与大屏预览计时器同款 UI）
            const label = document.createElement('div');
            label.textContent = live.remark || live.anchor;
            Object.assign(label.style, {
                position: 'absolute', bottom: '8px', left: '8px', zIndex: 2,
                background: 'rgba(255, 255, 255, 0.2)', color: '#fff',
                padding: '6px 12px', borderRadius: '4px', fontSize: '12px',
                backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
                lineHeight: '1', maxWidth: '60%', transition: 'opacity 0.3s',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
            });
            cell.appendChild(label);
            overlays.push(label);

            // 底部右侧控件行：音量控件 + 录制按钮（音量键右侧）
            const cellControls = document.createElement('div');
            Object.assign(cellControls.style, {
                position: 'absolute', bottom: '8px', right: '8px', zIndex: 2,
                display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px',
                transition: 'opacity 0.3s'
            });
            // 音量控件（去掉自身绝对定位，改由控件行排布）
            const volumeCtrl = this._createCompareVolumeCtrl(video);
            volumeCtrl.style.position = 'static';
            volumeCtrl.style.bottom = '';
            volumeCtrl.style.right = '';
            cellControls.appendChild(volumeCtrl);
            // 单路录制按钮
            const recordBtn = document.createElement('div');
            this.createCtrlBtnBaseStyle(recordBtn);
            recordBtn.style.marginRight = '0';
            this._setRecIcon(recordBtn, false);
            const indicator = this._makeRecIndicator({ top: '8px', left: '8px' });
            cell.appendChild(indicator);
            recordBtn.onclick = (e) => {
                e.stopPropagation();
                if (recordBtn._disabled) return;
                if (indivRecorders.has(video)) stopIndiv(video);
                else startIndiv(video, live, recordBtn, indicator);
            };
            cellControls.appendChild(recordBtn);
            recordButtons.push({ btn: recordBtn, video });
            cell.appendChild(cellControls);
            overlays.push(cellControls);

            // 加载提示层
            const loading = document.createElement('div');
            Object.assign(loading.style, {
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%, -50%)', zIndex: 1,
                color: '#fff', fontSize: '14px', textShadow: '0 1px 4px rgba(0,0,0,0.6)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px'
            });
            loading.innerHTML = `
                <svg width="44" height="44" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="4" stroke-dasharray="80,50" stroke-linecap="round">
                        <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="0.9s" repeatCount="indefinite"/>
                    </circle>
                </svg>
                <span>直播加载中…</span>`;
            cell.appendChild(loading);

            video.addEventListener('playing', () => { loading.style.display = 'none'; }, { once: true });
            const showFail = () => {
                loading.style.display = 'flex';
                const sp = loading.querySelector('span'); if (sp) sp.textContent = '加载失败或已结束';
                const svg = loading.querySelector('svg'); if (svg) svg.style.display = 'none';
            };

            container.appendChild(cell);

            // 加载流
            const streamUrl = this.getStreamUrl(live.streamUrlHlsMap);
            if (!streamUrl) { showFail(); return; }
            if (Hls.isSupported()) {
                const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 0 });
                hls.loadSource(streamUrl);
                hls.attachMedia(video);
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    video.play().catch(err => { if (err.name !== 'AbortError') Logger.error('对比预览播放失败:', err); });
                });
                hls.on(Hls.Events.ERROR, (event, data) => { if (data.fatal) showFail(); });
                this.compareHlsInstances.push(hls);
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = streamUrl;
                video.play().catch(() => {});
            }
        });

        previewContainer.appendChild(container);
        modal.appendChild(previewContainer);

        // ── 合并录制（canvas 拼接画面 + Web Audio 混音 → 单文件）──
        const mergeIndicator = this._makeRecIndicator({ top: '12px', left: '12px' }, '合并录制');
        previewContainer.appendChild(mergeIndicator);

        const startMerge = () => {
            if (indivRecorders.size > 0) return;
            const valid = cellVideos.filter(c => c.video.videoWidth > 0 && c.video.videoHeight > 0);
            if (!valid.length) { ToastManager.show('画面尚未就绪，稍后再试', TOAST.TYPE.ERROR); return; }

            let raf = null, audioCtx = null;
            try {
                // 画面：高度取各路原生高度的最大值（上限 1080，保证清晰度），按宽高比横向拼接
                const H = Math.min(1080, Math.max(720, ...cellVideos.map(c => c.video.videoHeight || 0)));
                const panels = cellVideos.map(c => {
                    const vw = c.video.videoWidth || 720, vh = c.video.videoHeight || 1280;
                    return { video: c.video, w: Math.max(1, Math.round(H * vw / vh)) };
                });
                const totalW = panels.reduce((s, p) => s + p.w, 0);
                const canvas = document.createElement('canvas');
                canvas.width = totalW; canvas.height = H;
                const ctx = canvas.getContext('2d');
                const draw = () => {
                    let x = 0;
                    for (const p of panels) { try { ctx.drawImage(p.video, x, 0, p.w, H); } catch (_) {} x += p.w; }
                    raf = requestAnimationFrame(draw);
                };
                draw();

                // 视频轨（先画一帧再取，确保有内容）
                const canvasStream = canvas.captureStream(30);
                const vTrack = canvasStream.getVideoTracks()[0];
                if (!vTrack) throw new Error('无法获取合成画面视频轨');

                // 音频：对未静音的路用 captureStream 音轨混入（MediaStreamSource 仅旁路，不影响外放/静音）
                let mixDest = null;
                try {
                    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    audioCtx.resume?.();   // 绕过自动播放挂起
                    mixDest = audioCtx.createMediaStreamDestination();
                    cellVideos.forEach(c => {
                        if (c.video.muted) return;
                        try {
                            const src = audioCtx.createMediaStreamSource(c.video.captureStream());
                            src.connect(mixDest);
                        } catch (_) {}
                    });
                } catch (_) { audioCtx = null; mixDest = null; }

                const tracks = [vTrack];
                if (mixDest) tracks.push(...mixDest.stream.getAudioTracks());
                const recStream = new MediaStream(tracks);

                // 构造 MediaRecorder：优先高码率选项，失败则无参回退
                let recorder;
                try { recorder = new MediaRecorder(recStream, this._getRecorderOptions()); }
                catch (_) { recorder = new MediaRecorder(recStream); }

                const chunks = [];
                const names = lives.map(l => this._sanitizeName(l.remark || l.anchor)).join('-');
                recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
                recorder.onerror = (ev) => {
                    Logger.error('合并录制出错:', ev.error);
                    ToastManager.show('合并录制出错: ' + (ev.error?.message || '未知'), TOAST.TYPE.ERROR);
                };
                recorder.onstop = () => {
                    if (!chunks.length) { ToastManager.show('合并录制为空，未保存', TOAST.TYPE.ERROR); return; }
                    this._downloadWebm(chunks, `抖音对比-合并_${names}_${this._recTimestamp()}.webm`);
                    ToastManager.show('合并录制已保存', TOAST.TYPE.INFO);
                };
                recorder.start(1000);

                const startTime = Date.now();
                mergeIndicator.style.display = 'flex';
                const tEl = mergeIndicator.querySelector('.t');
                tEl.textContent = '00:00:00';
                const timer = setInterval(() => { tEl.textContent = this._fmtDur(Date.now() - startTime); }, 500);
                const beforeUnload = makeBeforeUnload(chunks, `抖音对比-合并_${names}_未完成.webm`);
                window.addEventListener('beforeunload', beforeUnload);
                merge = { recorder, chunks, raf, audioCtx, timer, beforeUnload };
                mergeActive = true;
                this._setRecIcon(mergeBtn, true);
                refreshRecAvailability();
                ToastManager.show('开始合并录制', TOAST.TYPE.INFO);
            } catch (err) {
                Logger.error('合并录制启动失败:', err);
                ToastManager.show('合并录制失败: ' + (err.message || '未知原因'), TOAST.TYPE.ERROR);
                if (raf) cancelAnimationFrame(raf);
                try { if (audioCtx) audioCtx.close(); } catch (_) {}
                merge = null;
                mergeActive = false;
                this._setRecIcon(mergeBtn, false);
                refreshRecAvailability();
            }
        };
        const stopMerge = () => {
            if (!merge) return;
            try { merge.recorder.stop(); } catch (_) {}
            cancelAnimationFrame(merge.raf);
            clearInterval(merge.timer);
            window.removeEventListener('beforeunload', merge.beforeUnload);
            try { if (merge.audioCtx) merge.audioCtx.close(); } catch (_) {}
            mergeIndicator.style.display = 'none';
            this._setRecIcon(mergeBtn, false);
            merge = null;
            mergeActive = false;
            refreshRecAvailability();
        };

        // 右上角控制行：合并录制 + 关闭（同样纳入自动隐显）
        const topControls = document.createElement('div');
        Object.assign(topControls.style, {
            position: 'absolute', top: '12px', right: '12px', zIndex: 3,
            display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px',
            transition: 'opacity 0.3s'
        });
        mergeBtn = document.createElement('div');
        this.createCtrlBtnBaseStyle(mergeBtn);
        mergeBtn.style.marginRight = '0';
        mergeBtn.setAttribute('title', '合并录制（三画面合成一个文件）');
        this._setRecIcon(mergeBtn, false);
        mergeBtn.onclick = (e) => {
            e.stopPropagation();
            if (mergeBtn._disabled) return;
            if (mergeActive) stopMerge();
            else startMerge();
        };
        // 浏览器全屏按钮（复用大屏预览逻辑），放在合并录制按钮左边
        const fullscreenBtn = this.createBrowserFullscreenBtn(previewContainer);
        fullscreenBtn.style.marginRight = '0';
        const closeBtn = document.createElement('div');
        closeBtn.setAttribute('title', '关闭对比预览');
        this.createCtrlBtnBaseStyle(closeBtn);
        closeBtn.style.marginRight = '0';
        closeBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M8 8L16 16"/><path d="M16 8L8 16"/></svg>`;
        topControls.appendChild(fullscreenBtn);
        topControls.appendChild(mergeBtn);
        topControls.appendChild(closeBtn);
        previewContainer.appendChild(topControls);
        overlays.push(topControls);

        // ── 控件自动隐显（参考大屏预览：mousemove 显示，空闲 2.5s 隐藏）──
        // 用 visibility + opacity 双控，修复 Edge 全屏 top-layer 下 opacity 不重绘、控件看不见却能点的问题
        let hideTimer = null;
        const hideOverlays = () => {
            overlays.forEach(el => { el.style.opacity = '0'; el.style.visibility = 'hidden'; });
        };
        const showOverlays = () => {
            overlays.forEach(el => { el.style.visibility = 'visible'; el.style.opacity = '1'; });
            clearTimeout(hideTimer);
            hideTimer = setTimeout(hideOverlays, 2500);
        };
        previewContainer.addEventListener('mousemove', showOverlays);
        previewContainer.addEventListener('mouseleave', () => {
            clearTimeout(hideTimer);
            hideOverlays();
        });
        overlays.forEach(el => {
            el.addEventListener('mouseenter', () => clearTimeout(hideTimer));
            el.addEventListener('mouseleave', () => showOverlays());
        });
        showOverlays(); // 初始显示并启动隐藏计时

        // ── 关闭 / 清理 ──
        let closed = false;
        const cleanup = () => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onEsc);
            clearTimeout(hideTimer);
            // 停止所有进行中的录制并保存
            [...indivRecorders.keys()].forEach(v => stopIndiv(v));
            if (mergeActive) stopMerge();
            // 退出浏览器全屏并移除全屏按钮注册的监听
            if (previewContainer._fullscreenCleanup) previewContainer._fullscreenCleanup();
            this.compareHlsInstances.forEach(hls => { try { hls.stopLoad(); hls.destroy(); } catch (_) {} });
            this.compareHlsInstances = [];
            modal.querySelectorAll('video').forEach(v => { v.pause(); v.srcObject = null; v.src = ''; });
            modal.remove();
        };
        // 与大屏预览一致：浏览器全屏时 ESC 交给浏览器退全屏（面板留 100%）；非全屏才关闭对比
        const onEsc = (e) => {
            if (e.key !== 'Escape') return;
            if (document.fullscreenElement) return;
            cleanup();
        };
        document.addEventListener('keydown', onEsc);

        closeBtn.onclick = (e) => { e.stopPropagation(); cleanup(); };
        modal.onclick = (e) => { if (e.target === modal) cleanup(); };
    },

    /**
     * 创建对比预览单路的音量控件（静音按钮 + 滑块）
     * 仅作用于本路视频，不同步声音总开关、不持久化。
     * @private
     */
    _createCompareVolumeCtrl(video) {
        // ── 静音按钮 ──
        const btn = document.createElement('div');
        this.createCtrlBtnBaseStyle(btn);
        btn.style.background = 'transparent';
        btn.style.backdropFilter = 'none';
        btn.style.webkitBackdropFilter = 'none';
        btn.style.marginRight = '0';
        btn.style.borderRadius = '0';
        btn.addEventListener('mouseenter', () => { btn.style.background = 'transparent'; }, true);
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; }, true);

        let lastVolume = video.volume || 0.3;

        const render = () => {
            const muted = video.muted || video.volume === 0;
            btn.setAttribute('title', muted ? '点击取消静音' : '点击静音');
            btn.innerHTML = muted
                ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`
                : (video.volume < 0.5
                    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`
                    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`);
        };
        render();

        // ── 滑块 ──
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'volume-slider';
        slider.min = '0';
        slider.max = '1';
        slider.step = '0.02';
        slider.value = video.muted ? 0 : video.volume;

        slider.addEventListener('input', (e) => {
            e.stopPropagation();
            const vol = parseFloat(slider.value);
            video.volume = vol;
            video.muted = vol === 0;
            if (vol > 0) lastVolume = vol;
            render();
        });
        slider.addEventListener('click', (e) => e.stopPropagation());

        // 静音按钮：切换本路静音
        btn.onclick = (e) => {
            e.stopPropagation();
            if (video.muted || video.volume === 0) {
                video.muted = false;
                if (video.volume === 0) video.volume = lastVolume;
            } else {
                lastVolume = video.volume;
                video.muted = true;
            }
            slider.value = video.muted ? 0 : video.volume;
            render();
        };

        // ── 组合容器（右下） ──
        const group = document.createElement('div');
        group.className = 'volume-group';
        Object.assign(group.style, { position: 'absolute', bottom: '8px', right: '8px', zIndex: 2, marginRight: 0 });
        group.appendChild(btn);
        group.appendChild(slider);
        return group;
    },

    /**
     * 创建控制按钮容器与控制按钮
     * @param {*} cardPreview 卡片预览元素
     * @param {*} video 视频元素
     * @param {*} timerInterval 计时器定时器
     * @param {*} textInterval 漂浮文字定时器
     * @param {*} previewContainer 容器
     * @returns 控制按钮容器
     */
    createControls(cardPreview, video, timerInterval = null, textInterval = null, previewContainer, live = null) {

        // 创建控制按钮容器
        const controlContainer = this.createControlContainer();

        // 控制栏显隐：鼠标移动即显示，空闲 2.5s 自动隐藏。
        // 改用 mousemove 而非 mouseenter，解决浏览器全屏时鼠标不离开容器、
        // 隐藏后无法再触发 mouseenter 导致菜单出不来的问题。
        if (previewContainer) {
            let hideTimer = null;
            const hideControls = () => {
                controlContainer.style.opacity = '0';
                controlContainer.style.visibility = 'hidden';
                controlContainer.style.pointerEvents = 'none';
            };
            const showControls = () => {
                controlContainer.style.visibility = 'visible';
                controlContainer.style.pointerEvents = 'auto';
                controlContainer.style.opacity = '1';
                clearTimeout(hideTimer);
                hideTimer = setTimeout(hideControls, 2500);
            };
            previewContainer.addEventListener('mousemove', showControls);
            previewContainer.addEventListener('mouseleave', () => {
                clearTimeout(hideTimer);
                hideControls();
            });
            // 鼠标悬在控制栏上时不自动隐藏
            controlContainer.addEventListener('mouseenter', () => clearTimeout(hideTimer));
            controlContainer.addEventListener('mouseleave', () => showControls());
        }

        // 添加音量控制按钮
        const volumeBtn = this.createVolumeBtn(video);
        // 添加浏览器全屏按钮（在音量按钮右侧）
        const fullscreenBtn = this.createBrowserFullscreenBtn(previewContainer);
        // 添加三联屏开关按钮
        const tripleScreenBtn = this.createTripleScreenBtn(previewContainer);
        // 添加氛围词条配置按钮
        const etmosphereEntryConfigBtn = this.createEtmosphereEntryConfigBtn();
        // 添加氛围词条开关按钮
        const etmosphereEntryToggleBtn = this.createEtmosphereEntryToggleBtn(previewContainer);
        // 添加录制按钮
        const recordBtn = this.createRecordBtn(previewContainer, video);
        // 添加退出大屏按钮
        const exitFullscreenBtn = this.createExitFullscreenBtn(cardPreview, video, timerInterval, textInterval, previewContainer);

        // 将按钮添加到控制按钮容器（清晰度按钮放在声音按钮左边）
        if (live) controlContainer.appendChild(this.createQualityBtn(previewContainer, live));
        controlContainer.appendChild(volumeBtn);
        controlContainer.appendChild(fullscreenBtn);
        controlContainer.appendChild(tripleScreenBtn);
        controlContainer.appendChild(etmosphereEntryConfigBtn);
        controlContainer.appendChild(etmosphereEntryToggleBtn);
        controlContainer.appendChild(recordBtn);
        controlContainer.appendChild(exitFullscreenBtn);

        return controlContainer;
    },

    /**
     * 创建控制按钮容器
     * @returns 控制按钮容器
     */
    createControlContainer() {
        const controls = document.createElement('div');
        controls.className = 'preview-controls';
        // 大屏控制按钮容器
        // 用 visibility + opacity 双控：隐藏时 visibility:hidden 既移出命中测试（避免"看不见却能点"），
        // 又能强制浏览器在全屏 top-layer 下重绘（修复 Edge 全屏对 backdrop-filter 元素只改 opacity 不重绘的 bug）
        Object.assign(controls.style, {
            position: 'absolute',
            bottom: '8px',
            right: '8px',
            display: 'flex',
            gap: '8px',
            zIndex: 2,
            opacity: '0',
            visibility: 'hidden',
            transition: 'opacity 0.3s',
            pointerEvents: 'none'
        });

        // 注意：鼠标事件不绑定在控制栏本身，而是由 createControls 统一绑定到
        // previewContainer（整个预览画面），鼠标进入画面即显示，更容易触发。

        return controls;
    },

    /**
     * 创建浏览器原生全屏按钮
     * 点击后让 previewContainer 占满整个屏幕；ESC 退出全屏恢复原尺寸
     * @param {HTMLElement} previewContainer
     * @returns {HTMLElement}
     */
    createBrowserFullscreenBtn(previewContainer) {
        const btn = document.createElement('div');
        btn.setAttribute('title', '进入全屏');
        this.createCtrlBtnBaseStyle(btn);

        const iconExpand = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
        </svg>`;
        const iconCollapse = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
            <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
        </svg>`;
        btn.innerHTML = iconExpand;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!document.fullscreenElement) {
                previewContainer.requestFullscreen().catch(err => {
                    ToastManager.show('全屏失败: ' + err.message, TOAST.TYPE.ERROR);
                });
            } else {
                document.exitFullscreen();
            }
        });

        // fullscreenchange：同步尺寸和按钮图标
        const onFullscreenChange = () => {
            if (document.fullscreenElement === previewContainer) {
                previewContainer.style.width = '100vw';
                previewContainer.style.height = '100vh';
                btn.innerHTML = iconCollapse;
                btn.setAttribute('title', '退出全屏');
            } else {
                previewContainer.style.width = '100vw';
                previewContainer.style.height = '100vh';
                btn.innerHTML = iconExpand;
                btn.setAttribute('title', '进入全屏');
            }
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);

        // 供 cleanupHandler 调用，退出时清理监听并强制退出全屏
        previewContainer._fullscreenCleanup = () => {
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            if (document.fullscreenElement) document.exitFullscreen();
        };

        return btn;
    },

    /**
     * 创建三联屏切换按钮（默认单屏，点击后动态添加/移除另外两路视频）
     * @param {HTMLElement} previewContainer
     * @returns {HTMLElement}
     */
    createTripleScreenBtn(previewContainer) {
        const btn = document.createElement('div');
        btn.setAttribute('title', '切换三联屏');
        this.createCtrlBtnBaseStyle(btn);
        // viewBox 收紧到内容区，图标视觉重量与其他按钮一致
        btn.innerHTML = `<svg width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg" viewBox="6 6 20 20">
            <path d="M10.5 9.875h3.125v12.25H10.5A1.125 1.125 0 0 1 9.375 21V11c0-.621.504-1.125 1.125-1.125z" stroke="#fff" stroke-width="1.75"/>
            <path d="M18.25 9.75v12.5h-4.5V9.75h4.5z" stroke="#fff" stroke-width="1.5"/>
            <path d="M21.5 9.875c.621 0 1.125.504 1.125 1.125v10c0 .621-.504 1.125-1.125 1.125h-3.125V9.875H21.5z" stroke="#fff" stroke-width="1.75"/>
        </svg>`;

        let isTriple = false;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            isTriple = !isTriple;
            btn.style.background = isTriple ? 'rgba(255, 44, 85, 0.6)' : 'rgba(255, 255, 255, 0.2)';

            const { _makeVideo, _makeVideoContainer,
                    _videos, _videoContainers, _videoGroupContainer } = previewContainer;
            const mainVideo = _videos[0];
            if (!mainVideo) return;

            if (isTriple) {
                // 额外两路用第一路视频的 captureStream 镜像，共享解码，避免 3 路独立拉流/解码导致卡顿
                let sharedStream;
                try {
                    sharedStream = mainVideo.captureStream();
                } catch (err) {
                    Logger.error('captureStream 失败，无法开启三联屏:', err);
                    isTriple = false;
                    btn.style.background = 'rgba(255, 255, 255, 0.2)';
                    return;
                }
                for (let i = 1; i <= 2; i++) {
                    const vc = _makeVideoContainer();
                    const v = _makeVideo(i);     // muted，无边距无边框
                    v.srcObject = sharedStream;
                    vc.appendChild(v);
                    _videoContainers.push(vc);
                    _videos.push(v);
                    _videoGroupContainer.appendChild(vc);
                    v.play().catch(() => {});
                }
            } else {
                // 移除额外两路（仅断开镜像，无 HLS 需销毁）
                while (_videoContainers.length > 1) {
                    const vc = _videoContainers.pop();
                    _videoGroupContainer.removeChild(vc);
                    const v = _videos.pop();
                    if (v) { v.pause(); v.srcObject = null; }
                }
            }
        });

        return btn;
    },

    /**
     * 创建控制按钮的基础样式
     * @param {*} element 元素
     */
    createCtrlBtnBaseStyle(element) {
        Object.assign(element.style, {
                width: '32px',
                height: '32px',
                background: 'rgba(255, 255, 255, 0.2)',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(4px)',
                WebkitBackdropFilter: 'blur(4px)',
            marginRight: '8px',
            transition: 'all 0.3s ease'
        });

        // 添加鼠标悬浮效果
        element.addEventListener('mouseenter', () => {
            element.style.background = 'rgba(0, 0, 0, 0.6)';
        });
        element.addEventListener('mouseleave', () => {
            element.style.background = 'rgba(255, 255, 255, 0.2)';
        });
    },

    /**
     * 创建音量控制组合控件（静音按钮 + 音量滑块）
     * @returns {HTMLElement} 音量组合容器
     */
    createVolumeBtn(video) {
        // 升清交叉淡入会把主视频换成蓝光元素，交互时动态取当前主视频（而非创建时捕获的旧元素）
        const mainV = () => this.currentBigVideo || video;
        // ── 音量按钮 ──
        const volumeBtn = document.createElement('div');
        volumeBtn.setAttribute('title', '静音/取消静音');
        this.createCtrlBtnBaseStyle(volumeBtn);
        // 按钮本身取消独立背景，由外层 volume-group 统一提供
        volumeBtn.style.background = 'transparent';
        volumeBtn.style.backdropFilter = 'none';
        volumeBtn.style.webkitBackdropFilter = 'none';
        volumeBtn.style.marginRight = '0';
        volumeBtn.style.borderRadius = '0';
        // 覆盖 createCtrlBtnBaseStyle 里的 hover 颜色改变
        volumeBtn.addEventListener('mouseenter', () => {
            volumeBtn.style.background = 'transparent';
        }, true);
        volumeBtn.addEventListener('mouseleave', () => {
            volumeBtn.style.background = 'transparent';
        }, true);

        // 更新音量图标函数
        const updateVolumeIcon = (value) => {
            if (value === 0) {
                volumeBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        <line x1="23" y1="9" x2="17" y2="15"></line>
                        <line x1="17" y1="9" x2="23" y2="15"></line>
                    </svg>`;
            } else if (value < 0.5) {
                volumeBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>`;
            } else {
                volumeBtn.innerHTML = `
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
                    </svg>`;
            }
        };

        // 初始音量/静音：与全局声音总开关一致
        const soundOn = SettingsManager.isSoundEnabled();
        const savedVolume = SettingsManager.getVolume();
        let lastVolume = savedVolume || 0.3;
        video.volume = soundOn ? savedVolume : 0;
        updateVolumeIcon(video.volume);

        // 同步列表顶部声音总开关按钮图标
        const syncHeaderSoundBtn = (enabled) => {
            const soundBtn = document.querySelector('.global-sound-btn');
            if (soundBtn && soundBtn._updateIcon) soundBtn._updateIcon(enabled);
        };

        // ── 音量滑块 ──
        const volumeSlider = document.createElement('input');
        volumeSlider.type = 'range';
        volumeSlider.className = 'volume-slider';
        volumeSlider.min = '0';
        volumeSlider.max = '1';
        volumeSlider.step = '0.02';
        volumeSlider.value = video.volume;

        // 滑块拖动：实时更新音量，并同步全局设置
        volumeSlider.addEventListener('input', (e) => {
            e.stopPropagation();
            const vol = parseFloat(volumeSlider.value);
            mainV().volume = vol;
            updateVolumeIcon(vol);
            if (vol > 0) {
                lastVolume = vol;
                SettingsManager.setVolume(vol);
                SettingsManager.setSoundEnabled(true);
            } else {
                SettingsManager.setSoundEnabled(false);
            }
            syncHeaderSoundBtn(vol > 0);
        });
        volumeSlider.addEventListener('click', (e) => e.stopPropagation());

        // ── 按钮点击：切换静音，同步更新滑块和全局设置 ──
        volumeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const v = mainV();
            if (v.volume > 0) {
                lastVolume = v.volume;
                v.volume = 0;
            } else {
                v.volume = lastVolume;
                SettingsManager.setVolume(lastVolume);
            }
            volumeSlider.value = v.volume;   // 同步滑块位置
            updateVolumeIcon(v.volume);
            SettingsManager.setSoundEnabled(v.volume > 0);
            syncHeaderSoundBtn(v.volume > 0);
        });

        // ── 组合容器 ──
        const volumeGroup = document.createElement('div');
        volumeGroup.className = 'volume-group';
        volumeGroup.appendChild(volumeBtn);
        volumeGroup.appendChild(volumeSlider);

        return volumeGroup;
    },
    
    /**
     * 显示氛围词条配置对话框
     * @param {Object} live - 主播信息
     */
    showEtmosphereEntryConfigDialog(live) {
        Logger.log('显示氛围词条配置对话框', live);
        if (!live) {
            Logger.error('直播数据为空');
            return;
        }

        const isDarkMode = StyleUtils.isDarkMode();
        const etmosphereEntryConfigModal = document.createElement('div');
        Object.assign(etmosphereEntryConfigModal.style, {
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 20000,  // 确保这个值足够大
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            pointerEvents: 'auto'  // 添加这行确可以点击
        });

        const dialog = document.createElement('div');
        Object.assign(dialog.style, {
            width: '600px',
            background: isDarkMode ? '#252632' : '#fff',
            borderRadius: '8px',
            padding: '20px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            color: isDarkMode ? '#fff' : '#000'
        });

        // 创建标题栏
        const titleBar = document.createElement('div');
        Object.assign(titleBar.style, {
            display: 'flex',
            alignItems: 'center',
            marginBottom: '20px'  // 移除 gap 属性，因为不再需要开关按钮的间距
        });

        // 标题
        const title = document.createElement('h2');
        title.textContent = `${live.anchor} 的氛围词条配置`;
        Object.assign(title.style, {
            margin: 0,
            fontSize: '18px',
            color: isDarkMode ? '#fff' : '#333'
            // 移除 marginRight，因为不再需要与开关按钮的间距
        });

        // 文本区域
        const textarea = document.createElement('textarea');
        Object.assign(textarea.style, {
            width: '100%',
            height: '300px',
            padding: '10px',
            border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
            borderRadius: '4px',
            background: isDarkMode ? '#1F1F1F' : '#fff',
            color: isDarkMode ? '#fff' : '#000',
            resize: 'none',
            fontSize: '14px',
            lineHeight: '1.5',
            marginBottom: '20px'
        });
        textarea.placeholder = `请输入词条，使用换行分隔，最多100条词条，2000个汉字。
例如：
@真可爱
@好厉害
爱你哦@
...
注：@会被替换为主播昵称或备注`;

        // 加载已保存的配置
        const cachedEntryListStr = AtmosphereManager.getEntries(live.secUid);

        if (cachedEntryListStr) {
            textarea.value = cachedEntryListStr;
        } else {
            // 如果没有保存的配置，使用默认词条
            textarea.value = this.currentEtmosphereEntryConfig.entryListStr;
        }

        // 语音播报开关（静音法：关闭只是音量为 0，词条显示与节奏不变）
        const voiceRow = document.createElement('label');
        Object.assign(voiceRow.style, {
            display: 'flex', alignItems: 'center', gap: '8px',
            margin: '0 0 16px', cursor: 'pointer',
            color: isDarkMode ? '#ddd' : '#333', fontSize: '14px'
        });
        const voiceCheckbox = document.createElement('input');
        voiceCheckbox.type = 'checkbox';
        voiceCheckbox.checked = AtmosphereManager.isVoice(live.secUid);
        const voiceLabelText = document.createElement('span');
        voiceLabelText.textContent = '语音播报（关闭后只显示词条、不出声）';
        voiceRow.appendChild(voiceCheckbox);
        voiceRow.appendChild(voiceLabelText);

        // 保存按钮
        const saveBtn = document.createElement('button');
        saveBtn.textContent = '保存';
        Object.assign(saveBtn.style, {
            padding: '8px 24px',
            background: '#ff2c55',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            transition: 'background-color 0.2s'
        });

        // 保存事件
        saveBtn.onclick = () => {
            // 语音播报开关：保存并立即应用静音状态
            AtmosphereManager.setVoice(live.secUid, voiceCheckbox.checked);
            SpeechUtils.setMuted(!voiceCheckbox.checked);
            const etmosphereEntryStr = textarea.value.trim();
            const previewContainer = document.getElementById(this.previewContainerId);
            if (etmosphereEntryStr) {
                if (etmosphereEntryStr.length > 2000) {
                    ToastManager.show('总字数不能超过2000个字', TOAST.TYPE.ERROR);
                    return;
                }
                const entryList = etmosphereEntryStr.split('\n').filter(msg => msg.trim());
                if (entryList.length > 100) {
                    ToastManager.show('词条数量不能超过100条', TOAST.TYPE.ERROR);
                    return;
                }

                // 更新配置
                this.currentEtmosphereEntryConfig.currentEntryIndex = 0;

                AtmosphereManager.setEntries(live.secUid, etmosphereEntryStr);
                
                // 立即更新显示
                this.updateEtmosphereEntryTexts(previewContainer, etmosphereEntryStr);
                ToastManager.show('词条配置已保存', TOAST.TYPE.INFO);
                etmosphereEntryConfigModal.remove();
            } else {
                // 清空配置时使用默认词条
                AtmosphereManager.removeEntries(live.secUid);
                this.updateEtmosphereEntryTexts(previewContainer, this.currentEtmosphereEntryConfig.entryListStr);
                ToastManager.show('已清空自定义词条，将使用默认配置', TOAST.TYPE.INFO);
                etmosphereEntryConfigModal.remove();
            }
        };

        // 组装对话框
        titleBar.appendChild(title);
        dialog.appendChild(titleBar);
        dialog.appendChild(voiceRow);
        dialog.appendChild(textarea);
        dialog.appendChild(saveBtn);
        etmosphereEntryConfigModal.appendChild(dialog);

        // 确保先移除可能存在的旧模态框
        const existingModal = document.querySelector('.atmosphere-entry-config-modal');
        if (existingModal) {
            existingModal.remove();
        }

        // 添加类名以便识别
        etmosphereEntryConfigModal.className = 'atmosphere-entry-config-modal';
        
        // 添加到 body 的最后
        document.body.appendChild(etmosphereEntryConfigModal);

        // 点击空白处关闭
        etmosphereEntryConfigModal.onclick = (e) => {
            // 如果点击的是模态框本身，且不是在编辑词条时
            if (e.target === etmosphereEntryConfigModal && !textarea.matches(':focus')) {
                // 如果文本区域有未保存的更改，显示确认提示
                const cachedEntryList = AtmosphereManager.getEntries(live.secUid) || this.currentEtmosphereEntryConfig.entryListStr;
                if (textarea.value !== cachedEntryList) {
                    if (confirm('有未保存的更改，确定要关闭吗？')) {
                        etmosphereEntryConfigModal.remove();
                    }
                } else {
                    etmosphereEntryConfigModal.remove();
                }
            }
        };

        // 添加键盘事件处理
        dialog.addEventListener('keydown', (e) => {
            // 如果按下 ESC 键
            if (e.key === 'Escape') {
                // 如果文本区域有未保存的更改，显示确认提示
                const cachedEntryList = AtmosphereManager.getEntries(live.secUid) || this.currentEtmosphereEntryConfig.entryListStr;
                if (textarea.value !== cachedEntryList) {
                    if (confirm('有未保存的更改，确定要关闭吗？')) {
                        etmosphereEntryConfigModal.remove();
                    }
                } else {
                    etmosphereEntryConfigModal.remove();
                }
            }
        });

        // 防止事件冒泡
        dialog.onclick = (e) => {
            e.stopPropagation();
        };
    },

    /**
     * 创建氛围词条配置按钮
     * @returns {HTMLElement} 氛围词条配置按钮
     */
    createEtmosphereEntryConfigBtn() {
        const etmosphereEntryConfigBtn = document.createElement('div');
        this.createCtrlBtnBaseStyle(etmosphereEntryConfigBtn);
        etmosphereEntryConfigBtn.setAttribute('title', '配置氛围词条');

        etmosphereEntryConfigBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" title="配置氛围词条">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
        `;
        
        etmosphereEntryConfigBtn.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (!LicenseManager.isPro) { LicenseManager.showUpgradePrompt('TTS 氛围词条'); return; }
            this.showEtmosphereEntryConfigDialog(this.currentLive);
        };

        return etmosphereEntryConfigBtn;
    },

    /**
     * 创建氛围词条开关按钮
     * @param {HTMLElement} previewContainer - 容器
     * @returns {HTMLElement} 氛围词条开关按钮
     */
    createEtmosphereEntryToggleBtn(previewContainer) {
        let isEnabled = this.getEtmosphereEntryEnabledState(this.currentLive.secUid);

        const etmosphereEntryToggleBtn = document.createElement('div');
        etmosphereEntryToggleBtn.setAttribute('title', '开关氛围词条显示');
        this.createCtrlBtnBaseStyle(etmosphereEntryToggleBtn);
        etmosphereEntryToggleBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${isEnabled ? '#ff2c55' : '#fff'}" stroke-width="2" title="开关氛围词条显示">
                <path d="M9 3h6v4l3 3-3 3v4H9v-4L6 10l3-3V3z"/>
                <path d="M9 14v7"/>
                <path d="M15 14v7"/>
            </svg>
        `;

        // 初始化词条配置
        const cachedEntryListStr = AtmosphereManager.getEntries(this.currentLive.secUid) || this.currentEtmosphereEntryConfig.entryListStr;

        // 如果初始状态为开启，调用一次更新词条来初始化
        if (isEnabled && cachedEntryListStr.length > 0) {
            this.updateEtmosphereEntryTexts(previewContainer, cachedEntryListStr);
        }
        
        etmosphereEntryToggleBtn.onclick = () => {
            if (!LicenseManager.isPro) { LicenseManager.showUpgradePrompt('TTS 氛围词条'); return; }
            isEnabled = !isEnabled;
            // 保存状态
            AtmosphereManager.setDisplay(this.currentLive.secUid, isEnabled);
            
            // 更新图标颜色
            etmosphereEntryToggleBtn.querySelector('svg').style.stroke = isEnabled ? '#ff2c55' : '#fff';

            // 立即应用更改
            const modal = document.getElementById(this.modalId);
            if (!modal) {
                Logger.error('未找到大屏模态框');
                return;
            }

            // 清除现有词条和定时器
            const existingTexts = modal.querySelectorAll('.etmosphere-entry');
            existingTexts.forEach(text => text.remove());
            
            if (this.currentTextInterval) {
                Logger.log('清除定时器');
                clearInterval(this.currentTextInterval);
                this.currentTextInterval = null;
            }

            // 如果开启，重新初始化词条配置
            if (isEnabled) {
                Logger.log('重新初始化词条配置');
                const cachedEntryListStr = AtmosphereManager.getEntries(this.currentLive.secUid) || this.currentEtmosphereEntryConfig.entryListStr;
                Logger.log('词条配置:', { cachedEntryListStr });
                this.updateEtmosphereEntryTexts(previewContainer, cachedEntryListStr);
            } else {
                // 关闭词条时停止语音播放
                SpeechUtils.stopPlayback();
            }
        };

        return etmosphereEntryToggleBtn;
    },

    /**
     * 获取氛围词条开启状态
     * @param {string} secUid - 主播的secUid
     * @returns {boolean} 氛围词条开启状态
     */
    getEtmosphereEntryEnabledState(secUid) {
        return AtmosphereManager.isDisplay(secUid);
    },

    /**
     * 更新氛围词条
     * @param {HTMLElement} previewContainer - 容器
     * @param {string} entryListStr - 新的词条列表
     */
    updateEtmosphereEntryTexts(previewContainer, entryListStr) {
        Logger.log('开始更新词条:', {
            entryListStr,
            currentConfig: this.currentEtmosphereEntryConfig
        });

        if (!previewContainer) {
            Logger.log('未找到大屏预览容器');
            return;
        }

        // 清除现有氛围词条和定时器
        const oldEntryList = previewContainer.querySelectorAll('.etmosphere-entry');
        oldEntryList.forEach(entry => entry.remove());
        if (this.currentTextInterval) {
            clearInterval(this.currentTextInterval);
            this.currentTextInterval = null;
        }

        // 更新词条配置
        const anchorName = this.currentLive.remark || this.currentLive.anchor;
        // 格式化处理后的氛围词条
        const formattedEntryList = entryListStr
            .split('\n')
            .map(entry => entry.replace(/\@/g, anchorName))
            .map(entry => TextUtils.standardizeText(entry));  // 通过删除表情符号、变体字符和转换繁体中文来标准化文本

        // 打印修改的词条信息
        Logger.log('更新词条配置：', {
            anchorName,
            formattedEntryList,
            entryListStr
        });

        // 停止播放
        SpeechUtils.stopPlayback();

        // 重新创建词条和定时器
        if (this.getEtmosphereEntryEnabledState(this.currentLive.secUid)) {
            Logger.log('创建新词条');
            this.createEtmosphereEntryAndPlayVoice(previewContainer, formattedEntryList);
            // 移除定时器相关代码，因为现在使用语音播放完成来触发
            this.currentTextInterval = null;
        } else {
            Logger.log('词条开关已关闭，不创建新词条');
        }
    },

    /**
     * 创建录制按钮
     * @param {HTMLElement} container - 容器
     * @param {HTMLVideoElement} video - 视频元素
     * @returns {HTMLElement} 录制按钮
     */
    createRecordBtn(container, video) {
        // 升清后主视频可能已换成蓝光元素，录制时动态取当前主视频
        const mainV = () => this.currentBigVideo || video;
        const recordBtn = document.createElement('div');
        recordBtn.setAttribute('title', '开始录制');
        this.createCtrlBtnBaseStyle(recordBtn);

        // 初始化录制图标状态
        this.updateRecordIcon(recordBtn, false);

        // 添加录制按钮点击事件
        recordBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!this.isRecording && !LicenseManager.isPro) {
                LicenseManager.showUpgradePrompt('直播录制');
                return;
            }
            if (!this.isRecording) {
                try {
                    // 获取视频元素的媒体流（动态取当前主视频，升清后仍正确）
                    const stream = mainV().captureStream();
                    if (!stream) {
                        ToastManager.show('没有可用的视频流', TOAST.TYPE.ERROR);
                        return;
                    }

                    // 创建 MediaRecorder（高码率 + 最佳编码器，避免默认低码率把高清流压糊）
                    this.mediaRecorder = new MediaRecorder(stream, this._getRecorderOptions());
                    // 创建一个空数组，用于存储录制的数据
                    this.recordedChunks = [];

                    // 监听数据可用事件，将数据添加到数组中
                    this.mediaRecorder.ondataavailable = (event) => {
                        if (event.data.size > 0) {
                            this.recordedChunks.push(event.data);
                        }
                    };

                    // 监听停止事件，将录制的数据保存为Blob对象
                    this.mediaRecorder.onstop = () => {
                        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
                        const now = new Date();
                        const timestamp = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}_${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
                        const fileName = `${this.currentLive.anchor}_${timestamp}.webm`;

                        // 创建下载链接
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = fileName;
                        a.style.display = 'none';
                        document.body.appendChild(a);
                        a.click();
                        URL.revokeObjectURL(a.href);
                        document.body.removeChild(a);
                        
                        ToastManager.show('视频保存成功', TOAST.TYPE.INFO);
                    };

                    // 开始录制，每秒记录一次数据
                    this.mediaRecorder.start(1000);
                    this.isRecording = true;
                    this.recordStartTime = Date.now();
                    this.updateRecordIcon(recordBtn, true);
                    recordDuration.style.display = 'block';
                    this.updateRecordDuration(recordDuration);

                    // 注册 beforeunload 保护：关闭/刷新页面时尝试保存已录制的内容
                    this._recordBeforeUnload = (e) => {
                        if (this.recordedChunks.length > 0) {
                            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
                            const now = new Date();
                            const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
                            const anchor = this.currentLive?.anchor || '直播录制';
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = `${anchor}_${ts}_未完成.webm`;
                            a.style.display = 'none';
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                        }
                        // 弹出确认对话框提醒用户
                        e.preventDefault();
                        e.returnValue = '正在录制直播，关闭页面将保存已录制的内容，确定离开？';
                    };
                    window.addEventListener('beforeunload', this._recordBeforeUnload);

                    ToastManager.show('开始录制', TOAST.TYPE.INFO);
                } catch (error) {
                    ToastManager.show('录制失败: ' + error.message, TOAST.TYPE.ERROR);
                    console.error('录制失败:', error);
                }
                    } else {
                // 停止录制
                this.mediaRecorder.stop();
                this.isRecording = false;
                this.updateRecordIcon(recordBtn, false);
                recordDuration.style.display = 'none';
                // 注销 beforeunload 保护（正常停止无需触发）
                if (this._recordBeforeUnload) {
                    window.removeEventListener('beforeunload', this._recordBeforeUnload);
                    this._recordBeforeUnload = null;
                }
                ToastManager.show('录制已停止', TOAST.TYPE.INFO);
            }
        };
        
        // 创建录制时长显示容器
        const recordDuration = this.createRecordDuration();
        // 将 recordDuration 添加到 container 中
        if (container) {
            container.appendChild(recordDuration);
        }

        return recordBtn;
    },

    /**
     * 更新录制按钮图标
     * @param {HTMLElement} recordBtn - 录制按钮
     * @param {boolean} isRecording - 是否正在录制
     */
    updateRecordIcon(recordBtn, isRecording) {
        recordBtn.innerHTML = isRecording ? `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ff4d4f" stroke-width="2">
                <line x1="9" y1="6" x2="9" y2="18" />
                <line x1="15" y1="6" x2="15" y2="18" />
            </svg>
        ` : `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2">
                <circle cx="12" cy="12" r="6" fill="#ff2c55"/>
            </svg>
        `;
    },

    /**
     * 创建录制时长容器
     * @returns {HTMLElement} 录制时长容器
     */
    createRecordDuration() {
        // 添加录制时长
        const recordDuration = document.createElement('div');
        Object.assign(recordDuration.style, {
            position: 'absolute',
            bottom: '40px',
            left: '8px',
            background: 'rgba(255, 255, 255, 0.2)',
            color: '#fff',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            display: 'none',
            zIndex: 2,
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            transition: 'all 0.3s ease',
            whiteSpace: 'nowrap',
            lineHeight: '1'
        });

        // 添加鼠标悬浮效果
        recordDuration.addEventListener('mouseenter', () => {
            recordDuration.style.background = 'rgba(0, 0, 0, 0.6)';
        });
        recordDuration.addEventListener('mouseleave', () => {
            recordDuration.style.background = 'rgba(255, 255, 255, 0.2)';
        });

        return recordDuration;
    },

    /**
     * 更新录制时长显示内容
     * @param {HTMLElement} recordDuration - 录制时长显示元素
     */
    updateRecordDuration(recordDuration) {
        if (!this.isRecording) return;
        // 计算录制时长（秒）
        const duration = Math.floor((Date.now() - this.recordStartTime) / 1000);
        // 格式化为 HH:MM:SS（超过1小时也能正确显示）
        const time = new Date(duration * 1000).toISOString().slice(11, 19);
        // 更新录制状态显示
        recordDuration.textContent = `● 录制中 ${time}`;
        // 修复：使用箭头函数保留 this 上下文，并将 recordDuration 传入递归调用
        requestAnimationFrame(() => this.updateRecordDuration(recordDuration));
    },

    /**
     * 创建退出大屏按钮
     * @param {HTMLElement} cardPreview - 卡片预览元素
     * @param {HTMLVideoElement} video - 视频元素
     * @param {number} timerInterval - 计时器ID
     * @param {number} textInterval - 文本定时器ID
     * @returns {HTMLElement} 退出大屏按钮
     */
    createExitFullscreenBtn(cardPreview, video, timerInterval, textInterval, previewContainer) {
        // 添加退出大屏按钮
        const exitFullscreenBtn = document.createElement('div');
        exitFullscreenBtn.setAttribute('title', '退出大屏预览');
        this.createCtrlBtnBaseStyle(exitFullscreenBtn);
        exitFullscreenBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" title="退出大屏预览">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M8 8L16 16"/>
                <path d="M16 8L8 16"/>
            </svg>
        `;
        exitFullscreenBtn.onclick = async (e) => {
            e.preventDefault();
            // 还原氛围词条配置
            this.currentEtmosphereEntryConfig.currentEntryIndex = 0;
            // 统一走 openFullPreview 的完整 cleanupHandler（含 resumeLoading/currentBigVideo/syncInterval/ESC 等）
            if (previewContainer && previewContainer._closeBig) {
                previewContainer._closeBig();
            } else {
                // 兜底：旧逻辑
                const modal = document.getElementById(this.modalId);
                if (modal) { try { this.cleanupResources(); } catch (_) {} modal.remove(); }
            }
            // 卡片侧：抓帧当封面（动态取当前主视频，升清后抓的是蓝光帧）
            if (cardPreview) {
                this.clearPreview(cardPreview, this.currentLive, this.currentBigVideo || video, document.querySelector('.dy-loading'));
            }
        };
        return exitFullscreenBtn;
    },

    /**
     * 创建漂浮文字元素
     * @param {string} entry - 氛围词条
     * @param {object} pos - 位置
     * @param {string} color - 颜色
     * @param {HTMLElement} previewContainer - 容器
     * @returns {HTMLElement} 漂浮文字元素
     */
    createEtmosphereEntry(entry, pos, color, previewContainer) {
        const etmosphereEntry = document.createElement('div');
        etmosphereEntry.className = 'etmosphere-entry';
        const rot = Math.random() * 30 - 15;
        Object.assign(etmosphereEntry.style, {
            position: 'absolute',
            color: color,
            fontSize: `${Math.random() * 16 + 24}px`, // 24-40px
            left: `${pos.left + (Math.random() * 5 * 2 - 5)}%`,
            top: `${pos.top + (Math.random() * 5 * 2 - 5)}%`,
            pointerEvents: 'none',
            textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
            fontWeight: 'bold',
            whiteSpace: 'nowrap',
            zIndex: 1,
            letterSpacing: '1px',
            animationDelay: `${Math.random() * 1.2}s`,
        });
        // 旋转角传给 CSS 动画（淡入 + 缓慢上浮，保持随机旋转）
        etmosphereEntry.style.setProperty('--rot', `${rot}deg`);
        etmosphereEntry.textContent = entry;
        previewContainer.appendChild(etmosphereEntry);
    },

    /**
     * 处理氛围词条并播放语音
     * @param {string} entry - 氛围词条
     * @param {number} index - 索引
     * @param {number} total - 总数
     * @param {HTMLElement} previewContainer - 容器
     */
    playEtmosphereEntryVoice(entry, index, total, previewContainer, formattedEntryList) {
        const processedEntry = TextUtils.standardizeText(entry);
        // 如果当前是最后一条消息，则执行回调
        if (index === total - 1) {
            // 最后一条消息播放完成后，执行回调
            SpeechUtils.addTextToPlayQueue(processedEntry, this.getEtmosphereEntryEnabledState(this.currentLive.secUid), () => {
                // 确保模态框和配置仍然存在
                if (document.getElementById(this.modalId) && this.currentEtmosphereEntryConfig) {
                    this.createEtmosphereEntryAndPlayVoice(previewContainer, formattedEntryList);
                }
            });
        } else {
            // 如果当前不是最后一条消息，则添加到语音队列
            SpeechUtils.addTextToPlayQueue(processedEntry, this.getEtmosphereEntryEnabledState(this.currentLive.secUid));
        }
    },

    /**
     * 创建氛围词条并播放语音
     * @param {HTMLElement} previewContainer - 容器
     * @param {Array} formattedEntryList - 格式化后的氛围词条数组
     */
    createEtmosphereEntryAndPlayVoice(previewContainer, formattedEntryList) {
        Logger.log('createEtmosphereEntryAndPlayVoice', previewContainer, formattedEntryList);
        // 同步语音播报开关（静音法）：关闭只是音量为 0，不影响词条显示与节奏
        SpeechUtils.setMuted(!AtmosphereManager.isVoice(this.currentLive.secUid));
        // 清除现有的漂浮文字
        const existingTexts = previewContainer.querySelectorAll('.etmosphere-entry');
        existingTexts.forEach(text => text.remove());

        // 获取当前批次的5条消息
        const currentEtmosphereEntryList = [];
        for (let i = 0; i < this.currentEtmosphereEntryConfig.entryPerBatchCount; i++) {
            currentEtmosphereEntryList.push(formattedEntryList[(this.currentEtmosphereEntryConfig.currentEntryIndex + i) % formattedEntryList.length]);
        }
        // 更新当前消息索引，计算方法是：当前消息索引 + 每批消息数，然后对消息总数取余
        this.currentEtmosphereEntryConfig.currentEntryIndex = (
            this.currentEtmosphereEntryConfig.currentEntryIndex 
            + this.currentEtmosphereEntryConfig.entryPerBatchCount
        ) 
        % formattedEntryList.length;

        // 随机打乱位置数组
        const shuffledPositions = [...this.currentEtmosphereEntryConfig.positionList].sort(() => Math.random() - 0.5);
        
        // 显示消息
        currentEtmosphereEntryList.forEach((entry, i) => {
            const pos = shuffledPositions[i];
            const randomColor = this.currentEtmosphereEntryConfig.colorList[Math.floor(Math.random() * this.currentEtmosphereEntryConfig.colorList.length)];
            // 创建漂浮文字
            this.createEtmosphereEntry(entry, pos, randomColor, previewContainer);
            // 播放语音
            this.playEtmosphereEntryVoice(entry, i, currentEtmosphereEntryList.length, previewContainer, formattedEntryList);
        });
    }
}; 