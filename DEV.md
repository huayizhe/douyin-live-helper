# 抖音关注直播助手

## 功能介绍

这是一个浏览器扩展插件，为抖音网页版添加以下功能：

1. 在导航栏添加"关注直播"菜单
   - 支持 www.douyin.com 和 live.douyin.com 两个域名
   - 自动适配深色/浅色模式
   - 未登录时提示登录
   - 通过 MAIN 世界桥接脚本 (bridge.js) 复用抖音自带反爬签名请求 `/webcast/web/feed/follow/`

2. 显示关注主播的直播列表，包含：
   - 直播封面截图
   - 直播标题
   - 主播头像和昵称
   - 在线观看人数
   - 支持搜索主播和标题
   - 支持按人气排序
   - 支持一键回到顶部
   - 支持刷新列表
   - 加载三态：loading 动画 / "当前没有正在关注的直播" / 加载失败提示

3. 特别关心：
   - 卡片上标记主播为"特别关心"，顶部可一键筛选
   - 使用 chrome.storage.sync 存储 (favorite.js)，跨 www/live 子域、跨设备同步，并自动迁移旧 localStorage 数据

4. 直播预览功能：
   - 鼠标悬停按需加载预览直播画面（已取消默认批量预加载，避免频繁请求卡顿）
   - 移开鼠标后捕获最后一帧作为卡片封面并缓存，带"已预览"标记，跨搜索/排序/重开列表保留
   - 大屏预览：默认铺满整屏(100%)，支持浏览器全屏(F11)按钮、ESC 分级退出、右下角控件自动隐显
   - 三联屏：同一路视频用 captureStream 镜像并排，零缝隙拼接、共享解码不卡顿
   - 支持自定义氛围词条（含 TTS 语音）、为每个主播单独配置、开关词条显示
   - 根据网络状况自动选择清晰度

5. 多路对比预览 (openComparePreview)：
   - 卡片右上角复选框勾选最多 3 个不同直播间，顶部"对比预览"按钮打开
   - 顶部"清除已选"按钮一键清空勾选 (ModalUI.clearCompare)；刷新列表 (refresh) 也会清除选中
   - 选中身份键用唯一的 roomUrl（避免 secUid 缺失时误判）
   - 网格布局复用三联屏样式（视频 height:100%/width:auto），竖屏无黑边、零缝隙拼接
   - 声音从全局总开关读取；每路独立音量控件（不同步全局、不持久化）
   - 录制：每路单独录制 / 合并录制（canvas 拼接画面 + Web Audio 混音 → 单文件），二者互斥
   - 全屏按钮 + ESC 与大屏预览逻辑一致（全屏时 ESC 退全屏、非全屏时关闭）
   - 控件显隐用 visibility + opacity 双控（见下方注意事项第 8 条）

6. 声音与音量：
   - 顶部声音总开关（放音/静音）+ 全局音量记忆，使用 chrome.storage.sync 存储 (settings.js)
   - 悬浮预览、大屏预览声音状态互相同步

7. 直播录制：
   - 大屏单路 / 对比单路 / 对比合并录制，统一高码率（vp8 + 10Mbps）保证清晰度
   - beforeunload 保护：录制中关闭/刷新页面自动保存已录内容（文件名带"_未完成"）
   - 文件命名区分：`抖音对比-单路_…` / `抖音对比-合并_…`

8. 资源监控 (monitor.js)：顶部按钮查看内存 / HLS 实例 / 视频元素占用

9. 快捷跳转：
   - 点击直播画面进入大屏预览，点击标题跳转直播间，点击主播头像跳转个人主页
   - 列表与各预览面板均支持 ESC 关闭

## 智能检测连麦画面

1. 实现原理
   - 监听视频的 loadedmetadata 事件获取实际宽高比
   - 标准直播画面比例约为 16:9 (1.778)
   - 连麦画面比例通常小于 1.5
   - 根据宽高比自动调整显示模式

2. 关键参数
   - STANDARD_ASPECT_RATIO = 16/9 (1.778)
   - MULTI_STREAM_THRESHOLD = 1.5
   - 视频容器样式：object-fit, display, justify-content

3. 优化策略
   - 连麦模式：最大化显示画面 (object-fit: contain)
   - 标准模式：保持原始比例 (object-fit: cover)
   - 自动检测并平滑切换显示模式
   - 支持手动切换显示模式

