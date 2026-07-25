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
   - 使用 chrome.storage.local 存储 (favorite.js)，按扩展隔离、跨 www/live 子域共享；内存缓存 + onChanged 监听同步多标签
   - 注意：local **不跨设备同步**，**真正卸载（移除后再添加）后会清空**；reload 不会清空

4. 直播预览功能：
   - 鼠标悬停按需加载预览直播画面（已取消默认批量预加载，避免频繁请求卡顿）
   - 移开鼠标后捕获最后一帧作为卡片封面并缓存，带"已预览"标记，跨搜索/排序/重开列表保留
   - 大屏预览：默认铺满整屏(100%)，支持浏览器全屏(F11)按钮、ESC 分级退出、右下角控件自动隐显
   - 三联屏：同一路视频用 captureStream 镜像并排，零缝隙拼接、共享解码不卡顿
   - 支持自定义氛围词条（含 TTS 语音）、为每个主播单独配置、开关词条显示
   - 大屏打开时按 `NetworkUtils.getAppropriateQuality()` 自适应清晰度；右下角 chip 可手动切换（菜单宽度与按钮等宽，仅 1 档时隐藏）
   - 手动切清晰度：新流出画面后**续播 1.5s 再硬切**直播源（不再交叉淡入）；录制中、三联屏禁用

5. 多路对比预览 (openComparePreview)：
   - 卡片右上角复选框勾选最多 3 个不同直播间，顶部「N 同时看」按钮打开（自 1.3.1 起，原名「对比预览(N)」；去图标、计数前置、`white-space:nowrap` 防挤）
   - 顶部"清除已选"按钮一键清空勾选 (ModalUI.clearCompare)；刷新列表 (refresh) 也会清除选中
   - 选中身份键用唯一的 roomUrl（避免 secUid 缺失时误判）
   - 网格布局复用三联屏样式（视频 height:100%/width:auto），竖屏无黑边、零缝隙拼接
   - 声音从全局总开关读取；每路独立音量控件（不同步全局、不持久化）
   - 录制：每路单独录制 / 合并录制（canvas 拼接画面 + Web Audio 混音 → 单文件），二者互斥
   - 全屏按钮 + ESC 与大屏预览逻辑一致（全屏时 ESC 退全屏、非全屏时关闭）
   - 控件显隐用 visibility + opacity 双控（见下方注意事项第 8 条）
   - **打开即暂停后台预加载墙**（拉流加载 + 整墙循环播放），关闭时恢复；多路同录解码/编码 CPU 不再被后台抢占

6. 声音与音量：
   - 顶部声音总开关（放音/静音）+ 全局音量记忆，使用 chrome.storage.local 存储 (settings.js)
   - 悬浮预览、大屏预览声音状态互相同步

7. 直播录制：
   - 大屏单路 / 对比单路 / 对比合并录制，统一 10Mbps 高码率保证清晰度
   - 编码器 `_pickRecorderMime`：**H.264（avc1）硬件编码优先、回退 VP8 软编**——H.264 多走 GPU 硬编几乎不吃 CPU，多路同录不再卡顿；VP8/VP9 是纯 CPU 软编仅作兜底
   - 容器/后缀随实际编码走（`_recContainer` + `_downloadRec`，读 `recorder.mimeType`）：H.264→`.mp4`/`.mkv`、回退→`.webm`，避免误存导致文件损坏
   - 起录即 `PreloadManager.abortInFlight()` 深度限流：中止后台墙在途加载/录制，CPU 全让给前台
   - beforeunload 保护：录制中关闭/刷新页面自动保存已录内容（文件名带"_未完成"）
   - 文件命名区分：`抖音对比-单路_…` / `抖音对比-合并_…`
   - 大屏录制指示器：左下角红色闪烁圆点 + 时间；停止仅弹一条「视频保存成功」（不再「录制已停止」+「保存成功」双弹）

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
│   ├── favorite.js     # 特别关心模块（chrome.storage.local + 内存缓存；含导入/导出）
│   ├── settings.js     # 全局设置模块：音量/声音总开关（chrome.storage.local）
│   ├── stats.js        # 本地观看统计：每主播本周次数/时长（chrome.storage.local，按 ISO 周清零）
│   ├── license.js      # PRO 授权：离线 ECDSA 验签、激活/解除、权益对比升级页
│   ├── preload.js      # 预加载管理（按需）
│   ├── preload-concurrency.js # 加载/录制并发公式与加载槽持有器（纯函数，单测共用）
│   ├── monitor.js      # 资源监控模块
│   ├── toast.js        # 轻提示模块
│   ├── constants.js    # 常量定义（选择器、清晰度、语音等）
│   ├── utils.js        # 通用工具模块（DOM/样式/网络/语音/文本）
│   └── logger.js       # 日志模块，提供统一的日志输出
├── test/               # 单元测试（npm test → node --test）
│   └── preload.test.mjs
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
   - 功能锁点：`modal.js`（「N 同时看」按钮，原「对比预览」）、`preview.js`（录制按钮、氛围词条配置/开关）。非 PRO 点击弹 `showUpgradePrompt()`。
   - 免费保留：三联屏镜像、特别关心（无限）、资源监控。

