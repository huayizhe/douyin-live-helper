/** @charset UTF-8 */

/**
 * 预加载管理器模块
 */

import { Logger } from './logger.js';
import { NetworkUtils, SpeechUtils, DOMUtils, HLSUtils } from './utils.js';
import { NETWORK } from './constants.js';

// 确保 HLS.js 可用
const HLS = window.Hls;

/**
 * 预加载管理器
 * @type {Object}
 */
export const PreloadManager = {
    // 存储预加载的视频流
    preloadCache: new Map(),
    // 存储HLS实例
    hlsInstances: new Map(),
    // 存储视频元素
    videoElements: new Map(),
    // 最大缓存数量
    maxCacheSize: 5,
    // 预加载状态
    loadingStatus: new Map(),
    // 预加载更新间隔（30秒）
    updateInterval: 30000,
    // 添加最后更新时间记录
    lastUpdateTimes: new Map(),
    // 存储每个直播流的重试次数
    retryCount: new Map(),
    // 最大重试次数
    maxRetries: 5,

    /**
     * 初始化预加载管理器
     */
    init() {
        // 检查 HLS.js 是否可用
        if (!HLS) {
            Logger.error('HLS.js 未加载，预加载功能将不可用');
            return;
        }
    },

    /**
     * 创建预加载视频元素
     * @private
     * @returns {HTMLVideoElement} 视频元素
     */
    createPreloadVideo() {
        const video = DOMUtils.createElement('video', {
            styles: {
                display: 'none'
            },
            attributes: {
                muted: 'true',
                playsInline: 'true',
                preload: 'auto'
            }
        });
        
        // 设置音量（因为volume不是标准attribute，需要单独设置）
        video.volume = 0;
        
        document.body.appendChild(video);
        return video;
    },

    /**
     * 设置HLS错误处理
     * @private
     * @param {Hls} hlsInstance - HLS实例
     * @param {string} roomUrl - 直播间URL
     * @param {string} anchor - 主播名称
     */
    setupHLSErrorHandling(hlsInstance, roomUrl, anchor) {
        hlsInstance.on(HLS.Events.ERROR, (event, data) => {
            // 获取当前重试次数
            let retries = this.retryCount.get(roomUrl) || 0;

            Logger.warn(`主播 ${anchor} 的预加载错误详情:`, {
                type: data.type,
                details: data.details,
                fatal: data.fatal,
                url: data.url,
                response: data.response,
                retries: retries,
                headers: data.networkDetails ? data.networkDetails.getAllResponseHeaders() : null
            });

            // 如果超过最大重试次数，停止重试
            if (retries >= this.maxRetries) {
                Logger.error(`主播 ${anchor} 的预加载失败，已达到最大重试次数 ${this.maxRetries} 次，停止重试`);
                this.cleanupStream(roomUrl);
                this.loadingStatus.set(roomUrl, 'error');
                this.retryCount.delete(roomUrl);
                return;
            }

            if (data.type === HLS.ErrorTypes.NETWORK_ERROR) {
                Logger.warn(`主播 ${anchor} 的预加载网络错误，第 ${retries + 1} 次重试:`, data);
                this.retryCount.set(roomUrl, retries + 1);
                hlsInstance.startLoad();
            } else if (data.type === HLS.ErrorTypes.MEDIA_ERROR) {
                Logger.warn(`主播 ${anchor} 的预加载媒体错误，第 ${retries + 1} 次重试:`, data);
                this.retryCount.set(roomUrl, retries + 1);
                hlsInstance.recoverMediaError();
            } else if (data.fatal) {
                Logger.error(`主播 ${anchor} 的预加载致命错误:`, data);
                this.cleanupStream(roomUrl);
                this.loadingStatus.set(roomUrl, 'error');
                this.retryCount.delete(roomUrl);
            }
        });

        hlsInstance.on(HLS.Events.MANIFEST_LOADED, (event, data) => {
            Logger.log(`主播 ${anchor} 的预加载成功:`, data);
            // 重置重试次数
            this.retryCount.delete(roomUrl);
        });
    },

    /**
     * 监控视频缓冲状态
     * @private
     * @param {HTMLVideoElement} video - 视频元素
     * @param {Object} live - 直播信息
     * @param {string} streamUrl - 流地址
     */
    monitorBufferStatus(video, live, streamUrl) {
        let active = true;
        if (!this._bufferMonitors) this._bufferMonitors = new Map();
        this._bufferMonitors.set(live.roomUrl, () => { active = false; });

        const checkBuffer = () => {
            if (!active) return;
            if (video.buffered.length) {
                const buffered = video.buffered.end(0) - video.buffered.start(0);
                // 缓冲区大于5秒，则认为预加载完成
                if (buffered >= 5) {
                    this._bufferMonitors.delete(live.roomUrl);
                    this.cacheStream(live.roomUrl, {
                        hls: this.hlsInstances.get(live.roomUrl),
                        video,
                        // 预览默认使用标清
                        quality: NETWORK.DOWNLINK_SPEED.SD1,
                        timestamp: Date.now(),
                        anchor: live.anchor,
                        streamUrl
                    });
                    Logger.log(`主播 ${live.anchor} 的直播流预加载完成`);
                    return;
                }
            }
            requestAnimationFrame(checkBuffer);
        };
        checkBuffer();
    },

    /**
     * 预加载直播流
     * @param {Object} live - 直播信息对象
     */
    async preloadStream(live) {
        Logger.log('进入preloadStream:', live);
        
        if (!HLS) {
            Logger.error('HLS.js 未加载，无法预加载');
            return;
        }

        // 如果正在加载或者已经缓存，则直接返回
        if (this.loadingStatus.get(live.roomUrl) === 'loading' || 
            this.preloadCache.has(live.roomUrl)) {
            return;
        }

        Logger.log('开始预加载主播直播流:', live.anchor);
        // 设置加载状态为正在加载
        this.loadingStatus.set(live.roomUrl, 'loading');

        try {
            const video = this.createPreloadVideo();
            this.videoElements.set(live.roomUrl, video);

            if (HLS.isSupported()) {
                // 创建HLS实例
                const hlsInstance = new HLS(HLSUtils.createPreloadConfig());
                // 设置HLS错误处理
                this.setupHLSErrorHandling(hlsInstance, live.roomUrl, live.anchor);
                // 存储HLS实例
                this.hlsInstances.set(live.roomUrl, hlsInstance);
                // 获取最低清晰度的流地址
                const lowestQualityUrl = NetworkUtils.getLowestQualityUrl(live.streamUrlHlsMap);
                // 加载流地址
                hlsInstance.loadSource(lowestQualityUrl);
                // 将视频元素与HLS实例关联
                hlsInstance.attachMedia(video);
                // 监听HLS实例的MANIFEST_PARSED事件，表示流地址解析完成
                hlsInstance.on(HLS.Events.MANIFEST_PARSED, () => {
                    video.play().catch(() => {});
                    // 监控缓冲状态
                    this.monitorBufferStatus(video, live, lowestQualityUrl);
                });

            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // 如果HLS.js不可用，则使用原生HLS播放
                const lowestQualityUrl = NetworkUtils.getLowestQualityUrl(live.streamUrlHlsMap);
                video.src = lowestQualityUrl;
                // 监听视频的loadedmetadata事件，表示视频元数据加载完成
                video.addEventListener('loadedmetadata', () => {
                    // 播放视频
                    video.play().catch(() => {});
                });
            }

        } catch (error) {
            // 捕获错误
            Logger.error(`预加载主播 ${live.anchor} 的直播流失败:`, error);
            // 设置加载状态为错误
            this.loadingStatus.set(live.roomUrl, 'error');
            // 清理直播流
            this.cleanupStream(live.roomUrl);
        }

        // 设置最后更新时间
        this.lastUpdateTimes.set(live.roomUrl, Date.now());
    },

    /**
     * 缓存直播流
     * @param {string} roomUrl - 直播间URL
     * @param {Object} streamData - 流数据
     */
    cacheStream(roomUrl, streamData) {
        Logger.log('进入cacheStream:', roomUrl, streamData);
        // 检查缓存大小
        if (this.preloadCache.size >= this.maxCacheSize) {
            // 删除最旧的缓存
            const oldestKey = Array.from(this.preloadCache.entries())
                .sort(([, a], [, b]) => a.timestamp - b.timestamp)[0][0];
            this.cleanupStream(oldestKey);
        }
        // 缓存流数据
        this.preloadCache.set(roomUrl, streamData);
        // 更新流的加载状态
        this.loadingStatus.set(roomUrl, 'loaded');
    },

    /**
     * 清理直播流
     * @param {string} roomUrl - 直播间URL
     */
    cleanupStream(roomUrl) {
        Logger.log('进入cleanupStream:', roomUrl);
        // 停止该流的缓冲监控 rAF 循环
        if (this._bufferMonitors && this._bufferMonitors.has(roomUrl)) {
            this._bufferMonitors.get(roomUrl)();
            this._bufferMonitors.delete(roomUrl);
        }
        // 获取缓存的流数据
        const cached = this.preloadCache.get(roomUrl);
        // 获取HLS实例
        const hlsInstance = this.hlsInstances.get(roomUrl);
        // 获取视频元素
        const video = this.videoElements.get(roomUrl);
        
        if (hlsInstance) {
            // 销毁HLS实例
            hlsInstance.destroy();
            // 删除HLS实例
            this.hlsInstances.delete(roomUrl);
        }

        if (video) {
            // 暂停视频
            video.pause();
            // 删除视频元素
            video.remove();
            // 删除视频元素
            this.videoElements.delete(roomUrl);
        }

        // 删除缓存的流数据
        this.preloadCache.delete(roomUrl);
        // 删除流的加载状态
        this.loadingStatus.delete(roomUrl);
        // 删除最后更新时间
        this.lastUpdateTimes.delete(roomUrl);
        // 删除重试次数
        this.retryCount.delete(roomUrl);
    },

    /**
     * 获取预加载的流
     * @param {string} roomUrl - 直播间URL
     * @returns {Object} 预加载的流数据
     */
    getPreloadedStream(roomUrl) {
        Logger.log('进入getPreloadedStream:', roomUrl);
        // 获取缓存的流数据
        const cached = this.preloadCache.get(roomUrl);
        // 如果缓存中没有流数据，则返回null
        if (!cached) return null;

        // 检查是否需要更新
        const now = Date.now();
        const lastUpdate = this.lastUpdateTimes.get(roomUrl) || 0;

        // 如果最后一次更新时间与当前时间相差大于更新间隔，则需要重新加载
        if (now - lastUpdate > this.updateInterval) {
            Logger.log(`主播 ${cached.anchor} 的预加载流已过期，需要重新加载`);
            // 异步更新，不阻塞当前播放
            setTimeout(() => {
                this.cleanupStream(roomUrl);
                this.preloadStream({ 
                    roomUrl, 
                    streamUrl: cached.streamUrl,
                    anchor: cached.anchor 
                });
            }, 0);
        }

        // 使用主播的预加载流进行播放
        Logger.log(`使用主播 ${cached.anchor} 的预加载流进行播放`);
        return cached;
    }
}; 