4. 实现步骤
   - 添加视频元数据加载事件监听
   - 计算并判断画面宽高比
   - 根据判断结果调整显示样式
   - 添加显示模式切换按钮
   - 记住用户偏好设置

## 项目结构

douyinfollowplugin/
├── dist/               # 编译后的文件
│   ├── content.js      # 打包后的主文件（隔离世界内容脚本）
│   └── bridge.js       # 打包后的桥接脚本（MAIN 世界，复用反爬签名）
├── js/                 # 源代码目录
│   ├── content.js      # 主入口文件，负责插件初始化（含 Favorite/Settings 初始化）
│   ├── bridge.js       # MAIN 世界桥接脚本，转发带签名的 feed/follow 请求
│   ├── menu.js         # 菜单处理模块，负责添加和持久化关注直播菜单
│   ├── modal.js        # 模态框模块，负责直播列表展示、搜索/排序/筛选、对比选择、加载三态
│   ├── card.js         # 直播卡片模块，负责创建卡片、对比复选框、点击跳转
│   ├── preview.js      # 预览模块：悬浮预览、大屏预览、三联屏、多路对比、录制
│   ├── favorite.js     # 特别关心模块（chrome.storage.sync + 内存缓存）
│   ├── settings.js     # 全局设置模块：音量/声音总开关（chrome.storage.sync）
│   ├── license.js      # PRO 授权：离线 ECDSA 验签、激活/解除、权益对比升级页
│   ├── preload.js      # 预加载管理（按需）
│   ├── monitor.js      # 资源监控模块
│   ├── toast.js        # 轻提示模块
│   ├── constants.js    # 常量定义（选择器、清晰度、语音等）
│   ├── utils.js        # 通用工具模块（DOM/样式/网络/语音/文本）
│   └── logger.js       # 日志模块，提供统一的日志输出
├── lib/                # 第三方库
│   └── hls.min.js      # HLS 播放器，用于直播流播放
├── css/                # 样式文件
│   └── style.css       # 主样式文件，包含所有自定义样式
├── icons/              # 图标资源
│   ├── icon16.png      # 16x16 图标，用于扩展图标
│   ├── icon48.png      # 48x48 图标，用于扩展管理页
│   └── icon128.png     # 128x128 图标，用于商店展示
├── tools/              # 许可证签发工具
│   ├── keygen-pair.js  # 生成 ECDSA 密钥对，自动写入公钥到 license.js
│   ├── issue-license.js# 离线签发许可证（--plan/--days/--machine）
│   └── private-key.json# 私钥（运行 keygen 后生成；.gitignore 忽略，勿外泄）
├── docs/               # 运营/部署手册（收款发卡、服务器部署、插件配置测试）
├── .gitignore          # Git 忽略（node_modules、私钥、.env 等）
├── manifest.json       # 扩展配置文件，定义权限和资源
├── rollup.config.js    # Rollup 构建配置，定义打包规则
├── package.json        # 项目配置文件，包含依赖和脚本
├── README.md           # 说明文档，包含安装和使用说明
├── CHANGELOG.md        # 更新日志
└── DEV.md              # 开发文档，包含开发和构建说明

## PRO 授权架构（阶段一：离线）

采用 **ECDSA P-256（ES256）非对称签名**，离线验签，不依赖服务器。

1. 原理
   - 私钥签发、公钥验签：私钥只在你本地（`tools/private-key.json`），插件内置公钥（`license.js` 的 `_PK`）。
   - 拿不到私钥就无法伪造有效许可证；改动许可证任意字节验签即失败。
   - 许可证 payload：`{ p:套餐, e:到期时间戳, i:签发时间, m:机器标识(可选) }`，**不分功能档位**，月/年/买断仅 `e` 不同。

2. 密钥与签发
   - 初始化一次：`node tools/keygen-pair.js`（生成密钥对，公钥自动写入 `license.js`）。
   - 收款后签发：`node tools/issue-license.js --plan=month|year|lifetime [--machine=<本机标识>] [--days=N]`。
   - 把输出的许可证字符串发给买家，买家在插件「激活 PRO」框粘贴即可。

3. 验签与功能锁
   - 插件启动时 `LicenseManager.init()`（`content.js` 的 `Promise.all`）读取 `storage.local` 中的许可证并本地验签，决定 `isPro`。
   - 功能锁点：`modal.js`（多路对比按钮）、`preview.js`（录制按钮、氛围词条配置/开关）。非 PRO 点击弹 `showUpgradePrompt()`。
   - 免费保留：三联屏镜像、特别关心（无限）、资源监控。

