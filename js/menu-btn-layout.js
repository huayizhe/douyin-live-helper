/** @charset UTF-8 */
/**
 * 顶栏菜单按钮统一尺寸。
 * 含「资源/设置」在内，所有菜单按钮同宽同高，不再单独加宽。
 */

/** 顶栏菜单按钮宽度（px） */
export const MENU_BTN_WIDTH_PX = 104;

/** 顶栏菜单按钮高度（px） */
export const MENU_BTN_HEIGHT_PX = 36;

/**
 * 返回顶栏菜单按钮统一内联样式（固定 104×36）。
 * @returns {Record<string, string>}
 */
export function getMenuBtnInlineStyle() {
    return {
        height: `${MENU_BTN_HEIGHT_PX}px`,
        width: `${MENU_BTN_WIDTH_PX}px`,
        minWidth: `${MENU_BTN_WIDTH_PX}px`,
        padding: '0 10px',
        boxSizing: 'border-box',
        justifyContent: 'center',
        whiteSpace: 'nowrap',
        flex: '0 0 auto',
        overflow: 'hidden'
    };
}
