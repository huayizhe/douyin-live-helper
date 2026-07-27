/** @charset UTF-8 */
/**
 * 赞赏/交流二维码 URL 单元测试。
 *
 * 运行：npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DONATE_COPY_TEXTS,
    DONATE_QR_CDN_BASE,
    DONATE_QR_LOCAL_PATH,
    GROUP_QR_CDN_BASE,
    GROUP_QR_LOCAL_PATH,
    QR_CACHE_BUST,
    SUPPORT_CONTACT_EMAIL,
    getCdnQrUrl,
    getDonateQrUrl,
    getGroupQrUrl,
    getLocalQrUrl,
    pickRandomDonateCopy,
    escapeHtml,
    resolveQrDisplaySrc
} from '../js/support-qr.js';

describe('赞赏/交流二维码（support-qr）', () => {
    it('赞赏码与群码均走 jsDelivr hosted，并有本地相对路径', () => {
        assert.ok(DONATE_QR_CDN_BASE.includes('cdn.jsdelivr.net'));
        assert.equal(DONATE_QR_LOCAL_PATH, 'hosted/donate-qr.png');
        assert.equal(GROUP_QR_LOCAL_PATH, 'hosted/wechat-group-qr.jpg');
        assert.ok(GROUP_QR_CDN_BASE.endsWith('/hosted/wechat-group-qr.jpg'));
        assert.ok(QR_CACHE_BUST.length > 0);
    });

    it('getCdnQrUrl 追加缓存戳', () => {
        assert.equal(
            getCdnQrUrl('https://cdn.example.com/qr.jpg', '3'),
            'https://cdn.example.com/qr.jpg?v=3'
        );
        assert.equal(
            getCdnQrUrl('https://cdn.example.com/qr.jpg?x=1', '2'),
            'https://cdn.example.com/qr.jpg?x=1&v=2'
        );
    });

    it('getDonateQrUrl / getGroupQrUrl 默认 bust 一致', () => {
        assert.equal(getDonateQrUrl(), `${DONATE_QR_CDN_BASE}?v=${QR_CACHE_BUST}`);
        assert.equal(getGroupQrUrl(), `${GROUP_QR_CDN_BASE}?v=${QR_CACHE_BUST}`);
    });

    it('无 chrome 时 getLocalQrUrl 回传相对路径', () => {
        assert.equal(getLocalQrUrl(DONATE_QR_LOCAL_PATH), DONATE_QR_LOCAL_PATH);
    });

    it('过期联系邮箱', () => {
        assert.equal(SUPPORT_CONTACT_EMAIL, '1035864725@qq.com');
    });

    it('赞赏文案共 4 条，随机结果落在列表内', () => {
        assert.equal(DONATE_COPY_TEXTS.length, 4);
        assert.equal(pickRandomDonateCopy(() => 0), DONATE_COPY_TEXTS[0]);
        assert.equal(pickRandomDonateCopy(() => 0.99), DONATE_COPY_TEXTS[3]);
        for (let i = 0; i < 20; i++) {
            assert.ok(DONATE_COPY_TEXTS.includes(pickRandomDonateCopy()));
        }
    });

    it('escapeHtml 转义特殊字符', () => {
        assert.equal(escapeHtml('a<b>"c"'), 'a&lt;b&gt;&quot;c&quot;');
    });

    it('fetchQrObjectUrl：非 2xx 应抛错', async () => {
        const { fetchQrObjectUrl } = await import('../js/support-qr.js');
        const orig = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: false, status: 404 });
        try {
            await assert.rejects(() => fetchQrObjectUrl('https://example.com/x.png'), /HTTP 404/);
        } finally {
            globalThis.fetch = orig;
        }
    });

    it('fetchQrObjectUrl：成功则返回 blob: URL', async () => {
        const { fetchQrObjectUrl } = await import('../js/support-qr.js');
        const orig = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: true,
            blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
        });
        try {
            const u = await fetchQrObjectUrl('https://example.com/x.png');
            assert.ok(String(u).startsWith('blob:'));
            URL.revokeObjectURL(u);
        } finally {
            globalThis.fetch = orig;
        }
    });

    it('resolveQrDisplaySrc：CDN 失败则回退本地', async () => {
        const orig = globalThis.fetch;
        let n = 0;
        globalThis.fetch = async (url) => {
            n++;
            if (String(url).includes('cdn.jsdelivr')) {
                return { ok: false, status: 503 };
            }
            return {
                ok: true,
                blob: async () => new Blob([new Uint8Array([9])], { type: 'image/png' })
            };
        };
        try {
            const r = await resolveQrDisplaySrc(
                'https://cdn.jsdelivr.net/gh/x/hosted/a.png?v=1',
                'hosted/donate-qr.png'
            );
            assert.equal(r.from, 'local');
            assert.equal(r.revoke, true);
            assert.ok(String(r.src).startsWith('blob:'));
            assert.ok(n >= 2);
            URL.revokeObjectURL(r.src);
        } finally {
            globalThis.fetch = orig;
        }
    });
});
