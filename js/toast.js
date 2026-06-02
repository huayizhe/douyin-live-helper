/**
 * Toast 通知模块
 * 用于显示临时的提示信息
 */

import { StyleUtils } from './utils.js';
import { TOAST } from './constants.js';

export const ToastManager = {
    /**
     * 显示 Toast 通知
     * 
     * @description
     * 在页面顶部居中显示一个临时的提示信息，默认2秒后自动消失。
     * 支持信息、成功、警告和错误四种类型。
     * 
     * @param {string} message - 要显示的提示信息
     * @param {('info'|'success'|'warning'|'error')} type - 提示类型，默认为 'info'
     * @param {number} [duration] - 显示时长（毫秒），默认为 TOAST.DURATION.DEFAULT
     * 
     * @example
     * // 显示普通提示
     * ToastManager.show('操作成功');
     * 
     * // 显示成功提示
     * ToastManager.show('保存成功', TOAST.TYPE.SUCCESS);
     * 
     * // 显示警告提示
     * ToastManager.show('网络不稳定', TOAST.TYPE.WARNING);
     * 
     * // 显示错误提示
     * ToastManager.show('操作失败', TOAST.TYPE.ERROR);
     * 
     * // 自定义显示时长
     * ToastManager.show('操作完成', TOAST.TYPE.SUCCESS, TOAST.DURATION.LONG);
     */
    show(message, type = TOAST.TYPE.INFO, duration = TOAST.DURATION.DEFAULT) {
        // 验证类型是否有效
        if (!Object.values(TOAST.TYPE).includes(type)) {
            type = TOAST.TYPE.INFO;
        }

        // 创建 toast 元素
        const toast = document.createElement('div');
        
        // 根据暗色模式和提示类型设置样式
        const isDarkMode = StyleUtils.isDarkMode();
        const bgColor = TOAST.STYLE.BACKGROUND[type.toUpperCase()][isDarkMode ? 'DARK' : 'LIGHT'];
        const textColor = type === TOAST.TYPE.INFO && isDarkMode ? 
            TOAST.STYLE.TEXT.DARK : 
            TOAST.STYLE.TEXT.LIGHT;
        
        // 设置 toast 样式
        Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 16px',
            background: bgColor,
            color: textColor,
            borderRadius: '4px',
            fontSize: '14px',
            zIndex: TOAST.STYLE.Z_INDEX,
            transition: `opacity ${TOAST.ANIMATION.FADE_DURATION}ms`,
            opacity: 0,
            pointerEvents: 'none'  // 防止 toast 影响用户交互
        });

        // 设置提示文本
        toast.textContent = message;
        
        // 将 toast 添加到页面
        document.body.appendChild(toast);

        // 使用 requestAnimationFrame 确保淡入动画正常执行
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
        });

        // 指定时间后开始淡出动画
        setTimeout(() => {
            toast.style.opacity = '0';
            // 等待淡出动画完成后移除元素
            setTimeout(() => toast.remove(), TOAST.ANIMATION.FADE_DURATION);
        }, duration);
    },

    /**
     * 显示成功提示
     * @param {string} message - 提示消息
     * @param {number} [duration] - 显示时长
     */
    success(message, duration = TOAST.DURATION.DEFAULT) {
        this.show(message, TOAST.TYPE.SUCCESS, duration);
    },

    /**
     * 显示错误提示
     * @param {string} message - 提示消息
     * @param {number} [duration] - 显示时长
     */
    error(message, duration = TOAST.DURATION.DEFAULT) {
        this.show(message, TOAST.TYPE.ERROR, duration);
    },

    /**
     * 显示警告提示
     * @param {string} message - 提示消息
     * @param {number} [duration] - 显示时长
     */
    warning(message, duration = TOAST.DURATION.DEFAULT) {
        this.show(message, TOAST.TYPE.WARNING, duration);
    },

    /**
     * 显示信息提示
     * @param {string} message - 提示消息
     * @param {number} [duration] - 显示时长
     */
    info(message, duration = TOAST.DURATION.DEFAULT) {
        this.show(message, TOAST.TYPE.INFO, duration);
    }
}; 