4. 改动须知
   - 修改 `license.js` / `constants.js` 等源码后，必须 `npm run build` 才会进 `dist/`。
   - 价格、客服微信、购买链接在 `constants.js` 的 `LICENSE` 常量配置。
   - **在线订阅支付**：`server/`（Node+Express）下单 → 弹二维码 → 支付回调/轮询 → 用同一私钥签发授权 → 插件自动激活。支付层适配器 `server/pay/{alipay,wechat,mock}.js`，加/换渠道不动业务。插件端 `license.js` 的 `createOrder/pollOrder/rebindToThisDevice` 对接；配置 `constants.js` 的 `SERVER` 与 `manifest.json` 域名。详见 `docs/服务器部署手册.md`。

## 开发环境设置

1. 安装 Node.js (推荐 v16+)

2. 安装项目依赖
   npm install

3. 开发模式构建(支持热重载)
   npm run watch

4. 生产环境构建
   npm run build

5. 一键发布同步（构建 + 复制发布文件到 douyin_live_helper_plugin）
   npm run release
   - 仅同步不构建：npm run sync
   - 同步脚本：scripts/release.js（复制 manifest/dist/lib/css/icons/README.md）

## 构建说明

项目使用 Rollup 进行构建，主要配置：

1. 构建工具
   - 使用 Rollup 打包
   - 支持 ES6 模块化开发
   - 自动处理模块依赖
   - 代码压缩混淆

2. 构建配置
   - 入口文件: js/content.js（隔离世界）、js/bridge.js（MAIN 世界）
   - 输出目录: dist/content.js、dist/bridge.js
   - 输出格式: IIFE (立即执行函数)
   - 使用插件:
     * @rollup/plugin-node-resolve: 解析模块依赖
     * rollup-plugin-terser: 代码压缩混淆

3. 开发流程
   - 开发模式: `npm run watch`
     * 监听文件变化
     * 自动重新构建
     * 支持源码映射
   - 生产构建: `npm run build`
     * 代码压缩混淆
     * 移除调试代码
     * 生成生产版本

4. 文件说明
   - content.js: 插件入口文件，初始化菜单、特别关心与全局设置缓存
   - bridge.js: MAIN 世界脚本，复用抖音签名转发 feed/follow 请求
   - menu.js: 处理导航菜单的注入与持久化
   - modal.js: 处理弹窗、直播列表、搜索/排序/筛选、对比选择、加载三态
   - card.js: 处理直播卡片创建、对比复选框与点击跳转
   - preview.js: 悬浮/大屏/三联屏/多路对比预览与录制
   - favorite.js: 特别关心存储（chrome.storage.sync）
   - settings.js: 音量/声音总开关存储（chrome.storage.sync）
   - license.js: PRO 授权（离线 ECDSA 验签、激活/解除、权益对比升级页）
   - preload.js: 按需预加载管理
   - monitor.js: 资源监控
   - toast.js: 轻提示
   - constants.js: 常量定义
   - utils.js: 提供通用工具函数
   - logger.js: 提供日志功能

## 浏览器安装测试

1. 打开 Edge 浏览器扩展管理
   - 地址栏输入: edge://extensions/
   - 或点击菜单 -> 扩展程序

2. 开启"开发人员模式"(右上角开关)

3. 点击"加载解压缩的扩展程序"

4. 选择项目根目录(包含 manifest.json 的目录)

5. 刷新抖音网页版,检查插件是否正常工作:
   - 左侧菜单是否出现"关注直播"选项
   - 点击后是否正常显示直播列表
   - 预览功能是否正常

## 调试方法

1. 控制台日志
   - F12 打开开发者工具
   - 切换到 Console 面板
   - 查看插件输出的调试日志

2. 源码调试
   - Sources 面板找到 content.js
   - 设置断点进行调试
   - 实时查看变量值

3. 样式调试
   - Elements 面板检查DOM结构
   - Styles 面板调试CSS样式

## 发布流程

> 约定：每次改动后同步更新 README.md / DEV.md / CHANGELOG.md 三个文档，再执行 `npm run release` 刷新发布包。

1. 更新版本号
   - manifest.json
   - package.json

2. 一键构建并同步发布包
   npm run release
   （等价于 `npm run build` + `node scripts/release.js`；自动复制下列文件到 douyin_live_helper_plugin/）
   - manifest.json
   - README.md
   - dist/content.js
   - dist/bridge.js      # MAIN 世界桥接脚本，manifest 已引用，不可遗漏
   - lib/hls.min.js
   - css/style.css
   - icons/

