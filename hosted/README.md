# 托管资源（CDN）

本目录文件通过 [jsDelivr](https://www.jsdelivr.com/) 从公开 GitHub 仓库分发，国内一般可较快访问。

| 文件 | 用途 | CDN |
|------|------|-----|
| `donate-qr.png` | 赞赏码 | `…/hosted/donate-qr.png?v=N` |
| `wechat-group-qr.jpg` | 微信群码 | `…/hosted/wechat-group-qr.jpg?v=N` |

完整前缀（**必须钉 commit SHA，禁止写 `@master` 作主链接**）：

`https://cdn.jsdelivr.net/gh/huayizhe/douyin-live-helper@<QR_CDN_COMMIT>/hosted/`

当前示例：`https://cdn.jsdelivr.net/gh/huayizhe/douyin-live-helper@9f2080b/hosted/`

### 为何不能用 `@master`

jsDelivr 对 `@master` 分支可能长期返回旧图（即便 GitHub 上已是新图）。`?v=N` 也挡不住源站对 `@master` 文件内容的陈旧缓存。  
**验收以 GitHub raw 为准**（源文件真相）：

`https://github.com/huayizhe/douyin-live-helper/blob/master/hosted/wechat-group-qr.jpg?raw=true`

插件与 README 的展示链接一律用 `@<commit>` 形式的 jsDelivr。

### 如何更换（赞赏或群码）——两步提交

1. **先推图**：覆盖 `hosted/` 下对应图片（建议同步 `二维码/` 目录备份图），提交并推送到 `master`，记下该 commit 的 **短 SHA**（如 `9f2080b`）。  
2. **再钉 CDN**：在 `js/support-qr.js` 把 `QR_CDN_COMMIT` 设为该 SHA，`QR_CACHE_BUST` 数字 **+1**；同步根目录 `README.md` 里的 `<img src=…>` 为同一 `@SHA` URL；在本文件与 README 记录「群码上次更新」日期。  
3. `npm run release` 后**再次**提交推送 `master`。  
4. 用户刷新即可看到新 CDN 图；若 CDN 暂不可用，重装/更新扩展包后仍有本地兜底。

**群码上次更新：2026-08-07**（约 7 天后过期）。失效可发邮件至 `1035864725@qq.com`，备注「插件交流进群」。