4. 设备识别码（机器绑定）
   - `getMachineId()` 先读 `storage.local` 缓存（reload 快路径）；缓存缺失时**由 `_computeFingerprint()` 确定性派生**——对 `navigator.platform`、`hardwareConcurrency`、`deviceMemory`、屏幕宽高/色深、`language`、`Intl.DateTimeFormat().resolvedOptions().timeZone`、`maxTouchPoints` 拼接后做 SHA-256，取前 32 位 hex 加 `fp-` 前缀；指纹接口失败兜底为随机值。
   - 此举为修复「**插件被移除后再添加**会清空 `storage.local` → 重新生成的随机 UUID 与旧激活码 `payload.m` 不匹配 → 旧码失效」。改后重装能算出**同一个**设备码，旧激活码重新粘贴即可恢复 PRO。
   - 注意：换设备/重装系统/重大浏览器变更（如显示器换分辨率、时区改动）仍可能导致指纹漂移；这种情况走「自动换绑」流程（服务端可用时）或重新签发。激活码绑定/验签逻辑（`_verify`/`activate`/`deactivate`）保持不变。

5. 改动须知
   - 修改 `license.js` / `constants.js` 等源码后，必须 `npm run build` 才会进 `dist/`。
   - ⚠️ **改完一律用 `npm run release`（= build + sync），不要只 `npm run build`**。`npm run build` 只输出到根目录 `dist/`，**不会**更新发布包 `douyin_live_helper_plugin/`。若加载的是发布包目录，只 build 不 sync 会出现「重新加载插件却没生效」——因为发布包里的 `dist/content.js`、`css/style.css` 还是旧的。只改了 JS/CSS、想跳过重复构建时可单独 `npm run sync`。
   - 价格、客服微信、购买链接在 `constants.js` 的 `LICENSE` 常量配置。
   - **在线订阅支付**：`server/`（Node+Express）下单 → 弹二维码 → 支付回调/轮询 → 用同一私钥签发授权 → 插件自动激活。支付层适配器 `server/pay/{alipay,wechat,mock}.js`，加/换渠道不动业务。插件端 `license.js` 的 `createOrder/pollOrder/rebindToThisDevice` 对接；配置 `constants.js` 的 `SERVER` 与 `manifest.json` 域名。详见 `docs/服务器部署手册.md`。

## 代码仓库

- GitHub（私人）：https://github.com/huayizhe/douyin-live-helper
- 本地远程名：`origin`（`git remote -v` 可核对）
- 克隆：`git clone https://github.com/huayizhe/douyin-live-helper.git`
- 推送：`git push -u origin master`（或当前分支）

> 提交历史以 Git / GitHub 为准，不必单独维护「git 提交记录」文档；面向用户/版本的变更说明写在 `CHANGELOG.md`。

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
   - modal.js: 处理弹窗、直播列表、搜索/排序/筛选、对比选择、加载三态；统一 ESC 关闭顺序（PRO 弹窗→资源面板→大屏让位→关列表）
   - card.js: 处理直播卡片创建、对比复选框与点击跳转
   - preview.js: 悬浮/大屏/三联屏/多路对比预览与录制；大屏「切清晰度」用「续播 1.5s 再硬切」（`_switchBigScreenQuality`）
   - favorite.js: 特别关心存储（chrome.storage.local + 内存缓存；exportData/importData）
   - settings.js: 音量/声音总开关存储（chrome.storage.local + 内存缓存）
   - stats.js: 本地观看统计（本周次数/时长；startSession/endSession/getWeekCount）
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

