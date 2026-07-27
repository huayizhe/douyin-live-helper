/** @charset UTF-8 */
/**
 * 播放门控 / 面板壳高 / 悬浮预览衔接单元测试。
 *
 * 运行：npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    PLAY_VISIBLE_RATIO,
    PLAY_ROOT_MARGIN,
    PLAY_THRESHOLDS,
    shouldPlayCard
} from '../js/playback-gate.js';
import {
    MONITOR_PANEL_SHELL_HEIGHT,
    getMonitorPanelShellStyles
} from '../js/monitor-panel-layout.js';
import {
    MENU_BTN_WIDTH_PX,
    MENU_BTN_HEIGHT_PX,
    getMenuBtnInlineStyle
} from '../js/menu-btn-layout.js';
import {
    HOVER_LIVE_Z_INDEX,
    shouldPauseLoopAfterHoverLive
} from '../js/hover-preview-gate.js';

describe('播放视口门控（playback-gate）', () => {
    it('常量：露出 0.35 + rootMargin 300px + 含 0.35 的 threshold', () => {
        assert.equal(PLAY_VISIBLE_RATIO, 0.35);
        assert.equal(PLAY_ROOT_MARGIN, '300px 0px');
        assert.ok(PLAY_THRESHOLDS.includes(0.35));
        assert.deepEqual([...PLAY_THRESHOLDS], [0, 0.25, 0.35, 0.5, 0.75, 1]);
    });

    it('未相交或比例不足不播', () => {
        assert.equal(shouldPlayCard(false, 1), false);
        assert.equal(shouldPlayCard(true, 0.34), false);
        assert.equal(shouldPlayCard(true, 0), false);
    });

    it('相交且比例 ≥0.35 才播', () => {
        assert.equal(shouldPlayCard(true, 0.35), true);
        assert.equal(shouldPlayCard(true, 0.5), true);
        assert.equal(shouldPlayCard(true, 1), true);
    });

    it('可覆盖最低比例阈值', () => {
        assert.equal(shouldPlayCard(true, 0.5, 0.6), false);
        assert.equal(shouldPlayCard(true, 0.6, 0.6), true);
    });
});

describe('监控面板固定壳高（monitor-panel-layout）', () => {
    it('壳高常量与 height/maxHeight 一致', () => {
        assert.equal(MONITOR_PANEL_SHELL_HEIGHT, 'min(86vh, 720px)');
        const s = getMonitorPanelShellStyles();
        assert.equal(s.height, MONITOR_PANEL_SHELL_HEIGHT);
        assert.equal(s.maxHeight, MONITOR_PANEL_SHELL_HEIGHT);
    });
});

describe('顶栏菜单按钮统一尺寸（menu-btn-layout）', () => {
    it('宽高固定为 104×36，含资源/设置在内无单独加宽', () => {
        assert.equal(MENU_BTN_WIDTH_PX, 104);
        assert.equal(MENU_BTN_HEIGHT_PX, 36);
        const s = getMenuBtnInlineStyle();
        assert.equal(s.width, '104px');
        assert.equal(s.minWidth, '104px');
        assert.equal(s.height, '36px');
        assert.equal(s.flex, '0 0 auto');
        assert.equal(s.overflow, 'hidden');
    });
});

describe('悬浮预览衔接（hover-preview-gate）', () => {
    it('hover live z-index 高于循环（1）', () => {
        assert.equal(HOVER_LIVE_Z_INDEX, '2');
        assert.ok(Number(HOVER_LIVE_Z_INDEX) > 1);
    });

    it('仅 play 成功才应 pause 循环', () => {
        assert.equal(shouldPauseLoopAfterHoverLive(true), true);
        assert.equal(shouldPauseLoopAfterHoverLive(false), false);
        assert.equal(shouldPauseLoopAfterHoverLive(undefined), false);
        assert.equal(shouldPauseLoopAfterHoverLive(null), false);
    });
});
