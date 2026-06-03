'use strict';
/**
 * 套餐与运行配置。金额单位：分（与支付渠道一致）。
 * 必须与插件 js/constants.js 的 LICENSE.PRICING 对齐（amount/days）。
 */
module.exports = {
    PLANS: {
        month:    { label: '月付',     amount: 1290,  days: 30 },
        year:     { label: '年付',     amount: 9800,  days: 365 },
        lifetime: { label: '永久买断', amount: 25800, days: 36500 },
    },

    // 当前支付渠道：mock | alipay | wechat
    CHANNEL: process.env.PAY_CHANNEL || 'mock',

    PORT: parseInt(process.env.PORT || '3000', 10),

    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || 'http://localhost:3000',
};