6. manifest 权限：`activeTab` + `storage`（**特别关心 / 设置 / 氛围词条 / 许可证 / 设备识别码全部使用 `chrome.storage.local`**，按扩展隔离、跨 www/live 子域共享，但不跨设备同步、真卸载会清空）；
   host_permissions 为 `*://*.douyin.com/*`（在线订阅模式下额外含许可证服务器域名）

7. 录制依赖浏览器 MediaRecorder（webm/vp8）、canvas.captureStream 与 Web Audio，
   仅在 Chromium 内核浏览器验证；合并录制为 canvas 拼接 + 多路音轨混音

8. 大屏/对比预览控件显隐：用 visibility + opacity 双控（隐藏 visibility:hidden + pointerEvents:none，
   显示 visibility:visible + opacity:1）。原因：Edge 全屏 top-layer 下，仅切换 opacity 时带 backdrop-filter
   的控件可能不重绘——元素真实 opacity 已为 1（可命中、可点击、光标变手指），但视觉仍透明。切换 visibility
   会强制重绘并移出命中测试。注：该方案待在出问题的 Edge 机器上实测确认

9. 大屏「切清晰度」流程（`preview.js` `_switchBigScreenQuality`，自 1.3.1 起）：
   - 后台用临时 `video`（`visibility:hidden`，叠在 v0 上）+ 新建 Hls 预拉目标流；新流 `canplay` 后 **`setTimeout(swap, 1500)`**，
     这 1.5s 内旧流继续播放，**到点一次性硬切**直播源（不做透明度/音量渐变）。
   - 切换瞬间：旧 video pause+remove、旧 Hls destroy；新 video 转为 flex 子元素（`visibility:visible`），按旧流当前 `muted/volume`
     设音量；更新 `videos[0]`、`this.currentBigVideo`、`this.fullPreviewHlsInstances`。
   - 禁用条件：`this.isRecording` 或 `videos.length !== 1`（三联屏）。`canplay` 未触发 8s 兜底直接切；致命 ERROR 未切前回滚。
   - 弃用：原 `_crossfadeBigScreenQuality` 交叉淡入路径（透明度/音量双向 ramp 1500ms）。背景：淡入期间双解码 + 双解码音轨易触发
     黑屏/闪缩/同步偏差，复杂且不稳定。

10. 大屏「切清晰度」菜单宽度（`preview.js` `createQualityBtn`，自 1.3.1 起）：
   - 菜单上弹用 `position:absolute; left:0; right:0; bottom:40px`，宽度自动等于按钮（去掉 `minWidth:72px`）；档位项 padding `8px 6px`，短文案居中。
   - 仅一档可用时（`avail.length<=1`）按钮直接 `display:none`。

11. ESC 关闭顺序（`modal.js` `disableDouyinShortcuts.keydownHandler`，自 1.3.1 起重排）：
   1) `#dylh-overlay`（PRO 升级/会员信息弹窗）`remove()`；
   2) `.resource-monitor-panel` 可见时 `ResourceMonitor.hidePanel()`；
   3) 否则若大屏 `#dy-modal` / 对比 `#dy-compare-modal` / `document.fullscreenElement` 在，**让位**给各自的 ESC；
   4) 都不在时关闭直播列表 `.live-modal`。
   - 旧顺序在第 3 步前直接 `return`，导致叠在大屏之上的浮层 ESC 失效。把 1)/2) 提到 3) 之前即可全场景生效。
   - 该 keydown 监听器在打开列表时注册（捕获阶段、`stopPropagation` 屏蔽抖音原快捷键），关列表时移除。

