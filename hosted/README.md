# 托管资源（CDN）

本目录文件通过 [jsDelivr](https://www.jsdelivr.com/) 从公开 GitHub 仓库分发，国内一般可较快访问。

| 文件 | 用途 | CDN |
|------|------|-----|
| `donate-qr.png` | 赞赏码 | `…/hosted/donate-qr.png?v=N` |
| `wechat-group-qr.jpg` | 微信群码 | `…/hosted/wechat-group-qr.jpg?v=N` |

完整前缀：`https://cdn.jsdelivr.net/gh/huayizhe/douyin-live-helper@master/hosted/`

### 如何更换（赞赏或群码）

1. 覆盖 `hosted/` 下对应图片（同时作为 CDN 源与扩展包兜底）  
2. 把 `js/support-qr.js` 里的 `QR_CACHE_BUST` 数字 **+1**  
3. `npm run release` 后提交推送 `master`  
4. 用户刷新即可看到新 CDN 图；若 CDN 暂不可用，重装/更新扩展包后仍有本地兜底  

群码约 7 天过期；失效可发邮件至 `1035864725@qq.com`，备注「插件交流进群」。
