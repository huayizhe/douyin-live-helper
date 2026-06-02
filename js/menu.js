/**
 * 菜单处理模块
 */

import { Logger } from './logger.js';
import { DOMUtils, StyleUtils } from './utils.js';
import { ModalUI } from './modal.js';
import { ToastManager } from './toast.js';
import { MENU_SELECTORS } from './constants.js';

const MenuHandler = {
    // 持久化相关状态
    _checkTimer: null,      // 定时巡检计时器
    _failCount: 0,          // 连续插入失败次数（成功会清零）
    _initialized: false,    // 是否已成功插入过（用于只提示一次）

    /**
     * 启动菜单注入与持久化（定时巡检模式）
     *
     * @description
     * 抖音网页版是 React 应用。脚本在 document_idle 注入时，React 往往仍在
     * hydration（注水）。若此时改动 DOM，会触发 React #425/#422 而整体重渲染，
     * 把注入的节点连同其导航容器一起替换掉，导致菜单"显示一次后又消失"。
     *
     * 策略：简单定时巡检——每隔 CHECK_INTERVAL 检查一次菜单是否还在，不在就补回。
     * 这天然能从 #422 整体重渲染中自愈：容器被换掉后，下一次巡检会在新容器里
     * 重新找到 .tab-friend 并插回菜单。连续失败 MAX_RETRY 次才判定失败并停止。
     */
    start() {
        Logger.log('开始注入关注直播菜单（定时巡检模式）');
        this._failCount = 0;
        // 立即尝试一次，随后定时巡检
        this.tick();
        this._checkTimer = setInterval(() => this.tick(), MENU_SELECTORS.CHECK_INTERVAL);
    },

    /**
     * 巡检单元（幂等）：菜单不在就补回，连续失败累计到上限则停止。
     * @private
     */
    tick() {
        if (this.isLiveMenuExists()) {
            this._failCount = 0;   // 菜单在 → 清零连续失败计数
            return;
        }
        // 菜单不在 → 尝试插入
        if (this.insertMenu()) {
            this._failCount = 0;   // 插入成功 → 清零
            return;
        }
        // 本次插入失败（导航没渲染/找不到锚点）→ 累计连续失败
        this._failCount++;
        Logger.log(`菜单插入失败，第 ${this._failCount}/${MENU_SELECTORS.MAX_RETRY} 次`);
        if (this._failCount >= MENU_SELECTORS.MAX_RETRY) {
            clearInterval(this._checkTimer);
            this._checkTimer = null;
            Logger.error('多次尝试后仍无法插入关注直播菜单，停止巡检');
            ToastManager.error('抖音关注直播助手加载失败，请刷新页面重试');
        }
    },

    /**
     * 插入菜单（纯插入逻辑，由 scheduleInsert 在渲染稳定后调用）
     * @returns {boolean} 是否插入成功
     */
    insertMenu() {
        const tabParentMenuItem = this.findFriendOrFollowTabParentMenu();
        if (!tabParentMenuItem) {
            Logger.log('插件菜单加载失败，未找到朋友或关注按钮的父级菜单项');
            return false;
        }

        if (this.isLiveMenuExists()) {
            return false;
        }

        const newMenu = this.createLiveMenu(tabParentMenuItem);
        this.insertMenuBetweenItems(newMenu, tabParentMenuItem);

        if (!this._initialized) {
            this._initialized = true;
            ToastManager.success('抖音关注直播助手加载成功！');
        }
        Logger.log('关注直播菜单插入成功');
        return true;
    },

    /**
     * 查找朋友或关注按钮的父级菜单项
     * 
     * @description
     * 首先尝试查找"朋友"或"关注"按钮，然后查找其父级菜单项。
     * 找到任意一个即可，不需要找到两个。为了防止网页改版，容错处理。
     * 
     * @private
     * @returns {HTMLElement|null} 返回包含菜单项信息的 DOM 对象或 null
     * 
     * @example
     * const tabParentMenuItem = MenuHandler.findFriendOrFollowTabParentMenu();
     * if (tabParentMenuItem) {
     *     // 处理找到的菜单项
     * }
     * 
     * @throws {Error} 当 DOM 操作失败时可能会抛出错误
     * 
     * @see {@link MENU_SELECTORS} 相关的选择器配置
     */
    findFriendOrFollowTabParentMenu() {
        // 第一步：查找朋友或关注按钮（tab-friend / tab-follow 类名由抖音硬编码，稳定）
        const friendOrFollowTab = DOMUtils.findElement(MENU_SELECTORS.TABS.FRIEND) ||
                                  DOMUtils.findElement(MENU_SELECTORS.TABS.FOLLOW);

        if (!friendOrFollowTab) {
            Logger.log('插件菜单加载失败，未找到朋友或关注按钮');
            return null;
        }

        // 第二步：向上遍历固定层数，到达 item 外层容器（不依赖 class 名）
        // 结构：tab-friend div → 匿名 div → item 外层容器 div
        let parent = friendOrFollowTab;
        for (let i = 0; i < MENU_SELECTORS.TAB_PARENT_LEVELS; i++) {
            parent = parent.parentElement;
            if (!parent) {
                Logger.log('插件菜单加载失败，DOM 层级不符合预期');
                return null;
            }
        }
        return parent;
    },

    /**
     * 检查直播菜单是否存在
     * @private
     */
    isLiveMenuExists() {
        return Boolean(DOMUtils.findElement('.tab-follow-live'));
    },

    /**
     * 创建关注直播菜单
     * 克隆现有导航项并修改文字，避免硬编码抖音的动态 class 名
     * @private
     * @param {HTMLElement} templateItem - 作为模板的导航项（tab-friend 或 tab-follow 的外层容器）
     */
    createLiveMenu(templateItem) {
        const clone = templateItem.cloneNode(true);

        // 把"朋友"或"关注"文字改为"关注直播"，并记住文字所在的容器
        // 抖音导航项 <a> 下固定三段：① 图标容器 ② 文字容器 ③ 角标容器（class 是会变的哈希，不可依赖）
        let labelBox = null;
        for (const span of clone.querySelectorAll('span')) {
            const t = span.textContent.trim();
            if (t === '朋友' || t === '关注') {
                span.textContent = '关注直播';
                labelBox = span.closest('div');  // 文字容器
                break;
            }
        }

        // 给内层 tab-* div 加上标识 class，供 isLiveMenuExists() 检测
        const tabDiv = clone.querySelector('[class*="tab-"]');
        if (tabDiv) tabDiv.classList.add('tab-follow-live');

        if (labelBox) {
            // 图标 = 文字容器的前一个兄弟（抖音用 CSS 雪碧图，不是 svg）。整体换成自定义 SVG。
            const iconBox = labelBox.previousElementSibling;
            if (iconBox) {
                iconBox.innerHTML = `
                    <svg class="follow-live-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" style="display:block"
                         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" stroke="none"/>
                        <path d="M7.5 8.5a5 5 0 000 7M16.5 8.5a5 5 0 010 7"/>
                        <path d="M5 6a8.5 8.5 0 000 12M19 6a8.5 8.5 0 010 12"/>
                    </svg>
                `;
            } else {
                Logger.log('未找到图标容器（文字容器的前一个兄弟），跳过图标替换');
            }

            // 角标 = 文字容器的后一个兄弟。直接清空，连红色气泡一起去掉。
            const badgeBox = labelBox.nextElementSibling;
            if (badgeBox) badgeBox.innerHTML = '';
        } else {
            Logger.log('未找到"朋友/关注"文字容器，跳过图标与角标处理');
        }

        // 修改链接为锚点，防止点击后跳转页面
        const link = clone.querySelector('a');
        if (link) link.href = 'javascript:void(0)';

        return clone;
    },

    /**
     * 在两个菜单项之间插入新菜单
     * @private
     */
    insertMenuBetweenItems(newMenu, afterItem) {
        Logger.log('在朋友菜单前插入关注直播菜单:', {
            newMenu,
            afterItem
        });
        afterItem.parentNode.insertBefore(newMenu, afterItem);
        this.followLiveClickHandler(newMenu);
    },

    /**
     * 检查用户是否登录
     * @returns {boolean} 是否已登录
     */
    checkLogin() {
        // 在页面文本中查找登录状态标识
        const pageText = document.body.textContent || '';
        const hasLogoutText = pageText.includes('退出登录');
        const hasNotLoginText = pageText.includes('未登录');

        Logger.log('检查登录状态:', {
            hasLogoutText,
            hasNotLoginText,
            pageText: pageText.substring(0, 100) // 只记录前100个字符用于调试
        });

        // 找到"退出登录"且没有"未登录"文字，则视为已登录
        return hasLogoutText && !hasNotLoginText;
    },

    /**
     * 关注直播菜单点击处理
     * @private
     */
    followLiveClickHandler(menuElement) {
        const menuLink = menuElement.querySelector('a');
        menuLink?.addEventListener('click', (e) => {
            e.preventDefault();
            Logger.log('关注直播菜单被点击');

            // 检查登录状态
            const isLogin = this.checkLogin();
            Logger.log('登录状态:', { isLogin });

            if (!isLogin) {
                // 创建登录提示模态框
                const isDarkMode = StyleUtils.isDarkMode();
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

                const content = DOMUtils.createElement('div', {
                    styles: {
                        background: isDarkMode ? '#161823' : 'white',
                        borderRadius: '8px',
                        padding: '24px',
                        textAlign: 'center',
                        color: isDarkMode ? '#fff' : '#000'
                    },
                    innerHTML: `
                        <h3 style="margin: 0 0 16px 0; font-size: 18px;">请先登录</h3>
                        <p style="margin: 0 0 20px 0; font-size: 14px; color: ${isDarkMode ? '#aaa' : '#666'}">
                            登录即可查看关注主播的直播
                        </p>
                        <button style="
                            background: #fe2c55;
                            color: #fff;
                            border: none;
                            padding: 8px 24px;
                            border-radius: 4px;
                            font-size: 14px;
                            cursor: pointer;
                            transition: opacity 0.2s;
                        ">我知道了</button>
                    `
                });

                modal.appendChild(content);
                document.body.appendChild(modal);

                // 点击空白处关闭
                modal.onclick = (e) => {
                    if (e.target === modal) {
                        modal.remove();
                    }
                };

                // 点击登录按钮
                const closeBtn = content.querySelector('button');
                closeBtn.onclick = () => {
                    modal.remove();
                };

                return;
            } else {
                // 已登录则显示面板
                ModalUI.show();
            }
        });
    }
};

export { MenuHandler }; 