12. 设备识别码生成：见 `## PRO 授权架构` 第 4 节「设备识别码（机器绑定）」。简言之——`getMachineId()` 缓存缺失时由
    `_computeFingerprint()` 用稳定信号 SHA-256 确定性派生（`fp-` 前缀），重装后能算出同一标识，旧激活码继续生效。

13. 视口播放门控（`modal.js` `_setupPlaybackObserver`，自 1.3.2 起）：
    - 与既有加载观察器 `_clipObserver`（负责预加载/缓存调度）**解耦**，
      新增一个独立的 `IntersectionObserver`（`rootMargin: 0px`、`threshold: [0, 1]`）只管「是否播放」。
    - 回调里 `entry.intersectionRatio >= 0.999` 视为完整可见 → `PreloadManager.resumeCard()`；否则 → `pauseCard()`。
      同时把 `cardPreview._shouldPlay = boolean` 写到卡片上。
    - `preload.js` 的 `attachLoop` / `_startLoad.finalizeLoop` / `resumeCard` 在调用 `video.play()` 前检查
      `cardPreview._shouldPlay !== false`——处理「加载/录制完成时卡片正好不完全可见」的竞态
      （IO 不会自动再触发回调）。`pauseCard` 仍跳过 `_clipLoading=true` 的卡片，避免污染录制。
    - 效果：同屏播放路数严格 = 当前视口完全容纳数（典型 ~12）。滚动出去的卡片立即暂停解码，
      未滚到的卡片即使已缓存也不播。

14. 循环片段流水线 & 重渲染重置（`preload.js` + `modal.js`，自 1.3.3 起）：
    - **重渲染硬重置**：`renderLiveList` 在 `container.innerHTML=''` **之前**调 `PreloadManager.resetForRerender()`——
      先清 `queue`（避免中止触发的 `_pump()` 再启动加载），再遍历 `visible` 中止在录 `_clipAbort()` + `_removeLoopVideo()`
      释放解码，最后清 `visible` 与残留 `queued` 状态。**保留 `preloadCache`**。
      必须在 innerHTML 清空前调用，否则 `<video>` 已脱离 DOM 但仍解码（游离解码泄漏）。
    - **严格视口加载**：`_setupClipObserver` 的 `rootMargin` 已从 `300px` 收紧到 `0`——视口外不预取/不排队；
      `threshold: 0.01` 保留（相交即加载）；`CLIP_SETTLE_MS` 停稳延时保留（快速滚过不拉流，命中缓存仍即时挂）。
    - **离屏踢队列**：`release()` 除中止在录、移除循环视频外，新增从 `queue` 过滤掉该 room、清其 `queued` 状态，
      使排队列表持续 = 当前视口（天然优先视口，不止重渲染那一刻）。
    - **未改**：`MAX_CONCURRENT` 并发上限；缓存保留（离屏只释放解码、留 blob，靠 LRU `MAX_CACHE=120` 优先淘汰离屏）。

15. 加载与录制并发分离（`preload.js`，自 1.4.1 起；**1.4.3 真正解耦加载槽**）：
    - **加载**并发用 `MAX_CONCURRENT`（字面/硬上限 **15**，自适应 `max(8, min(15, ceil(cores*1.0)))`，
      `_pump` 以它为上限）——多路同时拉流/起播、快速铺首屏。
    - **录制（编码）**另由信号量限制到 `MAX_CONCURRENT_RECORD`（自适应 `max(2, min(4, ceil(cores*0.35)))`，
      弱机 2 / 常见 3 / 强机最高 4）：`_startLoad` 在 `playing` 时**立刻释放加载槽**并 `_pump()`，再
      `_acquireRecordSlot(recordFn)`；满则把 `recordFn` 排进 `_recordWaiters`、该路 live 继续播等位。
      `finalizeLoop`/`cleanup`/早退用 `createLoadSlotHolder` 防二次减加载槽；据 `recordStarted` 调
      `_releaseRecordSlot()` 或 `_cancelRecordWaiter()`。公式与释槽语义抽在 `preload-concurrency.js`，
      单测见 `test/preload.test.mjs`（`npm test`）。
    - 画质：`CLIP_BITRATE=800000`；`RECORD_MS` 自 1.4.3 起为 **6000**（加快录制槽周转）。
    - 监控面板：「片段加载 进行/排队/上限」读 `MAX_CONCURRENT`，「录制（编码）进行/上限」读
      `activeRecords`/`MAX_CONCURRENT_RECORD`。
    - 背景：1.4.0 曾用录制上限当加载上限；1.4.1 分离常量但仍把 `activeLoads` 占到录完；
      1.4.3 出画面即释加载槽，避免录制 2–4 路堵死整墙拉流。

