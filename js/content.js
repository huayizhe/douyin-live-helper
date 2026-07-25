/**
 * 主入口文件 - 整合所有模块
 */

import { Logger } from './logger.js';
import { ToastManager } from './toast.js';
import { MenuHandler } from './menu.js';
import { SpeechUtils } from './utils.js';
import { PreloadManager } from './preload.js';
import { FavoriteManager } from './favorite.js';
import { SettingsManager } from './settings.js';
import { LicenseManager } from './license.js';
import { AtmosphereManager } from './atmosphere.js';
import { StatsManager } from './stats.js';

// 初始化语音合成
SpeechUtils.init();

/**
 * 插件主类
 */
class DouyinLivePlugin {
    /**
     * 初始化插件
     *
     * 菜单的注入时机、持久化由 MenuHandler 统一负责：
     * 监听导航容器，等 React 渲染稳定后再注入，并在被移除时自动补回。
     */
    init() {
        Logger.log('插件开始初始化');
        MenuHandler.start();
    }
}

// 创建并启动插件（async IIFE，确保 FavoriteManager 缓存在菜单交互前就绪）
(async () => {
    try {
        Logger.log('开始加载插件');
        // 从 chrome.storage 加载特别关心缓存 + 全局设置 + 授权 + 氛围词条
        // Settings 必须先于 PreloadManager.init，以便 applyPerfConfig 读到已加载/钳制的 perf
        await Promise.all([FavoriteManager.init(), SettingsManager.init(), LicenseManager.init(), AtmosphereManager.init(), StatsManager.init()]);
        PreloadManager.init();
        const plugin = new DouyinLivePlugin();
        plugin.init();
    } catch (error) {
        Logger.error('插件加载失败:', error);
        ToastManager.error('插件加载失败，请刷新页面重试');
    }
})();
