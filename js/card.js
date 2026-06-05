/**
 * 直播卡片模块
 */

import { Logger } from './logger.js';
import { DOMUtils } from './utils.js';
import { PreviewManager } from './preview.js';
import { FavoriteManager } from './favorite.js';

// 「已预览」角标开关：自动循环预览上线后该角标已冗余，默认隐藏（代码保留，置 true 可恢复）
const SHOW_PREVIEW_BADGE = false;

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
                width: '100%',
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

        // 背景图：优先用上次预览的截图作为片段加载前的封面占位
        const captured = live.capturedPreview || PreviewManager.previewCache.get(live.roomUrl);
        const bgImage = captured || live.cover;
        // 「已预览」角标默认隐藏（与自动循环预览冲突，代码保留由 SHOW_PREVIEW_BADGE 控制）
        const previewBadge = (SHOW_PREVIEW_BADGE && captured) ? `
                <div class="preview-badge" style="
                    position: absolute;
                    bottom: 60px;
                    left: 8px;
                    background: rgba(0, 0, 0, 0.8);
                    color: #fff;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                    z-index: 4;
                ">已预览</div>` : '';

        const isFav = FavoriteManager.isFavorite(live.secUid);

        // 全沉浸卡片：整张卡=视频区(3:4)，信息条压在视频底部、白字 + 淡渐变蒙版
        return `
            <div class="live-preview" style="
                position: relative;
                width: 100%;
                aspect-ratio: 3 / 4;
                background-image: url(${bgImage});
                background-size: cover;
                background-position: center;
                overflow: hidden;
                cursor: pointer;
            ">
                <div class="live-index" style="
                    position: absolute;
                    top: 8px;
                    left: 8px;
                    background: rgba(0, 0, 0, 0.55);
                    color: #fff;
                    padding: 2px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                    z-index: 4;
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
                    z-index: 5;
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

                <div class="card-info-bar" style="
                    position: absolute;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    z-index: 3;
                    padding: 28px 10px 10px 10px;
                    background: linear-gradient(transparent, rgba(0,0,0,0.3));
                    display: flex;
                    align-items: center;
                    gap: 0;
                    pointer-events: none;
                ">
                    <img src="${live.avatar}" class="user-avatar" title="点击跳转个人主页" style="
                        width: 32px;
                        height: 32px;
                        border-radius: 50%;
                        flex-shrink: 0;
                        margin-right: 4px;
                        cursor: pointer;
                        pointer-events: auto;
                    ">
                    <div class="text-info" style="flex: 1; min-width: 0;">
                        <div class="title-text" title="点击跳转直播间&#10;${live.title}" style="
                            color: #fff;
                            font-weight: bold;
                            font-size: 13px;
                            line-height: 1.25;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                            cursor: pointer;
                            pointer-events: auto;
                            text-shadow: 0 1px 2px rgba(0,0,0,0.6);
                        ">${live.title}</div>
                        <div class="bottom-info" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            gap: 6px;
                            margin-top: 5px;
                        ">
                            <span class="username" title="点击跳转直播间" style="
                                color: #fff;
                                font-size: 12px;
                                overflow: hidden;
                                text-overflow: ellipsis;
                                white-space: nowrap;
                                min-width: 0;
                                cursor: pointer;
                                pointer-events: auto;
                                text-shadow: 0 1px 2px rgba(0,0,0,0.6);
                            ">@${live.anchor}</span>
                            <span class="viewer-count" title="在线观众" style="
                                color: #fff;
                                font-size: 11px;
                                flex-shrink: 0;
                                display: inline-flex;
                                align-items: center;
                                gap: 3px;
                                text-shadow: 0 1px 2px rgba(0,0,0,0.6);
                            "><svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" style="filter:drop-shadow(0 1px 1px rgba(0,0,0,0.6))"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>${live.user_count_str}</span>
                        </div>
                    </div>
                    <div class="favorite-btn" style="
                        width: 26px;
                        height: 26px;
                        margin-left: 8px;
                        cursor: pointer;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        flex-shrink: 0;
                        pointer-events: auto;
                    " title="${isFav ? '点击取消特别关注主播' : '点击特别关心主播'}">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="${isFav ? '#ff2c55' : 'none'}" stroke="#fff" stroke-width="2">
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                        </svg>
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

        // 悬浮：暂停循环片段、切这一路真·实时流（在 setupPreview 内处理 pause/resume）
        PreviewManager.setupPreview(cardPreview, live);
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

        // 标题、昵称点击都跳转直播间
        const openRoom = (e) => {
            e.stopPropagation();
            window.open(live.roomUrl, '_blank');
        };
        const title = card.querySelector('.title-text');
        if (title) {
            title.onclick = openRoom;
            title.style.cursor = 'pointer';
        }
        const username = card.querySelector('.username');
        if (username) {
            username.onclick = openRoom;
        }

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