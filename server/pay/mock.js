'use strict';
/**
 * 开发自测渠道：不接真实支付。
 * - createOrder 返回占位 codeUrl（前端照样能转二维码看效果）
 * - queryOrder 查内存中的已支付标记
 * - 通过 index.js 暴露的 POST /api/mock/pay 手动标记某订单已支付，模拟"用户扫码付款"
 */
const _paid = new Set();

module.exports = {
    async createOrder({ orderId, amount }) {
        return { codeUrl: `https://example.com/mock-pay?order=${orderId}&fen=${amount}` };
    },
    async queryOrder({ orderId }) {
        return _paid.has(orderId) ? 'paid' : 'pending';
    },
    async verifyNotify() {
        return { ok: false }; // mock 不走异步回调
    },

    // 供 index.js 在 mock 模式下手动触发
    _markPaid(orderId) { _paid.add(orderId); },
};