3. 提交到 Edge / Chrome 扩展商店

## 注意事项

1. content.js 为主入口文件,包含插件初始化逻辑

2. 使用 ES6 模块化组织代码,保持结构清晰

3. 样式文件统一在 css/style.css 中管理

4. 代码提交前先进行本地测试

5. 重要更新及时记录到 CHANGELOG

6. manifest 权限：`activeTab` + `storage`（特别关心与全局设置使用 chrome.storage.sync）；
   host_permissions 为 `*://*.douyin.com/*`

7. 录制依赖浏览器 MediaRecorder（webm/vp8）、canvas.captureStream 与 Web Audio，
   仅在 Chromium 内核浏览器验证；合并录制为 canvas 拼接 + 多路音轨混音

8. 大屏/对比预览控件显隐：用 visibility + opacity 双控（隐藏 visibility:hidden + pointerEvents:none，
   显示 visibility:visible + opacity:1）。原因：Edge 全屏 top-layer 下，仅切换 opacity 时带 backdrop-filter
   的控件可能不重绘——元素真实 opacity 已为 1（可命中、可点击、光标变手指），但视觉仍透明。切换 visibility
   会强制重绘并移出命中测试。注：该方案待在出问题的 Edge 机器上实测确认

## Chrome 系列浏览器测试

本插件兼容主流 Chromium 内核浏览器。各浏览器"扩展管理入口"和"开发者模式开关位置"不同，下表先速查、后附详细步骤。

| 浏览器 | 内核 | 扩展管理入口 | 开发者模式位置 | 备注 |
|--------|------|-------------|---------------|------|
| Google Chrome | Chromium | ⋮ → 扩展程序 → 管理扩展程序 / `chrome://extensions/` | 右上角 | 已验证 |
| Microsoft Edge | Chromium | ⋯ → 扩展 → 管理扩展 / `edge://extensions/` | 左侧栏下方 | 已验证 |
| 360 安全浏览器 | Chromium | ☰ → 更多工具 → 扩展中心 / `chrome://extensions/` | 右上角 | 已验证，部分版本需弹窗确认 |
| 360 极速浏览器 | Chromium | ☰ → 更多工具 → 扩展中心 / `chrome://extensions/` | 右上角 | 已验证 |
| QQ 浏览器 | Chromium | ☰ → 应用中心 → 我的应用/扩展管理 / `chrome://extensions/` | 右上角 | 已验证 |
| 夸克浏览器(PC) | Chromium | ☰ → 扩展/扩展管理 / `chrome://extensions/` | **左下角**（隐蔽，易找不到） | 视版本 |
| 搜狗高速浏览器 | Chromium | 菜单 → 扩展/扩展中心 / `chrome://extensions/` | 多在右上角 | 视版本 |
| 2345 加速浏览器 | Chromium | 菜单 → 扩展中心 / `chrome://extensions/` | 多在右上角 | 视版本 |
| UC 浏览器(PC) | Chromium | ☰ → 扩展 / `chrome://extensions/` | 视版本（上/下角都看） | 视版本 |

> 通用收尾：开启开发者模式 → 点「加载已解压的扩展程序」→ 选择含 `manifest.json` 的目录（开发期选项目根目录，发布期选发布包 `douyin_live_helper_plugin`）→ 访问抖音网页版验证。
> 找不到"扩展中心"时，地址栏直接输入 `chrome://extensions/` 一般都能打开扩展管理页。

### Google Chrome
1. 右上角 ⋮ → 扩展程序 → 管理扩展程序；或地址栏 `chrome://extensions/`
2. 打开**右上角**的开发者模式开关
3. 点「加载已解压的扩展程序」→ 选目录
4. 访问抖音网页版测试功能

### Microsoft Edge
1. 右上角 ⋯ → 扩展 → 管理扩展；或地址栏 `edge://extensions/`
2. 打开**左侧栏下方**的"开发人员模式"开关
3. 点「加载解压缩的扩展」→ 选目录
4. 访问抖音网页版测试功能

### 360 安全浏览器 / 360 极速浏览器
1. ☰ 菜单 → 更多工具 → 扩展中心；或地址栏 `chrome://extensions/`
2. 打开**右上角**的开发者模式开关
3. 点「加载已解压的扩展程序」→ 选目录（部分版本弹窗点"添加扩展"确认）
4. 访问抖音网页版测试功能

