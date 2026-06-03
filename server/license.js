'use strict';
/**
 * 服务端许可证签发/验签。
 * 与 tools/issue-license.js 完全相同的算法和格式（ES256），
 * 用同一把私钥签发，插件用内置公钥本地验签——在线签发与手动签发互相兼容。
 */
const { webcrypto } = require('crypto');
const { subtle } = webcrypto;
const fs = require('fs');
const path = require('path');

const b64u = (buf) => Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uToBuf = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

let _privJwk = null;
function _loadPriv() {
    if (_privJwk) return _privJwk;
    if (process.env.PRIVATE_KEY_JWK) {
        _privJwk = JSON.parse(process.env.PRIVATE_KEY_JWK);
        return _privJwk;
    }
    // 开发期回退：读项目内 tools/private-key.json
    const p = path.join(__dirname, '..', 'tools', 'private-key.json');
    if (fs.existsSync(p)) {
        _privJwk = JSON.parse(fs.readFileSync(p, 'utf8'));
        return _privJwk;
    }
    throw new Error('未配置私钥：请在 .env 设置 PRIVATE_KEY_JWK，或提供 tools/private-key.json');
}

/**
 * 签发许可证
 * @param {string} plan        套餐
 * @param {number} days        时长（天）
 * @param {string} machineId   绑定设备
 * @param {number} [baseExpiry] 续费时的旧到期时间戳；新到期从中接续
 * @returns {Promise<{license:string, expiry:number, payload:object}>}
 */
async function signLicense({ plan, days, machineId, baseExpiry }) {
    const jwk = _loadPriv();
    const key = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const now = Date.now();
    const start = (baseExpiry && baseExpiry > now) ? baseExpiry : now;  // 续费：接续旧到期
    const e = Math.round(start + days * 86400000);
    const payload = { p: plan, e, i: now };
    if (machineId) payload.m = machineId;
    const header = b64u(JSON.stringify({ alg: 'ES256', typ: 'DYLH' }));
    const body = b64u(JSON.stringify(payload));
    const data = new TextEncoder().encode(`${header}.${body}`);
    const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
    return { license: `${header}.${body}.${b64u(sig)}`, expiry: e, payload };
}

/**
 * 验签（用于 /api/rebind 验证用户提交的旧许可证合法）。
 * 只校验签名有效，不校验机器（换绑场景）。
 * @returns {Promise<object|null>} payload 或 null
 */
async function verifyLicense(licStr) {
    try {
        const jwk = _loadPriv();
        const pub = { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
        const key = await subtle.importKey('jwk', pub, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        const [h, p, s] = String(licStr).split('.');
        if (!h || !p || !s) return null;
        const data = new TextEncoder().encode(`${h}.${p}`);
        const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64uToBuf(s), data);
        if (!ok) return null;
        return JSON.parse(b64uToBuf(p).toString());
    } catch { return null; }
}

module.exports = { signLicense, verifyLicense };
