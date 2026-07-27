# 托管资源（CDN）

本目录文件通过 [jsDelivr](https://www.jsdelivr.com/) 从公开 GitHub 仓库分发，国内一般可较快访问。

| 文件 | 用途 | CDN |
|------|------|-----|
| `donate-qr.png` | 赞赏码 | `…/hosted/donate-qr.png?v=N` |
| `wechat-group-qr.jpg` | 微信群码 | `…/hosted/wechat-group-qr.jpg?v=N` |

完整前缀：`https://cdn.jsdelivr.net/gh/huayizhe/douyin-live-helper@master/hosted/`

### 如何更换（赞赏或群码）

1. 覆盖对应图片文件  
2. 把 `js/support-qr.js` 里的 `QR_CACHE_BUST` 数字 **+1**  
3. 提交并推送到 `master`  
4. 用户刷新抖音页面即可（无需重装插件）

群码约 7 天过期；失效可发邮件至 `1035864725@qq.com`，备注「插件交流进群」。
