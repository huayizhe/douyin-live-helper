'use strict';
/**
 * 支付宝当面付（扫码）适配器。
 * 需要：个体户/企业支付宝商户 + 开放平台应用（自研），配置见 .env。
 * 依赖 alipay-sdk（optionalDependencies，阶段 B 安装）。
 *
 * 下单：alipay.trade.precreate → 返回 qr_code（支付链接，前端转二维码）
 * 查单：alipay.trade.query
 * 回调：异步通知验签（支付宝公钥）
 */
const config = require('../config');

let _sdk = null;
function _client() {
    if (_sdk) return _sdk;
    const { AlipaySdk } = require('alipay-sdk');
    if (!process.env.ALIPAY_APP_ID || !process.env.ALIPAY_PRIVATE_KEY || !process.env.ALIPAY_PUBLIC_KEY) {
        throw new Error('支付宝未配置：请在 .env 填写 ALIPAY_APP_ID / ALIPAY_PRIVATE_KEY / ALIPAY_PUBLIC_KEY');
    }
    _sdk = new AlipaySdk({
        appId: process.env.ALIPAY_APP_ID,
        privateKey: process.env.ALIPAY_PRIVATE_KEY,
        alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY,
        gateway: 'https://openapi.alipay.com/gateway.do',
    });
    return _sdk;
}

const yuan = (fen) => (fen / 100).toFixed(2);

module.exports = {
    async createOrder({ orderId, amount, subject }) {
        const sdk = _client();
        const res = await sdk.exec('alipay.trade.precreate', {
            notifyUrl: `${config.PUBLIC_BASE_URL}/api/pay/notify/alipay`,
            bizContent: {
                out_trade_no: orderId,
                total_amount: yuan(amount),
                subject: subject || '抖音直播助手 PRO',
            },
        });
        if (!res || !res.qrCode) throw new Error('支付宝下单失败：' + (res && res.subMsg || ''));
        return { codeUrl: res.qrCode };
    },

    async queryOrder({ orderId }) {
        const sdk = _client();
        const res = await sdk.exec('alipay.trade.query', {
            bizContent: { out_trade_no: orderId },
        });
        // TRADE_SUCCESS / TRADE_FINISHED 视为已支付
        return (res && (res.tradeStatus === 'TRADE_SUCCESS' || res.tradeStatus === 'TRADE_FINISHED')) ? 'paid' : 'pending';
    },

    async verifyNotify({ body }) {
        const sdk = _client();
        // 支付宝异步通知为 form 表单，body 即参数表
        const ok = sdk.checkNotifySign(body);
        if (!ok) return { ok: false };
        const paid = body.trade_status === 'TRADE_SUCCESS' || body.trade_status === 'TRADE_FINISHED';
        return {
            ok: paid,
            orderId: body.out_trade_no,
            amount: Math.round(parseFloat(body.total_amount) * 100),
            replySuccess: 'success', // 支付宝要求回 "success"
        };
    },
};
