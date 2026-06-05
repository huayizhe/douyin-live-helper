# 项目约定

1. **永远用中文回答我。**

## 项目结构
- 源码在 `js/`，通过 rollup 打包到 `douyin_live_helper_plugin/dist/`。
- 改完源码后用 `npm run release`（= `rollup -c` + `scripts/release.js`）构建并同步到发布包 `douyin_live_helper_plugin`，再到浏览器扩展中心重新加载。
- 数据使用 `chrome.storage.local`（按扩展隔离，跨 www/live 子域共享；真卸载后会清空）。
