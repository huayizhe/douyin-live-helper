'use strict';
/**
 * 支付渠道适配器：统一接口，按渠道分发。
 * 加新渠道只需在 pay/ 下加一个实现并在此注册——上层路由与插件不动。
 * 各渠道模块用动态 require，mock 模式无需安装支付 SDK。
 */
const config = require('../config');

function _channel(name) {
    switch (name || config.CHANNEL) {
        case 'alipay': return require('./alipay');
        case 'wechat': return require('./wechat');
        case 'mock':
        default:       return require('./mock');
    }
}

module.exports = {
    /** 下单 → { codeUrl } 支付链接（前端转二维码） */
    createOrder(args) { return _channel(args.channel).createOrder(args); },

    /** 主动查单 → 'paid' | 'pending' */
    queryOrder(args) { return _channel(args.channel).queryOrder(args); },

    /** 验签回调 → { ok, orderId, amount, replySuccess } */
    verifyNotify(args) { return _channel(args.channel).verifyNotify(args); },
};
