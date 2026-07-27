/** @charset UTF-8 */
/**
 * 赞赏/交流二维码 URL 单元测试。
 *
 * 运行：npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DONATE_QR_REL_PATH,
    GROUP_QR_CDN_BASE,
    GROUP_QR_CACHE_BUST,
    getGroupQrUrl
} from '../js/support-qr.js';

describe('赞赏/交流二维码（support-qr）', () => {
    it('赞赏码走扩展包相对路径', () => {
        assert.equal(DONATE_QR_REL_PATH, 'icons/qr-donate.png');
    });

    it('群码基址走 jsDelivr 托管 hosted 文件', () => {
        assert.ok(GROUP_QR_CDN_BASE.startsWith('https://cdn.jsdelivr.net/gh/'));
        assert.ok(GROUP_QR_CDN_BASE.includes('hosted/wechat-group-qr.jpg'));
        assert.ok(GROUP_QR_CACHE_BUST.length > 0);
    });

    it('getGroupQrUrl 追加缓存戳', () => {
        assert.equal(
            getGroupQrUrl('3', 'https://cdn.example.com/qr.jpg'),
            'https://cdn.example.com/qr.jpg?v=3'
        );
        assert.equal(
            getGroupQrUrl('2', 'https://cdn.example.com/qr.jpg?x=1'),
            'https://cdn.example.com/qr.jpg?x=1&v=2'
        );
    });

    it('默认 bust 与常量一致', () => {
        assert.equal(getGroupQrUrl(), `${GROUP_QR_CDN_BASE}?v=${GROUP_QR_CACHE_BUST}`);
    });
});
