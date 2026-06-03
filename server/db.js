'use strict';
/**
 * 订单存储。
 * 默认用零依赖的 JSON 文件存储（订单量不大完全够用，自测无需编译原生模块）。
 * 如需更强并发/查询，可替换为 better-sqlite3（已在 optionalDependencies），接口保持不变。
 *
 * 订单结构：
 *   { orderId, plan, amount, machine_id, status:'pending'|'paid',
 *     channel, license, expiry, created_at, paid_at }
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'orders.json');
let _data = { orders: {} };

function _load() {
    try { _data = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
    catch { _data = { orders: {} }; }
}
function _save() {
    fs.writeFileSync(FILE, JSON.stringify(_data, null, 2), 'utf8');
}
_load();

module.exports = {
    createOrder(o) { _data.orders[o.orderId] = o; _save(); return o; },
    getOrder(id) { return _data.orders[id] || null; },
    update(id, patch) {
        const o = _data.orders[id];
        if (!o) return null;
        Object.assign(o, patch);
        _save();
        return o;
    },
    /** 该设备所有已支付订单（用于续费接续到期时间） */
    findPaidByMachine(mid) {
        return Object.values(_data.orders).filter(o => o.machine_id === mid && o.status === 'paid');
    },
};
