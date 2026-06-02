/**
 * 日志和消息提示模块
 */

import { LOG } from './constants.js';

/**
 * 日志工具类
 */
const Logger = {
    /**
     * 输出日志
     * @param {string} message - 日志消息
     * @param {...any} args - 额外参数
     */
    log(message, ...args) {
        if (!LOG.DEBUG) return;
        console.log(`${LOG.PREFIX} ${message}`, ...args);
    },

    /**
     * 输出调试日志
     * @param {string} message - 调试消息
     * @param {...any} args - 额外参数
     */
    debug(message, ...args) {
        if (!LOG.DEBUG) return;
        console.log(`${LOG.PREFIX} ${message}`, ...args);
    },

    /**
     * 输出警告日志
     * @param {string} message - 警告消息
     * @param {...any} args - 额外参数
     */
    warn(message, ...args) {
        if (!LOG.DEBUG) return;
        console.warn(`${LOG.PREFIX} ${message}`, ...args);
    },

    /**
     * 输出错误日志
     * @param {string} message - 错误消息
     * @param {...any} args - 额外参数
     */
    error(message, ...args) {
        if (!LOG.DEBUG) return;
        console.error(`${LOG.PREFIX} ${message}`, ...args);
    }
};

export { Logger }; 