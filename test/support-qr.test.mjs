/** @charset UTF-8 */
/**
 * 赞赏/交流二维码 URL 单元测试。
 *
 * 运行：npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DONATE_QR_CDN_BASE,
    GROUP_QR_CDN_BASE,
    QR_CACHE_BUST,
    SUPPORT_CONTACT_EMAIL,
    getCdnQrUrl,
    getDonateQrUrl,
    getGroupQrUrl
} from '../js/support-qr.js';

describe('赞赏/交流二维码（support-qr）', () => {
    it('赞赏码与群码均走 jsDelivr hosted', () => {
        assert.ok(DONATE_QR_CDN_BASE.includes('cdn.jsdelivr.net'));
        assert.ok(DONATE_QR_CDN_BASE.endsWith('/hosted/donate-qr.png'));
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

    it('过期联系邮箱', () => {
        assert.equal(SUPPORT_CONTACT_EMAIL, '1035864725@qq.com');
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
});