### QQ 浏览器
1. ☰ 菜单 → 应用中心 → 左侧"我的应用/扩展管理"；或地址栏 `chrome://extensions/`
2. 打开**右上角**的开发者模式开关
3. 点「加载已解压的扩展程序」→ 选目录
4. 访问抖音网页版测试功能

### 夸克浏览器（电脑版）
1. ☰ 菜单 → 扩展/扩展管理；或地址栏 `chrome://extensions/`
2. ⚠️ 开发者模式开关在扩展管理页**左下角**（位置隐蔽，常被忽略，注意是页面左下角而非右上角）
3. 打开后点「加载已解压的扩展程序」→ 选目录
4. 访问抖音网页版测试功能

### 搜狗高速浏览器 / 2345 加速浏览器 / UC 浏览器（电脑版）
1. 浏览器菜单 → 扩展/扩展中心/更多工具→扩展程序；或地址栏 `chrome://extensions/`
2. 打开开发者模式开关（多在右上角，少数在左下角，找不到时上下角都看）
3. 点「加载已解压的扩展程序」→ 选目录
4. 访问抖音网页版测试功能

> 提示：特别关心、声音/音量设置使用 `chrome.storage.sync`。其**跨设备同步**需登录浏览器账号并开启同步功能；未登录时退化为本地存储，但跨 www/live 子域共享与基础功能仍正常。

## 扩展商店发布指南

### Chrome Web Store 发布
1. 准备材料
   - 创建 ZIP 压缩包（包含所有必要文件）
   - 准备至少一张 1280x800 的截图
   - 准备 128x128 的图标
   - 编写详细的扩展描述

2. 开发者注册
   - 访问 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - 支付一次性注册费（$5）
   - 完成开发者信息验证

3. 提交审核
   - 创建新项目
   - 上传 ZIP 文件
   - 填写商店展示信息
   - 添加截图和图标
   - 选择分类（推荐选择 "生产力工具"）
   - 设置价格（免费）
   - 提交审核

4. 审核注意事项
   - 确保隐私政策合规
   - 明确说明所需权限的用途
   - 避免使用受限 API
   - 遵守内容政策
   - 审核时间通常为 2-3 个工作日

### Microsoft Edge Add-ons 发布
1. 准备材料（与 Chrome 类似）

2. 开发者注册
   - 访问 [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge)
   - 注册开发者账号（免费）

3. 提交流程
   - 创建新提交
   - 上传包文件
   - 填写商店信息
   - 提供截图和图标
   - 提交审核

## 发布检查清单

- [ ] 所有功能正常工作
- [ ] 代码已压缩混淆
- [ ] manifest.json 版本号已更新
- [ ] 图标资源完整
- [ ] 隐私政策已更新
- [ ] 商店描述准确完整
- [ ] 截图展示最新功能
- [ ] 已在多个浏览器测试

## 扩展商店发布文件清单

1. 必需文件
   - manifest.json       # 扩展配置文件
   - dist/content.js     # 打包后的主文件（隔离世界）
   - dist/bridge.js      # 打包后的桥接脚本（MAIN 世界，复用反爬签名，必须包含）
   - lib/hls.min.js      # HLS 播放器库
   - css/style.css      # 主样式文件
   - icons/             # 图标必须包含以下尺寸
     * icon16.png       # 工具栏图标
     * icon48.png       # 扩展管理页图标
     * icon128.png      # 商店展示图标

2. 商店资料
   - 商店图标 (128x128)
   - 商店横幅 (1280x800 或 640x400)
   - 至少一张功能截图 (1280x800)
   - 详细的扩展描述
   - 隐私政策说明

3. 发布目录结构

   douyin_live_helper_plugin/
   ├── manifest.json
   ├── dist/
   │   ├── content.js
   │   └── bridge.js
   ├── lib/
   │   └── hls.min.js
   ├── css/
   │   └── style.css
   └── icons/
       ├── icon16.png
       ├── icon48.png
       └── icon128.png

4. 打包注意事项
   - 确保 manifest.json 中的版本号正确
   - 所有文件使用 UTF-8 编码
   - 图标必须是 PNG 格式
   - ZIP 压缩包大小不超过限制
   - 不要包含不必要的开发文件
   - 确保所有引用的资源都已包含
   - 检查文件权限是否正确
   - 验证 ZIP 文件完整性
   - 在新环境测试安装
