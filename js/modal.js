/**
 * 模态框模块
 */

import { Logger } from './logger.js';
import { DOMUtils, StyleUtils } from './utils.js';
import { LiveCard } from './card.js';
import { FavoriteManager } from './favorite.js';
import { ResourceMonitor } from './monitor.js';
import { PreviewManager } from './preview.js';
import { PreloadManager } from './preload.js';
import { SettingsManager } from './settings.js';
import { ToastManager } from './toast.js';
import { LicenseManager } from './license.js';
import { StatsManager } from './stats.js';
import { LICENSE } from './constants.js';
import {
    PLAY_ROOT_MARGIN,
    PLAY_THRESHOLDS,
    shouldPlayCard
} from './playback-gate.js';
import {
    MENU_BTN_WIDTH_PX,
    getMenuBtnInlineStyle
} from './menu-btn-layout.js';
import { SupportManager } from './support.js';

const ModalUI = {
    /**
     * 添加快捷键处理器引用
     */
    keydownHandler: null,

    /**
     * 当前排序模式：'default'（接口顺序）| 'popularity'（人气）| 'mostWatched'（最常看·本周）
     */
    sortMode: 'default',

    /**
     * 排序状态
     */
    isSorted: false,

    /**
     * 特别关心筛选状态
     */
    isFiltering: false,

    /**
     * 多路对比预览已选直播间（最多 3 个）
     */
    _compareList: [],

    /**
     * 对比预览按钮引用（用于更新计数/禁用态）
     */
    _compareButton: null,

    /**
     * 对比预览最大路数
     */
    COMPARE_MAX: 3,

    /**
     * 网格列数控制：按容器宽度算列数并夹在 [MIN, MAX]（均可调）
     * GRID_TARGET 为单卡目标宽度（决定多宽换一列），GRID_GAP 需与 .live-grid 的 gap 一致
     */
    GRID_TARGET: 280,
    GRID_MIN_COLS: 2,
    GRID_MAX_COLS: 6,
    GRID_GAP: 20,

    /**
     * 卡片进视口后停留多久才开始录制（毫秒）：避免快速滚动一闪而过的卡片也拉流，省无用功。
     * 命中缓存的片段不受此延迟影响，立即挂上播放。
     * 实际取值从 SettingsManager.getPerfConfig().clipSettleMs 读取（默认 400）。
     */
    CLIP_SETTLE_MS: 400,

    /**
     * 当前生效的进视口停留毫秒（设置面板可调）。
     * @returns {number}
     * @private
     */
    _clipSettleMs() {
        try {
            const ms = SettingsManager.getPerfConfig().clipSettleMs;
            return Number.isFinite(ms) ? ms : this.CLIP_SETTLE_MS;
        } catch (_) {
            return this.CLIP_SETTLE_MS;
        }
    },

    /**
     * 显示模态框
     */
    async show() {
        Logger.log('开始显示直播弹窗');
        // 每次打开重置对比选择
        this._compareList = [];
        const isDarkMode = StyleUtils.isDarkMode();
        const modal = this.createModal(isDarkMode);
        document.body.appendChild(modal);

        // 禁用抖音快捷键
        this.disableDouyinShortcuts();

        await this.loadContent(modal, isDarkMode);
    },

    /**
     * 禁用抖音快捷键
     * @private
     */
    disableDouyinShortcuts() {
        // 创建事件处理器
        this.keydownHandler = (e) => {
            // ESC 键：先关「最上层」的浮层，再关列表（标准栈式关闭，体验统一不出错）
            if (e.key === 'Escape') {
                // 1) PRO 授权/会员信息弹窗（z-index 最高，叠在大屏之上时也要能关）
                const proDialog = document.getElementById('dylh-overlay');
                if (proDialog) { e.stopPropagation(); proDialog.remove(); return; }
                // 1.5) 赞赏/交流弹窗
                if (SupportManager.isOpen()) { e.stopPropagation(); SupportManager.hidePanel(); return; }
                // 2) 资源监控面板（叠在大屏之上时也要能关）
                const resPanel = document.querySelector('.resource-monitor-panel');
                if (resPanel && resPanel.style.display !== 'none') { e.stopPropagation(); ResourceMonitor.hidePanel(); return; }
                // 3) 大屏/对比预览/浏览器全屏：由它们自己的 ESC 处理，这里不插手
                if (document.getElementById('dy-modal') ||
                    document.getElementById('dy-compare-modal') ||
                    document.fullscreenElement) return;
                // 4) 否则关闭直播列表
                const modal = DOMUtils.findElement('.live-modal');
                if (modal) {
                    this.enableDouyinShortcuts();
                    this._teardownClipObserver();
                    this._teardownPlaybackObserver();
                    this._teardownBatchObserver();
                    this._teardownGridResize();
                    PreloadManager.visible.clear();
                    modal.remove();
                }
                return;
            }
            // 阻止其他键盘事件（防止抖音快捷键干扰）
            e.stopPropagation();
        };

        // 在捕获阶段添加事件监听
        document.addEventListener('keydown', this.keydownHandler, true);
    },

    /**
     * 恢复抖音快捷键
     * @private
     */
    enableDouyinShortcuts() {
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler, true);
            this.keydownHandler = null;
        }
    },

    /**
     * 创建模态框
     * @private
     */
    createModal(isDarkMode) {
        const modal = DOMUtils.createElement('div', {
            className: 'live-modal',
            styles: {
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                background: 'rgba(0,0,0,0.8)',
                zIndex: 9999,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center'
            }
        });

        const content = this.createModalContent(isDarkMode);
        modal.appendChild(content);
        return modal;
    },

    /**
     * 创建模态框内容
     * @private
     */
    createModalContent(isDarkMode) {
        const content = DOMUtils.createElement('div', {
            className: 'live-modal-content',
            styles: {
                background: isDarkMode ? '#161823' : 'white',
                borderRadius: '0',
                position: 'relative',
                width: '100vw',
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                color: isDarkMode ? '#fff' : '#000'
            }
        });

        const header = this.createHeader(isDarkMode);
        const contentArea = this.createContentArea(isDarkMode);
        
        content.appendChild(header);
        content.appendChild(contentArea);

        return content;
    },

    /**
     * 创建页眉
     * @private
     */
    createHeader(isDarkMode) {
        const header = DOMUtils.createElement('div', {
            styles: {
                padding: '16px 20px',
                borderBottom: `1px solid ${isDarkMode ? '#3f3f3f' : '#eee'}`,
                display: 'flex',
                alignItems: 'flex-start',
                position: 'relative'
            }
        });

        const leftGroup = DOMUtils.createElement('div', {
            styles: {
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '10px',
                flex: 1,
                paddingRight: '48px' // 给绝对定位的关闭按钮留位，避免首行按钮被压住
            }
        });

        // 创建所有按钮和输入框
        const searchInput = this.createSearchInput(isDarkMode);      // 搜索输入框
        const favoriteButton = this.createFavoriteButton(isDarkMode); // 特别关心按钮
        const sortButton = this.createSortButton(isDarkMode);        // 排序按钮
        const refreshButton = this.createRefreshButtonElement(isDarkMode);  // 刷新按钮
        const globalSoundBtn = this.createGlobalSoundBtn(isDarkMode);       // 声音总开关
        const compareButton = this.createCompareButton(isDarkMode);        // 对比预览
        const clearCompareButton = this.createClearCompareButton(isDarkMode); // 清除已选
        const scrollTopButton = this.createScrollTopButton(isDarkMode);    // 回到顶部按钮
        const resourceButton = this.createResourceButton(isDarkMode);     // 资源/设置（监控+性能参数+备份）
        // PRO 授权按钮：会员体系关闭时不创建（LICENSE.ENABLED=false）
        const licenseBtn = LICENSE.ENABLED ? LicenseManager.createLicenseBtn(isDarkMode) : null;
        const supportButton = this.createSupportButton(isDarkMode);       // 赞赏/交流
        const liveCount = this.createLiveCountElement(isDarkMode);   // 直播数量显示
        const closeButton = this.createCloseButton(isDarkMode);      // 关闭按钮

        // 统一菜单按钮宽高（整洁排列）：文字不换行、固定 104×36、居中、换行时不拉伸
        // 「资源/设置」与其它按钮同宽，不再单独加宽
        const MENU_BTN = getMenuBtnInlineStyle();
        [favoriteButton, sortButton, refreshButton, globalSoundBtn,
         compareButton, clearCompareButton, scrollTopButton, resourceButton, licenseBtn, supportButton, liveCount]
            .forEach(btn => { if (btn) Object.assign(btn.style, MENU_BTN); });
        // PRO 按钮：与其它按钮等大（badge 由 CSS 填满整框），去掉左右 padding 让金色 badge 占满 104px
        if (licenseBtn) Object.assign(licenseBtn.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0' });

        // 强迫症：不足 4 个字的标签撑成 4 字宽（两端对齐＝中间空格填充观感），>=4 字不动。
        // 声音按钮会重建 innerHTML，其 updateIcon 内已自带 _justifyShortLabel，这里不重复处理。
        [favoriteButton, sortButton, refreshButton, compareButton, clearCompareButton, scrollTopButton, resourceButton, supportButton, globalSoundBtn]
            .forEach(btn => { if (btn) this._justifyShortLabel(btn.querySelector('span')); });

        // 搜索框：宽度 = 两个按钮宽 + 一个间隔（与按钮网格对齐显得整齐），高度对齐 36
        const btnW = MENU_BTN_WIDTH_PX;
        const searchW = btnW * 2 + 10;               // 两按钮 + 一个 gap(10)
        Object.assign(searchInput.style, {
            width: `${searchW}px`,
            height: '36px',
            boxSizing: 'border-box',
            flex: '0 0 auto'
        });

        // 关闭按钮：始终钉在右上角（header 已是 position:relative）
        Object.assign(closeButton.style, { position: 'absolute', top: '12px', right: '16px' });

        // 注册特别关心导入后的列表刷新钩子（备份已迁入资源/设置面板，避免 monitor↔modal 循环依赖）
        ResourceMonitor.setFavoritesChangeHandler(() => this._rerenderView());

        // 按顺序添加到左侧按钮组
        leftGroup.appendChild(searchInput);    // 1. 搜索框放最左边
        leftGroup.appendChild(favoriteButton); // 2. 特别关心按钮
        leftGroup.appendChild(sortButton);     // 3. 排序按钮
        leftGroup.appendChild(refreshButton);  // 4. 刷新按钮
        leftGroup.appendChild(globalSoundBtn); // 5. 声音总开关
        leftGroup.appendChild(compareButton);  // 6. 对比预览
        leftGroup.appendChild(clearCompareButton); // 7. 清除已选
        leftGroup.appendChild(scrollTopButton);// 8. 回到顶部按钮
        leftGroup.appendChild(resourceButton); // 9. 资源/设置（含备份 Tab）
        if (licenseBtn) leftGroup.appendChild(licenseBtn); // 10. PRO 授权按钮（会员开关关则无）
        leftGroup.appendChild(supportButton);  // 11. 赞赏/交流（在人数左侧）
        leftGroup.appendChild(liveCount);      // 12. 直播数量显示

        // 组装页眉
        header.appendChild(leftGroup);         // 左侧按钮组
        header.appendChild(closeButton);       // 右侧关闭按钮

        return header;
    },

    /**
     * 让不足 4 个字的中文标签两端对齐撑成 4 字宽（视觉上中间空格填充），≥4 字不动。
     * @private
     * @param {HTMLElement|null} span - 标签元素
     */
    _justifyShortLabel(span) {
        if (!span) return;
        const t = (span.textContent || '').trim();
        if (t.length >= 2 && t.length < 4) {
            Object.assign(span.style, {
                display: 'inline-block',
                width: '4em',
                textAlign: 'justify',
                textAlignLast: 'justify'
            });
        }
    },

    /**
     * 创建搜索框
     * @private
     */
    createSearchInput(isDarkMode) {
        return DOMUtils.createElement('input', {
            className: 'search-input',
            attributes: {
                type: 'text',
                placeholder: '请输入昵称或标题'
            },
            styles: {
                width: '300px',
                padding: '8px 12px',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                background: isDarkMode ? '#161823' : 'white',
                color: isDarkMode ? '#fff' : '#000',
                fontSize: '14px',
                textAlign: 'center'
            }
        });
    },

    /**
     * 创建特别关心按钮
     * @private
     */
    createFavoriteButton(isDarkMode) {
        const button = DOMUtils.createElement('div', {
            className: 'favorite-filter-button',
            styles: {
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '6px 12px',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                cursor: 'pointer',
                color: isDarkMode ? '#fff' : '#666',
                fontSize: '14px',
                userSelect: 'none',
                transition: 'background-color 0.2s'
            }
        });

        button.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            <span>特别关心</span>
        `;

        button.addEventListener('click', () => {
            this.isFiltering = !this.isFiltering;
            
            // 更新按钮样式
            button.style.background = this.isFiltering 
                ? (isDarkMode ? '#ff2c55' : '#ffe8ec')
                : 'transparent';
            button.style.color = this.isFiltering
                ? (isDarkMode ? '#fff' : '#ff2c55')
                : (isDarkMode ? '#fff' : '#666');

            // 统一按当前「搜索 + 特别关心 + 排序」重渲染
            if (!this.currentLiveList) return;
            this._rerenderView();
        });

        return button;
    },

    /**
     * 创建内容区域
     * @private
     */
    createContentArea(isDarkMode) {
        return DOMUtils.createElement('div', {
            styles: {
                flex: 1,
                overflow: 'auto',
                padding: '20px'
            },
            innerHTML: `
                <div class="live-grid" style="
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 20px;
                    width: 100%;
                    padding: 0;
                "></div>
            `
        });
    },

    /**
     * 创建关闭按钮
     * @private
     */
    createCloseButton(isDarkMode) {
        const button = DOMUtils.createElement('div', {
            innerHTML: `
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 6L6 18" stroke="${isDarkMode ? '#fff' : '#000'}" stroke-width="2" stroke-linecap="round"/>
                    <path d="M6 6L18 18" stroke="${isDarkMode ? '#fff' : '#000'}" stroke-width="2" stroke-linecap="round"/>
                </svg>
            `,
            styles: {
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s'
            }
        });

        button.addEventListener('mouseover', () => {
            button.style.backgroundColor = isDarkMode ? '#3f3f3f' : '#f5f5f5';
        });

        button.addEventListener('mouseout', () => {
            button.style.backgroundColor = 'transparent';
        });

        button.onclick = () => {
            const modal = DOMUtils.findElement('.live-modal');
            if (modal) {
                // 恢复抖音快捷键
                this.enableDouyinShortcuts();
                this._teardownClipObserver();
                this._teardownPlaybackObserver();
                this._teardownBatchObserver();
                this._teardownGridResize();
                PreloadManager.visible.clear();
                modal.remove();
            }
        };

        return button;
    },

    /**
     * 加载内容
     * @private
     */
    async loadContent(modal, isDarkMode) {
        const liveGrid = modal.querySelector('.live-grid');
        if (!liveGrid) {
            Logger.error('未找到直播列表容器元素');
            return;
        }

        // 按容器宽度算列数（夹在 2~6）并绑定 resize 重算
        this._setupGridResize(liveGrid);

        try {
            // 显示加载动画
            liveGrid.innerHTML = `
                <div style="
                    grid-column: 1 / -1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    gap: 16px;
                    padding: 80px 20px;
                    color: ${isDarkMode ? '#fff' : '#666'};
                ">
                    <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="24" cy="24" r="20" fill="none" stroke="${isDarkMode ? '#fff' : '#999'}" stroke-width="4" stroke-dasharray="80,50" stroke-linecap="round">
                            <animateTransform attributeName="transform" type="rotate" from="0 24 24" to="360 24 24" dur="0.9s" repeatCount="indefinite"/>
                        </circle>
                    </svg>
                    <div style="font-size: 14px;">加载中…</div>
                </div>
            `;

            const liveList = await this.fetchLiveList();
            this.currentLiveList = liveList; // 保存当前列表数据

            // 更新直播人数显示
            this.updateLiveCount(modal, liveList.length);

            if (!liveList.length) {
                liveGrid.innerHTML = `
                    <div style="
                        grid-column: 1 / -1;
                        color: ${isDarkMode ? '#fff' : '#666'};
                        text-align: center;
                        padding: 60px 20px;
                        font-size: 16px;
                    ">
                        当前没有正在关注的直播
                    </div>
                `;
                return;
            }

            this.renderLiveList(liveList, liveGrid, isDarkMode);
            this.setupSearch(modal, liveList, liveGrid, isDarkMode);
        } catch (error) {
            Logger.error('加载直播列表失败:', error);
            this.showError(liveGrid, isDarkMode);
        }
    },

    /**
     * 通过 MAIN 世界桥接脚本请求关注直播 feed
     *
     * 内容脚本的 fetch 拿不到抖音的反爬签名，因此把请求交给页面主世界的 bridge.js
     * （复用抖音自动签名的 fetch + Cookie），用 postMessage 通信、Promise 等待回包。
     *
     * @private
     * @returns {Promise<Object>} 抖音接口返回的原始 JSON
     */
    requestFollowFeedViaBridge() {
        return new Promise((resolve, reject) => {
            const requestId = `dylh_${Date.now()}_${Math.random().toString(36).slice(2)}`;

            const cleanup = () => {
                clearTimeout(timer);
                window.removeEventListener('message', onMessage);
            };

            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('请求超时：未收到桥接脚本响应'));
            }, 15000);

            const onMessage = (event) => {
                if (event.source !== window) return;
                const msg = event.data;
                if (!msg || msg.type !== 'DYLH_FOLLOW_FEED_RESULT' || msg.requestId !== requestId) return;
                cleanup();
                if (msg.ok) {
                    Logger.log('feed/follow HTTP 状态:', msg.httpStatus);
                    resolve(msg.data);
                } else {
                    reject(new Error(msg.error || '桥接请求失败'));
                }
            };

            window.addEventListener('message', onMessage);
            window.postMessage({ type: 'DYLH_FETCH_FOLLOW_FEED', requestId }, window.location.origin);
        });
    },

    /**
     * 获取直播列表
     * @returns {Promise<Array>} 直播列表
     */
    async fetchLiveList() {
        try {
            Logger.log('开始获取直播列表');

            const data = await this.requestFollowFeedViaBridge();

            // 诊断日志：打印完整响应，便于排查空列表根因
            Logger.log('feed/follow 完整响应:', data);
            Logger.log('status_code:', data?.status_code, data?.data?.message);
            console.log('直播列表的第一条数据：', data?.data?.data?.[0]);

            // 检查是否成功获取数据
            if (!data?.data?.data) {
                Logger.warn('获取直播列表失败:', data);
                return [];
            }

            // 解析直播列表数据
            const liveList = data.data.data.map(item => {
                try {
                    const roomData = item.room;
                    return {
                        anchor: roomData.owner.nickname,
                        roomUrl: `https://live.douyin.com/${item.web_rid}`,
                        avatar: roomData.owner.avatar_thumb.url_list[0],
                        cover: roomData.cover.url_list[0],
                        title: roomData.title,
                        viewerCount: parseInt(roomData.stats.user_count_str) || 0,
                        user_count_str: roomData.stats.user_count_str,
                        secUid: roomData.owner.sec_uid || '',
                        // 将hls拉流url全部封装到 live 中，由后续用到时动态选择清晰度 注释不要删
                        streamUrlHlsMap: roomData.stream_url.hls_pull_url_map
                    };
                } catch (err) {
                    Logger.error('解析直播项时出错:', err);
                    return null;
                }
            }).filter(Boolean);

            Logger.log('成功获取直播列表，数量:', liveList.length, liveList[0]);
            return liveList;
        } catch (error) {
            Logger.error('获取直播列表失败:', error);
            throw new Error('获取直播列表失败，请稍后重试');
        }
    },

    /**
     * 渲染直播列表
     * @param {Array} list - 直播列表
     * @param {Element} container - 容器元素
     * @param {boolean} isDarkMode - 是否暗色模式
     */
    /** 分批渲染每批卡片数（大列表防一次性建几百个 DOM 卡死主线程） */
    RENDER_BATCH: 60,

    /**
     * 按当前「搜索 + 特别关心筛选 + 排序模式」从完整列表算出要展示的列表。
     * 过滤在 currentLiveList 数据数组上做（快、不漏匹配），渲染层再分批挂载。
     * 搜索/筛选/排序三处入口统一调用本方法，消除原先重复逻辑。
     */
    _getViewList() {
        let list = this.currentLiveList || [];
        const searchInput = document.querySelector('.live-modal-content input');
        const q = (searchInput?.value || '').toLowerCase().trim();
        if (q) list = list.filter(l => (l.anchor || '').toLowerCase().includes(q) || (l.title || '').toLowerCase().includes(q));
        if (this.isFiltering) list = list.filter(l => FavoriteManager.isFavorite(l.secUid));
        if (this.sortMode === 'popularity') list = [...list].sort((a, b) => (b.viewerCount || 0) - (a.viewerCount || 0));
        else if (this.sortMode === 'mostWatched') list = [...list].sort((a, b) => StatsManager.getWeekCount(b.secUid) - StatsManager.getWeekCount(a.secUid));
        return list;
    },

    /** 按当前视图状态重渲染列表（搜索/筛选/排序/导入后统一调用）。 */
    _rerenderView() {
        const container = document.querySelector('.live-grid');
        if (!container) return;
        const list = this._getViewList();
        const modal = DOMUtils.findElement('.live-modal-content');
        this.updateLiveCount(modal, list.length);
        this.renderLiveList(list, container, StyleUtils.isDarkMode());
    },

    renderLiveList(list, container, isDarkMode) {
        if (!container) {
            Logger.error('未找到直播列表容器');
            return;
        }

        // 重渲染前硬重置循环片段流水线：中止在录、释放旧循环视频解码、清空排队/可见集（保留缓存）。
        // 必须在 innerHTML 清空前——否则 video 已脱离 DOM 但仍在解码，造成解码泄漏。
        PreloadManager.resetForRerender();
        this._teardownBatchObserver();

        container.innerHTML = '';

        // 重建视口观察器（内部会先断开上一轮）。root 取 .live-grid 的滚动祖先（内容区 overflow:auto）
        const scrollRoot = container.parentElement || null;
        this._setupClipObserver(scrollRoot);
        this._setupPlaybackObserver(scrollRoot);

        // 分批渲染：先建首批，其余滚到底再追加（搜索结果少则一批建完；纯浏览大列表不冻结）
        this._pendingList = list || [];
        this._renderCursor = 0;
        this._renderContainer = container;
        this._renderDark = isDarkMode;
        this._setupBatchObserver(scrollRoot);
        this._renderNextBatch();
        // 不支持 IO 时无哨兵触发，直接补齐全部
        if (!this._batchObserver) {
            while (this._renderCursor < this._pendingList.length) this._renderNextBatch();
        }
    },

    /** 渲染下一批卡片，并维护末尾哨兵（渲染完则移除哨兵）。 */
    _renderNextBatch() {
        const container = this._renderContainer;
        if (!container) return;
        const list = this._pendingList || [];
        const start = this._renderCursor;
        const end = Math.min(start + this.RENDER_BATCH, list.length);
        this._appendCards(list.slice(start, end), start, container, this._renderDark);
        this._renderCursor = end;
        if (this._renderCursor >= list.length) this._removeSentinel();
        else this._ensureSentinelAtEnd(container);
    },

    /** 把一批 live 建成卡片并挂载（含对比复选框绑定 + 两个视口观察器 observe）。 */
    _appendCards(slice, indexOffset, container, isDarkMode) {
        slice.forEach((live, i) => {
            const card = LiveCard.create(live, isDarkMode, indexOffset + i);

            // 绑定对比复选框：初始化选中态 + 点击切换（监听绑在更大的命中区上，避免点偏误触大屏预览）
            const hit = card.querySelector('.compare-hit');
            const checkbox = card.querySelector('.compare-checkbox');
            if (hit && checkbox) {
                const checked = this._compareList.some(l => l.roomUrl === live.roomUrl);
                this._setCompareChecked(checkbox, checked);
                hit.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleCompare(live, checkbox);
                });
            }

            // 把 live 绑到预览容器上，供视口观察器回调取用
            const cardPreview = card.querySelector('.live-preview');
            if (cardPreview) {
                cardPreview._live = live;
                if (this._clipObserver) this._clipObserver.observe(cardPreview);
                if (this._playbackObserver) this._playbackObserver.observe(cardPreview);
            }

            container.appendChild(card);
        });
    },

    /** 创建/移动哨兵到列表末尾并交给批次观察器监听。 */
    _ensureSentinelAtEnd(container) {
        let s = this._sentinel;
        if (!s) {
            s = document.createElement('div');
            s.className = 'live-grid-sentinel';
            s.style.cssText = 'grid-column:1/-1;height:1px;';
            this._sentinel = s;
        }
        container.appendChild(s); // 重新追加 = 移到末尾
        if (this._batchObserver) this._batchObserver.observe(s);
    },

    /** 移除末尾哨兵（全部渲染完毕）。 */
    _removeSentinel() {
        if (this._batchObserver && this._sentinel) this._batchObserver.unobserve(this._sentinel);
        if (this._sentinel) { this._sentinel.remove(); this._sentinel = null; }
    },

    /** 批次观察器：哨兵进入（提前 600px）即渲染下一批。 */
    _setupBatchObserver(scrollRoot) {
        this._teardownBatchObserver();
        if (typeof IntersectionObserver === 'undefined') return;
        this._batchObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => { if (entry.isIntersecting) this._renderNextBatch(); });
        }, { root: scrollRoot || null, rootMargin: '600px 0px', threshold: 0 });
    },

    /** 断开批次观察器并移除哨兵（重渲染/关闭时）。 */
    _teardownBatchObserver() {
        if (this._batchObserver) { this._batchObserver.disconnect(); this._batchObserver = null; }
        if (this._sentinel) { this._sentinel.remove(); this._sentinel = null; }
    },

    /**
     * 视口驱动的循环片段加载：进入视口即 ensureClip（抖音式全视口预加载），
     * 离开较远则释放正在播放的循环视频（保留缓存 blob，再回来不重新下载）。
     * @private
     */
    _setupClipObserver(scrollRoot) {
        this._teardownClipObserver();
        if (typeof IntersectionObserver === 'undefined') return;
        this._clipObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const cardPreview = entry.target;
                const live = cardPreview._live;
                if (!live) return;
                if (entry.isIntersecting) {
                    // D：命中缓存即时挂；未缓存则停留 CLIP_SETTLE_MS 仍在视口才开始录制，避免快速滚动一闪而过也拉流
                    if (PreloadManager.preloadCache.has(live.roomUrl)) {
                        PreloadManager.ensureClip(live, cardPreview);
                    } else {
                        clearTimeout(cardPreview._clipEnterTimer);
                        cardPreview._clipEnterTimer = setTimeout(() => {
                            PreloadManager.ensureClip(live, cardPreview);
                        }, this._clipSettleMs());
                    }
                } else {
                    clearTimeout(cardPreview._clipEnterTimer);
                    PreloadManager.release(live.roomUrl, cardPreview);
                }
            });
            // 严格只加载视口内：rootMargin 0（视口外不预取/不排队），threshold 0.01（任意像素进入即触发）
        }, { root: scrollRoot || null, rootMargin: '0px', threshold: 0.01 });
    },

    /**
     * 断开循环片段观察器（重渲染/关闭弹窗时调用）。
     * @private
     */
    _teardownClipObserver() {
        if (this._clipObserver) {
            this._clipObserver.disconnect();
            this._clipObserver = null;
        }
    },

    /**
     * 视口播放门控：露出约 1/3（PLAY_VISIBLE_RATIO=0.35）且在扩展视口内（PLAY_ROOT_MARGIN=300px）即播；
     * 离开扩展视口仍 pauseCard。与 `_clipObserver` 解耦——加载仍以 rootMargin `0px`、threshold `0.01`
     * 严格视口触发（进视口加载 / 离视口 release；`CLIP_SETTLE_MS` 防快速滑动误拉流），卸 video 仍由 clip 观察器负责。
     * @private
     */
    _setupPlaybackObserver(scrollRoot) {
        this._teardownPlaybackObserver();
        if (typeof IntersectionObserver === 'undefined') return;
        this._playbackObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const cardPreview = entry.target;
                // 露出约 1/3 即允许播放；上下 rootMargin 提供约一排缓冲
                const shouldPlay = shouldPlayCard(entry.isIntersecting, entry.intersectionRatio);
                // 在卡片上标记期望播放状态，preload.js 的 finalizeLoop/attachLoop 在挂上视频后会读它
                // 以处理「加载完成时正好不应播放」的竞态（IO 不会自动再触发一次回调）
                cardPreview._shouldPlay = shouldPlay;
                if (shouldPlay) PreloadManager.resumeCard(cardPreview);
                else PreloadManager.pauseCard(cardPreview);
            });
        }, { root: scrollRoot || null, rootMargin: PLAY_ROOT_MARGIN, threshold: PLAY_THRESHOLDS });
    },

    /**
     * 断开播放门控观察器。
     * @private
     */
    _teardownPlaybackObserver() {
        if (this._playbackObserver) {
            this._playbackObserver.disconnect();
            this._playbackObserver = null;
        }
    },

    /**
     * 按容器宽度计算列数并写入网格，夹在 [GRID_MIN_COLS, GRID_MAX_COLS]。
     * @private
     * @param {HTMLElement} grid - .live-grid 容器
     */
    _applyGridColumns(grid) {
        if (!grid) return;
        const w = grid.clientWidth;
        if (!w) return;
        let n = Math.floor((w + this.GRID_GAP) / (this.GRID_TARGET + this.GRID_GAP));
        n = Math.max(this.GRID_MIN_COLS, Math.min(this.GRID_MAX_COLS, n));
        grid.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    },

    /**
     * 绑定窗口 resize 重算列数（防抖），并立即算一次。
     * @private
     * @param {HTMLElement} grid - .live-grid 容器
     */
    _setupGridResize(grid) {
        this._teardownGridResize();
        this._applyGridColumns(grid);
        this._gridResizeHandler = DOMUtils.debounce(() => this._applyGridColumns(grid), 150);
        window.addEventListener('resize', this._gridResizeHandler);
    },

    /**
     * 解绑 resize 监听（关闭弹窗时调用）。
     * @private
     */
    _teardownGridResize() {
        if (this._gridResizeHandler) {
            window.removeEventListener('resize', this._gridResizeHandler);
            this._gridResizeHandler = null;
        }
    },

    /**
     * 设置搜索功能
     * @private
     */
    setupSearch(modal, liveList, container, isDarkMode) {
        const searchInput = modal.querySelector('.search-input');
        if (!searchInput) return;

        let lastSearchValue = '';
        let searchTimeout;

        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                const searchValue = searchInput.value.toLowerCase().trim();
                if (searchValue === lastSearchValue) return;
                lastSearchValue = searchValue;

                // 统一按当前「搜索 + 特别关心 + 排序」重渲染
                this._rerenderView();
            }, 300);
        });
    },

    /**
     * 显示错误信息
     * @param {Element} container - 容器元素
     * @param {boolean} isDarkMode - 是否暗色模式
     * @param {Error} [err] - 错误对象
     */
    showError(container, isDarkMode, err) {
        const errorMessages = {
            '请先登录抖音': {
                title: '请先登录',
                detail: '登录即可查看关注主播的直播'
            },
            'default': {
                title: '加载失败',
                detail: '获取直播列表失败，请稍后重试'
            }
        };

        const errorMessage = err?.message ? errorMessages[err.message] || errorMessages.default : errorMessages.default;

        container.innerHTML = `
            <div style="
                grid-column: 1 / -1;
                color: ${isDarkMode ? '#fff' : '#666'};
                text-align: center;
                padding: 60px 20px;
                font-size: 16px;
                line-height: 1.5;
            ">
                <div style="margin-bottom: 10px;">${errorMessage.title}</div>
                <div style="font-size: 14px; opacity: 0.7;">
                    ${errorMessage.detail}
                </div>
            </div>
        `;
    },

    /**
     * 创建排序按钮
     * @private
     */
    createSortButton(isDarkMode) {
        const button = DOMUtils.createElement('button', {
            className: 'sort-button',
            innerHTML: `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 4h10M5 8h6M7 12h2" stroke="${isDarkMode ? '#fff' : '#000'}" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span style="margin-left: 4px;">默认</span>
            `,
            styles: {
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'background-color 0.2s',
                justifyContent: 'center'
            }
        });

        // 三态循环：默认（接口顺序）→ 人气（在线人数降序）→ 最常看（本周观看次数降序）
        button.setAttribute('title', '切换排序：默认 / 人气 / 最常看');
        button.addEventListener('click', () => {
            if (!this.currentLiveList) return;
            const ORDER = ['default', 'popularity', 'mostWatched'];
            const LABEL = { default: '默认', popularity: '人气', mostWatched: '最常看' };
            this.sortMode = ORDER[(ORDER.indexOf(this.sortMode) + 1) % ORDER.length];
            button.querySelector('span').textContent = LABEL[this.sortMode];
            this._rerenderView();
        });

        return button;
    },

    /**
     * 创建刷新按钮
     * @private
     */
    createRefreshButtonElement(isDarkMode) {
        const refreshButton = DOMUtils.createElement('button', {
            className: 'refresh-button',
            innerHTML: `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M13.666 2.334A7.956 7.956 0 0 0 8 0C3.582 0 0 3.582 0 8s3.582 8 8 8c3.866 0 7.078-2.746 7.828-6.4" stroke="${isDarkMode ? '#fff' : '#000'}" stroke-width="2"/>
                    <path d="M16 0v4h-4" stroke="${isDarkMode ? '#fff' : '#000'}" stroke-width="2"/>
                </svg>
                <span style="margin-left: 4px;">刷新</span>
            `,
            styles: {
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'background-color 0.2s'
            }
        });

        // 添加刷新事件
        refreshButton.addEventListener('click', () => {
            refreshButton.disabled = true;
            
            // 调用 refresh 方法
            this.refresh();
            
            // 防止连续点击
            setTimeout(() => {
                refreshButton.disabled = false;
            }, 1000);
        });

        return refreshButton;
    },

    /**
     * 创建声音总开关按钮（刷新按钮右侧）
     * 控制悬浮预览和大屏预览的初始声音状态
     * @private
     */
    createGlobalSoundBtn(isDarkMode) {
        const isEnabled = SettingsManager.isSoundEnabled();

        const soundOnSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
        </svg>`;
        const soundOffSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <line x1="23" y1="9" x2="17" y2="15"/>
            <line x1="17" y1="9" x2="23" y2="15"/>
        </svg>`;

        const updateIcon = (btn, enabled) => {
            btn.innerHTML = `${enabled ? soundOnSvg : soundOffSvg}<span style="margin-left:4px">${enabled ? '放音' : '静音'}</span>`;
            btn.style.color = enabled ? (isDarkMode ? '#fff' : '#000') : '#ff2c55';
            this._justifyShortLabel(btn.querySelector('span')); // 重建 innerHTML 后保持「撑成 4 字宽」
        };

        const btn = DOMUtils.createElement('button', {
            className: 'global-sound-btn',
            styles: {
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'color 0.2s, border-color 0.2s',
                justifyContent: 'center'
            }
        });
        btn.setAttribute('title', '观看直播时是否播放声音');
        updateIcon(btn, isEnabled);
        // 暴露给大屏预览反向同步图标
        btn._updateIcon = (enabled) => updateIcon(btn, enabled);

        btn.addEventListener('click', () => {
            const next = !SettingsManager.isSoundEnabled();
            SettingsManager.setSoundEnabled(next);
            updateIcon(btn, next);
            // 同步当前悬浮预览视频（若正在播放）
            if (PreviewManager.videoElement) {
                PreviewManager.videoElement.muted = !next;
            }
        });

        return btn;
    },

    /**
     * 创建对比预览按钮（声音总开关右侧）
     * 勾选 2-3 个直播间后点击，同屏对比多路不同直播
     * @private
     */
    createCompareButton(isDarkMode) {
        const btn = DOMUtils.createElement('button', {
            className: 'compare-preview-button',
            innerHTML: `<span>0 同时看</span>`,
            styles: {
                display: 'flex',
                alignItems: 'center',
                padding: '6px 14px',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'not-allowed',
                fontSize: '14px',
                opacity: '0.5',
                transition: 'opacity 0.2s, color 0.2s',
                justifyContent: 'center',
                whiteSpace: 'nowrap'
            }
        });
        btn.setAttribute('title', '勾选 2-3 个直播间后点击，同屏对比');
        this._compareButton = btn;
        this._isDarkMode = isDarkMode;

        btn.addEventListener('click', () => {
            if (this._compareList.length < 2) return;
            if (!LicenseManager.isPro) {
                LicenseManager.showUpgradePrompt('多路对比预览');
                return;
            }
            PreviewManager.openComparePreview([...this._compareList]);
        });

        return btn;
    },

    /**
     * 切换某直播间的对比选中状态
     * @param {Object} live - 直播信息
     * @param {HTMLElement} checkboxEl - 复选框元素
     */
    toggleCompare(live, checkboxEl) {
        const idx = this._compareList.findIndex(l => l.roomUrl === live.roomUrl);
        if (idx > -1) {
            this._compareList.splice(idx, 1);
            this._setCompareChecked(checkboxEl, false);
        } else {
            if (this._compareList.length >= this.COMPARE_MAX) {
                ToastManager.show(`最多只能对比 ${this.COMPARE_MAX} 个直播间`, 'error');
                return;
            }
            this._compareList.push(live);
            this._setCompareChecked(checkboxEl, true);
        }
        this.updateCompareButton();
    },

    /**
     * 设置复选框选中态外观
     * @private
     */
    _setCompareChecked(checkboxEl, checked) {
        if (!checkboxEl) return;
        if (checked) {
            checkboxEl.style.background = '#ff2c55';
            checkboxEl.style.borderColor = '#ff2c55';
            checkboxEl.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        } else {
            checkboxEl.style.background = 'rgba(0,0,0,0.4)';
            checkboxEl.style.borderColor = '#fff';
            checkboxEl.innerHTML = '';
        }
    },

    /**
     * 更新对比预览按钮的计数与可用状态
     */
    updateCompareButton() {
        const btn = this._compareButton;
        if (!btn) return;
        const n = this._compareList.length;
        const span = btn.querySelector('span');
        if (span) span.textContent = `${n} 同时看`;
        const enabled = n >= 2;
        btn.style.opacity = enabled ? '1' : '0.5';
        btn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        btn.style.color = enabled ? '#ff2c55' : (this._isDarkMode ? '#fff' : '#000');
    },

    /**
     * 一键清除对比预览的所有选中
     */
    clearCompare() {
        this._compareList = [];
        // 取消当前列表里所有复选框的勾选态
        document.querySelectorAll('.live-grid .compare-checkbox')
            .forEach(cb => this._setCompareChecked(cb, false));
        this.updateCompareButton();
    },

    /**
     * 创建"清除已选"按钮（对比预览按钮右侧）
     * @private
     */
    createClearCompareButton(isDarkMode) {
        const btn = DOMUtils.createElement('button', {
            className: 'clear-compare-button',
            innerHTML: `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
                <span style="margin-left:4px;">清除已选</span>
            `,
            styles: {
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'background-color 0.2s',
                justifyContent: 'center'
            }
        });
        btn.setAttribute('title', '清除所有已勾选的对比直播间');
        btn.addEventListener('click', () => this.clearCompare());
        return btn;
    },

    /**
     * 创建回到顶部按钮
     * @private
     */
    createScrollTopButton(isDarkMode) {
        const scrollTopButton = DOMUtils.createElement('button', {
            innerHTML: `
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M8 3v10M4 7l4-4 4 4" stroke="${isDarkMode ? '#fff' : '#000'}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span style="margin-left: 4px;">顶部</span>
            `,
            styles: {
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'background-color 0.2s'
            }
        });

        // 添加回到顶部事件
        scrollTopButton.addEventListener('click', () => {
            const contentArea = DOMUtils.findElement('.live-modal-content');
            const gridContainer = contentArea.querySelector('div[style*="overflow: auto"]');
            if (gridContainer) {
                gridContainer.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            }
        });

        return scrollTopButton;
    },

    /**
     * 创建「资源/设置」按钮：打开统一面板（资源监控 / 插件设置 / 数据备份）。
     * @private
     */
    createResourceButton(isDarkMode) {
        const stroke = isDarkMode ? '#fff' : '#000';
        // 设置齿轮图标（替代原「+」）
        const resourceButton = DOMUtils.createElement('button', {
            innerHTML: `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="3" stroke="${stroke}" stroke-width="2"/>
                    <path d="M12 1v2.5M12 20.5V23M4.22 4.22l1.77 1.77M18.01 18.01l1.77 1.77M1 12h2.5M20.5 12H23M4.22 19.78l1.77-1.77M18.01 5.99l1.77-1.77"
                          stroke="${stroke}" stroke-width="2" stroke-linecap="round"/>
                </svg>
                <span style="margin-left: 4px;">资源/设置</span>
            `,
            styles: {
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'background-color 0.2s'
            }
        });
        resourceButton.setAttribute('title', '资源监控 / 插件设置 / 数据备份');

        // 打开统一面板（任何报错都弹出来，避免「点了没反应」难排查）
        resourceButton.addEventListener('click', () => {
            try {
                this.resourceMonitor = ResourceMonitor;
                this.resourceMonitor.showPanel();
            } catch (e) {
                Logger.error('打开资源/设置失败:', e);
                ToastManager.show('资源/设置打开失败：' + (e && e.message), 'error');
            }
        });

        return resourceButton;
    },

    /**
     * 创建「赞赏/交流」按钮：打开左右双码弹窗（赞赏码 + 群码均 CDN）。
     * @private
     */
    createSupportButton(isDarkMode) {
        const stroke = isDarkMode ? '#fff' : '#000';
        // 交流气泡图标（替代爱心）
        const btn = DOMUtils.createElement('button', {
            className: 'dylh-support-btn',
            innerHTML: `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
                          stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                <span style="margin-left: 4px;">赞赏/交流</span>
            `,
            styles: {
                display: 'flex',
                alignItems: 'center',
                padding: '6px 12px',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: '14px',
                transition: 'background-color 0.2s'
            }
        });
        btn.setAttribute('title', '赞赏支持 / 微信交流群');
        btn.addEventListener('click', () => {
            try {
                SupportManager.showPanel();
            } catch (e) {
                Logger.error('打开赞赏/交流失败:', e);
                ToastManager.show('打开失败：' + (e && e.message), 'error');
            }
        });
        return btn;
    },

    /**
     * 创建直播数量显示元素
     * @private
     */
    createLiveCountElement(isDarkMode) {
        // 与菜单按钮同款外观，但纯展示：无 hover 背景、无点击。初始显示「加载中…」，统计出来再替换
        return DOMUtils.createElement('span', {
            className: 'live-count',
            innerHTML: '加载中…',
            styles: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: `1px solid ${isDarkMode ? '#3f3f3f' : '#ddd'}`,
                borderRadius: '4px',
                fontSize: '14px',
                color: isDarkMode ? '#aaa' : '#666',
                cursor: 'default',
                userSelect: 'none'
            }
        });
    },

    /**
     * 更新直播人数
     * @param {Element} modal - 模态框元素
     * @param {number} count - 主播数量
     */ 
    updateLiveCount(modal, count) {
        const liveCount = modal.querySelector('.live-count');
        if (liveCount) {
            liveCount.textContent = `${count}个直播`;
        }
    },

    /**
     * 刷新列表
     */
    refresh() {
        const modal = document.querySelector('.live-modal-content');
        if (!modal) return;

        // 重置搜索框
        const searchInput = modal.querySelector('.search-input');
        if (searchInput) {
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input'));
        }

        // 重置排序按钮
        const sortBtn = modal.querySelector('.sort-button');
        if (sortBtn) {
            this.sortMode = 'default';
            sortBtn.querySelector('span').textContent = '默认';
        }

        // 重置特别关心按钮
        const favoriteBtn = modal.querySelector('.favorite-filter-button');
        if (favoriteBtn) {
            this.isFiltering = false;  // 重置特别关心状态
            favoriteBtn.style.background = 'transparent';
            favoriteBtn.style.color = StyleUtils.isDarkMode() ? '#fff' : '#666';
        }

        // 清除对比预览的选中（刷新列表后选中失效）
        this.clearCompare();

        // 重新加载数据
        this.loadContent(modal, StyleUtils.isDarkMode());
    }
};

export { ModalUI };