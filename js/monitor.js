/**
 * 资源监控模块
 */

import { Logger } from './logger.js';
import { DOMUtils, StyleUtils } from './utils.js';
import { PreloadManager } from './preload.js';
import { PreviewManager } from './preview.js';

export const ResourceMonitor = {
    // 监控数据
    metrics: {
        memory: {
            heapUsed: 0,
            heapTotal: 0,
            heapLimit: 0
        },
        resources: {
            videoElements: {
                count: 0,
                memory: 0
            },
            hlsInstances: {
                count: 0,
                memory: 0
            },
            preloadStreams: {
                count: 0,
                memory: 0
            },
            previewImages: {
                count: 0,
                memory: 0
            }
        },
        storage: {
            localStorageUsed: 0,
            localStorageLimit: 10 * 1024 * 1024  // 10MB
        }
    },

    // 历史数据（用于图表展示）
    history: {
        memory: [],
        resources: [],
        maxHistoryLength: 100
    },

    // 监控面板DOM元素
    panel: null,
    isVisible: false,

    /**
     * 初始化监控
     */
    init() {
        this.startMonitoring();
        this.createMonitorPanel();
    },

    /**
     * 开始监控
     */
    startMonitoring() {
        // 每秒更新一次数据
        setInterval(() => {
            this.updateMetrics();
            this.updateHistory();
            if (this.isVisible) {
                this.updatePanel();
            }
        }, 1000);
    },

    /**
     * 计算视频元素占用的内存
     * 假设每个视频元素缓冲区平均5MB
     */
    calculateVideoElementsMemory(count) {
        const averageBufferSize = 5 * 1024 * 1024; // 5MB
        return count * averageBufferSize;
    },

    /**
     * 计算HLS实例占用的内存
     * 包括HLS.js实例和相关缓冲数据
     */
    calculateHLSInstancesMemory(count) {
        const averageInstanceSize = 2 * 1024 * 1024; // 2MB per instance
        return count * averageInstanceSize;
    },

    /**
     * 计算预加载流占用的内存
     * 基于预加载配置的缓冲区大小
     */
    calculatePreloadStreamsMemory(count) {
        const bufferSize = PreloadManager.maxBufferSize || 5 * 1024 * 1024; // 5MB or configured size
        return count * bufferSize;
    },

    /**
     * 计算预览图片占用的内存
     * 基于localStorage中的图片数据
     */
    calculatePreviewImagesMemory() {
        let total = 0;
        for (let key in localStorage) {
            if (key.startsWith('preview_')) {
                total += localStorage[key].length;
            }
        }
        return total * 2; // UTF-16 编码，每个字符2字节
    },

    /**
     * 更新监控指标
     */
    updateMetrics() {
        // 更新内存使用
        if (performance.memory) {
            this.metrics.memory = {
                heapUsed: performance.memory.usedJSHeapSize,
                heapTotal: performance.memory.totalJSHeapSize,
                heapLimit: performance.memory.jsHeapSizeLimit
            };
        }

        // 更新资源计数和内存占用
        const videoCount = document.getElementsByTagName('video').length;
        const hlsCount = PreviewManager.hlsInstances.size;
        const preloadCount = PreloadManager.preloadCache.size;
        const previewCount = this.countPreviewImages();

        this.metrics.resources = {
            videoElements: {
                count: videoCount,
                memory: this.calculateVideoElementsMemory(videoCount)
            },
            hlsInstances: {
                count: hlsCount,
                memory: this.calculateHLSInstancesMemory(hlsCount)
            },
            preloadStreams: {
                count: preloadCount,
                memory: this.calculatePreloadStreamsMemory(preloadCount)
            },
            previewImages: {
                count: previewCount,
                memory: this.calculatePreviewImagesMemory()
            }
        };

        // 更新存储使用
        this.metrics.storage.localStorageUsed = this.calculateStorageSize();
    },

    /**
     * 更新历史数据
     */
    updateHistory() {
        const timestamp = Date.now();

        this.history.memory.push({
            timestamp,
            heapUsed: this.metrics.memory.heapUsed,
            heapTotal: this.metrics.memory.heapTotal
        });

        this.history.resources.push({
            timestamp,
            videoElements: this.metrics.resources.videoElements,
            hlsInstances: this.metrics.resources.hlsInstances,
            preloadStreams: this.metrics.resources.preloadStreams
        });

        // 限制历史数据长度
        if (this.history.memory.length > this.history.maxHistoryLength) {
            this.history.memory.shift();
            this.history.resources.shift();
        }
    },

    /**
     * 计算localStorage使用量
     */
    calculateStorageSize() {
        let total = 0;
        for (let key in localStorage) {
            if (localStorage.hasOwnProperty(key)) {
                total += (localStorage[key].length + key.length) * 2; // UTF-16 编码，每个字符2字节
            }
        }
        return total;
    },

    /**
     * 统计预览图片数量
     */
    countPreviewImages() {
        return Object.keys(localStorage).filter(key => key.startsWith('preview_')).length;
    },

    /**
     * 更新面板显示
     */
    updatePanel() {
        if (!this.panel) return;

        // 更新内存统计
        const memoryStats = this.panel.querySelector('.memory-stats');
        memoryStats.innerHTML = `
            <div>堆内存使用：${this.formatSize(this.metrics.memory.heapUsed)} (页面总体)</div>
            <div>堆内存总量：${this.formatSize(this.metrics.memory.heapTotal)} (页面总体)</div>
            <div>堆内存限制：${this.formatSize(this.metrics.memory.heapLimit)} (浏览器限制)</div>
            <div>使用率：${((this.metrics.memory.heapUsed / this.metrics.memory.heapLimit) * 100).toFixed(1)}% (相对于限制)</div>
        `;

        // 更新资源统计
        const resourceStats = this.panel.querySelector('.resource-stats');
        const totalResourceMemory = Object.values(this.metrics.resources).reduce((sum, resource) => sum + resource.memory, 0);
        
        resourceStats.innerHTML = `
            <div>视频元素：${this.metrics.resources.videoElements.count}个 (${this.formatSize(this.metrics.resources.videoElements.memory)})</div>
            <div>HLS实例：${this.metrics.resources.hlsInstances.count}个 (${this.formatSize(this.metrics.resources.hlsInstances.memory)})</div>
            <div>预加载流：${this.metrics.resources.preloadStreams.count}个 (${this.formatSize(this.metrics.resources.preloadStreams.memory)})</div>
            <div>预览图片：${this.metrics.resources.previewImages.count}个 (${this.formatSize(this.metrics.resources.previewImages.memory)})</div>
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${StyleUtils.isDarkMode() ? '#333' : '#eee'}">
                资源总占用：${this.formatSize(totalResourceMemory)}
            </div>
        `;

        // 更新存储统计
        const storageStats = this.panel.querySelector('.storage-stats');
        const storageUsagePercent = Math.min(100, (this.metrics.storage.localStorageUsed / this.metrics.storage.localStorageLimit) * 100);
        storageStats.innerHTML = `
            <div>LocalStorage使用：${this.formatSize(this.metrics.storage.localStorageUsed)} (上限${this.formatSize(this.metrics.storage.localStorageLimit)})</div>
            <div>使用率：${storageUsagePercent.toFixed(1)}%</div>
            ${storageUsagePercent >= 90 ? '<div style="color: #ff4d4f;">警告：存储空间即将用尽，建议清理</div>' : ''}
        `;
    },

    /**
     * 创建监控面板
     */
    createMonitorPanel() {
        const isDarkMode = StyleUtils.isDarkMode();
        
        this.panel = DOMUtils.createElement('div', {
            className: 'resource-monitor-panel',
            styles: {
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '600px',
                maxHeight: '80vh',
                background: isDarkMode ? '#1f1f1f' : '#fff',
                borderRadius: '8px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                zIndex: 10000,
                display: 'none',
                flexDirection: 'column',
                color: isDarkMode ? '#fff' : '#000'
            }
        });

        // 添加面板内容
        this.panel.innerHTML = `
            <div style="padding: 16px 20px; border-bottom: 1px solid ${isDarkMode ? '#333' : '#eee'}; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; font-size: 16px;">资源监控面板</h3>
                <button class="close-btn" style="background: none; border: none; cursor: pointer; padding: 4px;">
                    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                        <path d="M15 5L5 15M5 5L15 15" stroke="${isDarkMode ? '#fff' : '#000'}" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                </button>
            </div>
            <div style="padding: 20px; overflow-y: auto;">
                <div class="monitor-section">
                    <h4>内存使用</h4>
                    <div class="memory-stats"></div>
                </div>
                <div class="monitor-section">
                    <h4>资源统计</h4>
                    <div class="resource-stats"></div>
                </div>
                <div class="monitor-section">
                    <h4>存储使用</h4>
                    <div class="storage-stats"></div>
                </div>
            </div>
        `;

        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            .monitor-section {
                margin-bottom: 20px;
            }
            .monitor-section h4 {
                margin: 0 0 10px 0;
                font-size: 14px;
                color: ${isDarkMode ? '#aaa' : '#666'};
            }
            .memory-stats, .resource-stats, .storage-stats {
                background: ${isDarkMode ? '#2d2d2d' : '#f5f5f5'};
                padding: 12px;
                border-radius: 4px;
                font-size: 13px;
                line-height: 1.6;
            }
        `;
        document.head.appendChild(style);

        // 添加关闭按钮事件
        this.panel.querySelector('.close-btn').onclick = () => {
            this.hidePanel();
        };

        document.body.appendChild(this.panel);
    },

    /**
     * 显示面板
     */
    showPanel() {
        if (this.panel) {
            this.panel.style.display = 'flex';
            this.isVisible = true;
            this.updatePanel();
        }
    },

    /**
     * 隐藏面板
     */
    hidePanel() {
        if (this.panel) {
            this.panel.style.display = 'none';
            this.isVisible = false;
        }
    },

    /**
     * 格式化大小显示
     */
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    }
}; 