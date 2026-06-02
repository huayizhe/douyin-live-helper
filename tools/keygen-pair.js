'use strict';
/**
 * 一次性生成 ECDSA P-256 密钥对（只需运行一次）。
 *
 * 用法：node tools/keygen-pair.js
 *   - 私钥写入 tools/private-key.json（已被 .gitignore 忽略；务必保管，切勿外泄/提交）
 *   - 公钥自动写入 js/license.js 的 _PK
 *
 * ⚠️ 重新生成会使旧私钥签发的所有许可证全部失效，请勿随意重置。
 */
const { webcrypto } = require('crypto');
const { subtle } = webcrypto;
const fs = require('fs');
const path = require('path');

(async () => {
    const dir = __dirname;
    const privPath = path.join(dir, 'private-key.json');

    if (fs.existsSync(privPath)) {
        console.error('⚠️  已存在 tools/private-key.json。');
        console.error('    重新生成会让旧密钥签发的所有许可证失效！如确需重置，请先手动删除该文件。');
        process.exit(1);
    }

    const pair = await subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true, ['sign', 'verify']
    );
    const priv = await subtle.exportKey('jwk', pair.privateKey);
    const pub  = await subtle.exportKey('jwk', pair.publicKey);
    const pubMin = { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y };

    fs.writeFileSync(privPath, JSON.stringify(priv, null, 2), 'utf8');
    console.log('✅ 私钥已保存到 tools/private-key.json（请勿外泄、勿提交版本库）');

    // 自动写入公钥到 js/license.js
    const licPath = path.join(dir, '..', 'js', 'license.js');
    let src = fs.readFileSync(licPath, 'utf8');
    const newPK = `const _PK = ${JSON.stringify(pubMin)};`;
    const re = /const _PK = \{[^;]*\};/;
    if (re.test(src)) {
        src = src.replace(re, newPK);
        fs.writeFileSync(licPath, src, 'utf8');
        console.log('✅ 公钥已自动写入 js/license.js 的 _PK');
    } else {
        console.log('⚠️  未能自动定位 _PK，请手动把下面这行替换进 js/license.js：');
        console.log('   ' + newPK);
    }

    console.log('\n下一步：node tools/issue-license.js --plan=month  生成一个测试密钥');
})();
