# 托管资源（CDN）

本目录文件通过 [jsDelivr](https://www.jsdelivr.com/) 从公开 GitHub 仓库分发，国内一般可较快访问。

## 微信群二维码

- 文件：`wechat-group-qr.jpg`
- CDN 示例：`https://cdn.jsdelivr.net/gh/huayizhe/douyin-live-helper@master/hosted/wechat-group-qr.jpg?v=1`

### 如何更换群码（约 7 天过期后）

1. 用新的群二维码图片覆盖 `hosted/wechat-group-qr.jpg`（建议仍用 JPG）
2. 把 `js/support-qr.js` 里的 `GROUP_QR_CACHE_BUST` 数字 **+1**（强制刷新 CDN 缓存）
3. 提交并推送到 `master`
4. 用户刷新抖音页面即可看到新码（无需重装插件）

赞赏码打在扩展包 `icons/qr-donate.png` 内，换赞赏码需覆盖该文件后重新 `npm run release` 并发布新包。
