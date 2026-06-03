'use strict';
/**
 * 微信支付 Native（扫码）适配器。
 * 需要：个体户/企业微信支付商户号 + APIv3 密钥 + 商户证书，配置见 .env。
 * 依赖 wechatpay-node-v3（optionalDependencies，阶段 B 安装）。
 *
 * 下单：Native 下单 → 返回 code_url（weixin:// 链接，前端转二维码）
 * 查单：按商户订单号查询
 * 回调：APIv3 通知验签 + 解密
 */
const fs = require('fs');
const config = require('../config');

let _pay = null;
function _client() {
    if (_pay) return _pay;
    const WxPay = require('wechatpay-node-v3');
    const need = ['WX_APP_ID', 'WX_MCH_ID', 'WX_API_V3_KEY', 'WX_SERIAL_NO', 'WX_PRIVATE_KEY_PATH'];
    for (const k of need) if (!process.env[k]) throw new Error(`微信支付未配置：缺少 .env 的 ${k}`);
    _pay = new WxPay({
        appid: process.env.WX_APP_ID,
        mchid: process.env.WX_MCH_ID,
        serial_no: process.env.WX_SERIAL_NO,
        key: process.env.WX_API_V3_KEY,
        privateKey: fs.readFileSync(process.env.WX_PRIVATE_KEY_PATH),
    });
    return _pay;
}

module.exports = {
    async createOrder({ orderId, amount, subject }) {
        const pay = _client();
        const res = await pay.transactions_native({
            description: subject || '抖音直播助手 PRO',
            out_trade_no: orderId,
            notify_url: `${config.PUBLIC_BASE_URL}/api/pay/notify/wechat`,
            amount: { total: amount, currency: 'CNY' },
        });
        const codeUrl = res && (res.code_url || (res.data && res.data.code_url));
        if (!codeUrl) throw new Error('微信下单失败：' + JSON.stringify(res));
        return { codeUrl };
    },

    async queryOrder({ orderId }) {
        const pay = _client();
        const res = await pay.query({ out_trade_no: orderId });
        const state = res && (res.trade_state || (res.data && res.data.trade_state));
        return state === 'SUCCESS' ? 'paid' : 'pending';
    },

    async verifyNotify({ headers, rawBody }) {
        const pay = _client();
        // 验签 + 解密通知体
        const ok = await pay.verifySign({
            timestamp: headers['wechatpay-timestamp'],
            nonce: headers['wechatpay-nonce'],
            body: rawBody ? rawBody.toString() : '',
            serial: headers['wechatpay-serial'],
            signature: headers['wechatpay-signature'],
        });
        if (!ok) return { ok: false };
        const data = JSON.parse(rawBody.toString());
        const dec = pay.decipher_gcm(data.resource.ciphertext, data.resource.associated_data, data.resource.nonce, process.env.WX_API_V3_KEY);
        const paid = dec.trade_state === 'SUCCESS';
        return {
            ok: paid,
            orderId: dec.out_trade_no,
            amount: dec.amount && dec.amount.total,
            replySuccess: JSON.stringify({ code: 'SUCCESS', message: 'OK' }),
        };
    },
};
