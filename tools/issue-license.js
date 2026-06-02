'use strict';
/**
 * 离线签发许可证（收到付款后运行，把输出的字符串发给买家）。
 *
 * 用法：
 *   node tools/issue-license.js --plan=month                      # 月付（30 天）
 *   node tools/issue-license.js --plan=year                       # 年付（365 天）
 *   node tools/issue-license.js --plan=lifetime                   # 永久买断
 *   node tools/issue-license.js --plan=year --machine=<本机标识>  # 绑定指定设备（防转卖）
 *   node tools/issue-license.js --plan=month --days=45            # 自定义天数
 *
 * 买家在插件「激活 PRO」框粘贴该字符串即可解锁。绑定设备时，
 * 让买家先在升级弹窗点「查看本机标识」复制发你，再用 --machine= 传入。
 */
const { webcrypto } = require('crypto');
const { subtle } = webcrypto;
const fs = require('fs');
const path = require('path');

function b64u(buf) {
    return Buffer.from(buf).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

(async () => {
    const args = Object.fromEntries(
        process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
            const [k, ...v] = a.slice(2).split('=');
            return [k, v.join('=') || true];
        })
    );

    const plan = args.plan || 'month';
    const planDays = { month: 30, year: 365, lifetime: 36500 };
    if (!planDays[plan]) { console.error('plan 必须是 month | year | lifetime'); process.exit(1); }

    const days = args.days ? parseInt(args.days, 10) : planDays[plan];
    const machine = (typeof args.machine === 'string' && args.machine) ? args.machine : null;

    const privPath = path.join(__dirname, 'private-key.json');
    if (!fs.existsSync(privPath)) {
        console.error('未找到 tools/private-key.json，请先运行：node tools/keygen-pair.js');
        process.exit(1);
    }
    const privJwk = JSON.parse(fs.readFileSync(privPath, 'utf8'));
    const key = await subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

    const now = Date.now();
    const e = now + days * 86400000;
    const payload = { p: plan, e, i: now };
    if (machine) payload.m = machine;

    const header = b64u(JSON.stringify({ alg: 'ES256', typ: 'DYLH' }));
    const body   = b64u(JSON.stringify(payload));
    const data   = new TextEncoder().encode(`${header}.${body}`);
    const sig    = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
    const lic    = `${header}.${body}.${b64u(sig)}`;

    console.log('\n✅ 许可证已签发，复制下面整段发给买家：\n');
    console.log(lic);
    console.log('\n────────────────────────────────');
    console.log('套餐    : ' + plan + (plan === 'lifetime' ? '（永久）' : ` · ${days} 天 · 到期 ${new Date(e).toLocaleDateString('zh-CN')}`));
    console.log('机器绑定: ' + (machine ? machine : '无（任意设备可激活）'));
    console.log();
})();
