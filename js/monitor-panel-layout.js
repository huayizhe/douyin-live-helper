/** @charset UTF-8 */
/**
 * 资源/设置统一面板壳高布局常量。
 * 三 Tab 共用同一固定壳高，内容少不塌、内容多在 mon-body 内滚动。
 */

/** 面板壳高：与 max-height 同值，避免备份 Tab 内容少时窗口变矮 */
export const MONITOR_PANEL_SHELL_HEIGHT = 'min(86vh, 720px)';

/**
 * 返回创建面板时的壳尺寸样式（height = maxHeight = 固定壳高）。
 * @returns {{ height: string, maxHeight: string }}
 */
export function getMonitorPanelShellStyles() {
    return {
        height: MONITOR_PANEL_SHELL_HEIGHT,
        maxHeight: MONITOR_PANEL_SHELL_HEIGHT
    };
}
