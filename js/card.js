/**
 * 直播卡片模块
 */

import { Logger } from './logger.js';
import { DOMUtils } from './utils.js';
import { PreviewManager } from './preview.js';
import { PreloadManager } from './preload.js';
import { FavoriteManager } from './favorite.js';

const LiveCard = {
    /**
     * 创建直播卡片
     * @param {Object} live - 直播信息
     * @param {boolean} isDarkMode - 是否暗色模式
     * @param {number} index - 卡片序号
     * @returns {Element} 卡片元素
     */
    create(live, isDarkMode, index) {
        const card = DOMUtils.createElement('div', {
            className: 'live-card',
            styles: {
                width: '300px',
                margin: '0 auto',
                borderRadius: '8px',
                overflow: 'hidden',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                background: isDarkMode ? '#252632' : 'white',
                cursor: 'pointer',
                transition: 'transform 0.2s',
                position: 'relative'
            }
        });

        // 确保 index 是数字类型且不小于 0
        const cardIndex = typeof index === 'number' && index >= 0 ? index : 0;
        card.innerHTML = this.createCardContent(live, isDarkMode, cardIndex);
        
        this.setupPreviewAndPreview(card, live);
        this.setupClickHandler(card, live);
        this.setupFavoriteButton(card, live, isDarkMode);

        return card;
    },

    /**
     * 创建卡片内容
     * @private
     */
    createCardContent(live, isDarkMode, index) {
        // 确保序号从 1 开始显示
        const displayIndex = (index || 0) + 1;

        // 背景图：优先用上次预览的截图（命中则在左下角加"已预览"标志）
        const captured = live.capturedPreview || PreviewManager.previewCache.get(live.roomUrl);
        const bgImage = captured || live.cover;
        const previewBadge = captured ? `
                <div class="preview-badge" style="
                    position: absolute;
                    bottom: 8px;
                    left: 8px;
                    background: rgba(0, 0, 0, 0.8);
                    color: #fff;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                    z-index: 1;
                ">已预览</div>` : '';

        return `
            <div class="live-preview" style="
                height: 200px;
                background-image: url(${bgImage});
                background-size: cover;
                position: relative;
                cursor: pointer;
            ">
                <div class="live-index" style="
                    position: absolute;
                    top: 8px;
                    left: 8px;
                    background: rgba(0, 0, 0, 0.7);
                    color: #fff;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                    z-index: 1;
                ">${displayIndex}</div>
                ${previewBadge}
                <div class="compare-hit" title="勾选加入对比预览" style="
                    position: absolute;
                    top: 0;
                    right: 0;
                    width: 48px;
                    height: 44px;
                    padding: 8px;
                    box-sizing: border-box;
                    z-index: 2;
                    cursor: pointer;
                    display: flex;
                    align-items: flex-start;
                    justify-content: flex-end;
                ">
                    <div class="compare-checkbox" style="
                        width: 22px;
                        height: 22px;
                        border-radius: 50%;
                        border: 2px solid #fff;
                        background: rgba(0, 0, 0, 0.4);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        box-sizing: border-box;
                    "></div>
                </div>
            </div>
            <div class="live-info" style="padding: 8px 8px 0 8px;">
                <div class="user-info" style="
                    display: flex;
                    align-items: flex-start;
                    width: 100%;
                ">
                    <img src="${live.avatar}" class="user-avatar" title="点击跳转个人主页" style="
                        width: 36px;
                        height: 36px;
                        border-radius: 50%;
                        margin-right: 8px;
                        cursor: pointer;
                        flex-shrink: 0;
                    ">
                    <div class="text-info" style="
                        flex: 6;
                        min-width: 0;
                        width: 0;
                    ">
                        <div style="
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            margin-bottom: 4px;
                        ">
                            <div style="
                                font-weight: bold;
                                color: ${isDarkMode ? '#fff' : '#000'};
                                font-size: 14px;
                                line-height: 1.2;
                                overflow: hidden;
                                text-overflow: ellipsis;
                                white-space: nowrap;
                                cursor: default;
                                flex: 1;
                                min-width: 0;
                            " title="点击跳转直播间&#10;${live.title}">${live.title}</div>
                            <div class="favorite-btn" style="
                                width: 24px;
                                height: 24px;
                                margin-left: 8px;
                                cursor: pointer;
                                display: flex;
                                justify-content: center;
                                align-items: center;
                                flex-shrink: 0;
                            " title="${FavoriteManager.isFavorite(live.secUid) ? '点击取消特别关注主播' : '点击特别关心主播'}">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="${FavoriteManager.isFavorite(live.secUid) ? '#ff2c55' : 'none'}" stroke="${isDarkMode ? '#fff' : '#666'}" stroke-width="2">
                                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                </svg>
                            </div>
                        </div>
                        <div class="bottom-info" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            cursor: default;
                        ">
                            <span class="username" style="
                                color: #fff;
                                font-size: 12px;
                            ">${live.anchor}</span>
                            <span class="viewer-count" style="
                                color: #999;
                                font-size: 12px;
                            ">${live.user_count_str}在线观众</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * 设置预览效果
     * @private
     *
     * 新模型（抖音式）：卡片进入视口后由 ClipManager 录制循环片段并叠加播放（会动的缩略图），
     * 加载逻辑统一在 modal.js 的视口观察器里。这里只负责：封面占位 + 悬浮取消静音。
     */
    setupPreviewAndPreview(card, live) {
        const cardPreview = card.querySelector('.live-preview');
        if (!cardPreview) {
            Logger.warn('未找到预览容器元素');
            return;
        }

        // 设置初始背景封面占位（片段就绪前不黑屏；优先上次截图，其次封面）
        cardPreview.style.backgroundImage = `url(${live.capturedPreview || PreviewManager.previewCache.get(live.roomUrl) || live.cover})`;
        cardPreview.style.backgroundSize = 'cover';
        cardPreview.style.backgroundPosition = 'center';
        cardPreview.style.position = 'relative';

        // 悬浮给该路循环片段取消静音（沿用全局声音设置），移出恢复静音
        cardPreview.addEventListener('mouseenter', () => PreloadManager.unmuteCard(cardPreview));
        cardPreview.addEventListener('mouseleave', () => PreloadManager.muteCard(cardPreview));
    },

    /**
     * 设置点击处理
     * @private
     */
    setupClickHandler(card, live) {
        // 预览区域点击打开全屏预览
        const cardPreview = card.querySelector('.live-preview');
        cardPreview.onclick = (e) => {
            // 点击落在对比复选框区域时不打开大屏预览（兜底守卫）
            if (e.target.closest('.compare-hit')) return;
            e.stopPropagation();
            PreviewManager.openFullPreview(cardPreview, live);
        };

        // 标题点击跳转直播间
        const title = card.querySelector('.text-info > div > div[title]');
        title.onclick = (e) => {
            e.stopPropagation();
            window.open(live.roomUrl, '_blank');
        };
        title.style.cursor = 'pointer';

        // 头像点击跳转主页
        const avatar = card.querySelector('.user-avatar');
        avatar.onclick = (e) => {
            e.stopPropagation();
            if (live.secUid) {
                window.open(`https://www.douyin.com/user/${live.secUid}`, '_blank');
            }
        };

        // 移除卡片整体的点击事件
        card.onclick = null;
    },

    /**
     * 设置特别关心按钮
     * @private
     */
    setupFavoriteButton(card, live, isDarkMode) {
        const favoriteBtn = card.querySelector('.favorite-btn');
        if (!favoriteBtn) {
            Logger.warn('未找到特别关心按钮');
            return;
        }

        // 阻止冒泡，避免触发卡片点击事件
        favoriteBtn.onclick = (e) => {
            e.stopPropagation();
            const isFavorite = FavoriteManager.toggleFavorite(live.secUid);
            
            // 更新图标颜色
            const svg = favoriteBtn.querySelector('svg');
            if (svg) {
                svg.setAttribute('fill', isFavorite ? '#ff2c55' : 'none');
                svg.setAttribute('stroke', isDarkMode ? '#fff' : '#666');
            }
        };
    }
};

export { LiveCard }; 