16. 分批滚动加载（`modal.js`，自 1.4.0 起）：`renderLiveList` 首批 `RENDER_BATCH=60`，末尾 `.live-grid-sentinel`
    哨兵 + `_batchObserver`（rootMargin 600px）滚到底追加下一批；`_appendCards` 复用建卡逻辑并对每张
    `observe` 两个视口观察器；`_teardownBatchObserver` 在重渲染/ESC 关/X 关处断开。不支持 IO 时一次性补齐。

17. 悬浮防误触（`preview.js` `setupPreview`，自 1.4.0 起）：`pauseCard` + `pauseLoading('hover')` 已并入
    既有 200ms 去抖回调（原先在 mouseenter 立即执行）。快速掠过不再停循环、不卡预加载。

18. 大屏画中画（`preview.js` `createPipBtn`）：**自 1.4.1 起已下线**——大屏控制栏不再创建/append PiP 按钮
    （`createControlBar` 内两处已注释）。`createPipBtn` 方法**保留**（作用于 `this.currentBigVideo`，切清晰度后动态取；
    点击时 `disablePictureInPicture=false` 再 `requestPictureInPicture()`）。恢复：取消那两处注释即可。

19. 本地观看统计（`stats.js`，自 1.4.0 起）：`startSession/endSession`（停留 ≥`MIN_COUNT_SEC`=3s 才计一次、累加时长，
    按 ISO 周键 `_weekKey()` 自动清零）；埋点在 `preview.js` 的 `startStreamPreview`/`openFullPreview`（start）与
    `clearPreview`（end）。`card.js` 用 `getWeekCount` 渲染「本周看 N 次」角标。`modal.js` 排序三态
    `this.sortMode`（default/popularity/mostWatched）经统一的 `_getViewList()`/`_rerenderView()` 生效。

20. 特别关心导入/导出（`favorite.js` `exportData`/`importData` + `modal.js` `createBackupButton`，自 1.4.0 起）：
    「备份」按钮弹 body 级固定定位菜单（避开 header `overflow:hidden` 裁剪）；导出 Blob 下载、导入合并去重后
    `_rerenderView()` 刷新心标。注意 toast 第二参用字符串字面量 `'success'`/`'error'`（modal.js 未导入 `TOAST` 常量，
    1.4.1 修复了误用 `TOAST.TYPE.*` 导致导入抛错的问题）。特别关心「筛选视图」只展示**当前在播**的关注主播，
    离线关注不在列表内属正常（导入数量以提示「共 N 个」为准）。

21. 会员体系总开关 `LICENSE.ENABLED`（`constants.js`，自 1.4.1 起 = `false`）：
    - 关闭时 `license.js` 的 `get isPro()` 一律返回 `true` → 4 个功能门（`modal.js` N同时看、`preview.js` 录制/氛围词条）
      全部自动放行，无需逐个改；`modal.js` 顶栏不创建/不 append `licenseBtn`（`LICENSE.ENABLED ? createLicenseBtn() : null`，
      并对 `licenseBtn.style` 赋值与 append 加 `if (licenseBtn)` 守卫）。
    - 许可证全部代码（`license.js` 验签/激活/换绑/弹窗、`tools/` 签发、`server/` 在线支付、`constants.js` 价格）**原样保留**。
    - 恢复收费体系：把 `LICENSE.ENABLED` 置回 `true` 即可，无需改其它代码。

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

> 提示：特别关心、声音/音量、氛围词条、PRO 授权、设备识别码均使用 `chrome.storage.local`，按扩展隔离、跨 www/live 子域共享。**不跨设备同步**；扩展中心「重新加载」数据保留，「移除后再添加」会清空（重装后旧激活码可由确定性派生的设备码恢复，重新粘贴即可激活）。

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
