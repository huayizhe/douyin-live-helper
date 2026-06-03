'use strict';
/**
 * 抖音关注直播助手 — 在线订阅许可证服务
 *
 * 流程：插件下单 → 返回二维码 → 用户扫码付款 → 渠道回调/插件轮询 → 签发许可证 → 插件自动激活。
 * 部署见 docs/服务器部署手册.md。
 */
require('dotenv').config();
const express = require('express');
const QRCode = require('qrcode');
const config = require('./config');
const db = require('./db');
const lic = require('./license');
const pay = require('./pay/adapter');

const app = express();

// 保留 rawBody 供支付回调验签
const saveRaw = (req, _res, buf) => { req.rawBody = buf; };
app.use(express.json({ verify: saveRaw }));
app.use(express.urlencoded({ extended: true, verify: saveRaw }));

// CORS：允许浏览器扩展跨域访问
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

const genOrderId = () => 'DY' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** 结算：签发许可证入库（幂等；续费自动接续到期） */
async function settle(o) {
    if (o.status === 'paid' && o.license) return o;
    const prevExpiry = db.findPaidByMachine(o.machine_id).map(x => x.expiry || 0);
    const baseExpiry = prevExpiry.length ? Math.max(...prevExpiry) : 0;
    const { license, expiry } = await lic.signLicense({
        plan: o.plan, days: config.PLANS[o.plan].days, machineId: o.machine_id, baseExpiry,
    });
    db.update(o.orderId, { status: 'paid', license, expiry, paid_at: Date.now() });
    return db.getOrder(o.orderId);
}

// ── 下单 ──
app.post('/api/order/create', async (req, res) => {
    try {
        const { plan, machineId, channel } = req.body || {};
        const p = config.PLANS[plan];
        if (!p) return res.status(400).json({ error: '套餐无效' });
        if (!machineId) return res.status(400).json({ error: '缺少设备标识' });
        const orderId = genOrderId();
        const ch = channel || config.CHANNEL;
        db.createOrder({
            orderId, plan, amount: p.amount, machine_id: machineId,
            status: 'pending', channel: ch, license: null, expiry: null,
            created_at: Date.now(), paid_at: null,
        });
        const { codeUrl } = await pay.createOrder({ orderId, amount: p.amount, subject: `抖音直播助手 PRO ${p.label}`, channel: ch });
        const qrDataUrl = await QRCode.toDataURL(codeUrl, { margin: 1, width: 240 });
        res.json({ orderId, qrDataUrl, amount: p.amount, plan });
    } catch (e) {
        console.error('[create]', e);
        res.status(500).json({ error: '下单失败，请稍后重试' });
    }
});

// ── 查单（轮询）──
app.get('/api/order/status', async (req, res) => {
    try {
        const o = db.getOrder(req.query.orderId);
        if (!o) return res.status(404).json({ error: '订单不存在' });
        if (o.status === 'paid') return res.json({ status: 'paid', license: o.license });
        const st = await pay.queryOrder({ orderId: o.orderId, channel: o.channel });
        if (st === 'paid') {
            const updated = await settle(o);
            return res.json({ status: 'paid', license: updated.license });
        }
        res.json({ status: 'pending' });
    } catch (e) {
        console.error('[status]', e);
        res.status(500).json({ error: '查询失败' });
    }
});

// ── 支付异步回调 ──
app.post('/api/pay/notify/:channel', async (req, res) => {
    try {
        const channel = req.params.channel;
        const r = await pay.verifyNotify({ channel, headers: req.headers, rawBody: req.rawBody, body: req.body });
        if (!r.ok) return res.status(400).send('verify fail');
        const o = db.getOrder(r.orderId);
        if (o && o.amount === r.amount) await settle(o);
        res.send(r.replySuccess || 'success');
    } catch (e) {
        console.error('[notify]', e);
        res.status(500).send('error');
    }
});

// ── 换绑设备（解绑旧设备 + 绑定当前设备）──
app.post('/api/rebind', async (req, res) => {
    try {
        const { license, newMachineId } = req.body || {};
        if (!newMachineId) return res.status(400).json({ error: '缺少设备标识' });
        const payload = await lic.verifyLicense(license);
        if (!payload) return res.status(403).json({ error: '授权无效' });
        const remainMs = (payload.e || 0) - Date.now();
        if (remainMs <= 0) return res.status(403).json({ error: '授权已过期，无法换绑' });
        const { license: newLic, expiry } = await lic.signLicense({
            plan: payload.p, days: remainMs / 86400000, machineId: newMachineId,
        });
        res.json({ license: newLic, expiry });
    } catch (e) {
        console.error('[rebind]', e);
        res.status(500).json({ error: '换绑失败' });
    }
});

// ── 开发：mock 手动标记支付 ──
if (config.CHANNEL === 'mock') {
    const mock = require('./pay/mock');
    app.post('/api/mock/pay', (req, res) => {
        const { orderId } = req.body || {};
        if (!db.getOrder(orderId)) return res.status(404).json({ error: '订单不存在' });
        mock._markPaid(orderId);
        res.json({ success: true });
    });
}

app.get('/health', (_req, res) => res.json({ ok: true, channel: config.CHANNEL }));

app.listen(config.PORT, () => {
    console.log(`✅ 许可证服务已启动 :${config.PORT}（渠道=${config.CHANNEL}）`);
});
