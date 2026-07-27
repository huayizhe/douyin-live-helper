/**
 * 发布同步脚本：把构建产物与必要静态文件复制到发布包目录 douyin_live_helper_plugin。
 * 无第三方依赖，跨平台。通过 `npm run release`（构建+同步）或 `npm run sync`（仅同步）调用。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const OUT_DIR = 'douyin_live_helper_plugin';
const out = path.join(root, OUT_DIR);

// [源文件相对路径, 发布包内相对路径]
const files = [
    ['manifest.json', 'manifest.json'],
    ['README.md', 'README.md'],
    ['dist/content.js', 'dist/content.js'],
    ['dist/bridge.js', 'dist/bridge.js'],
    ['lib/hls.min.js', 'lib/hls.min.js'],
    ['css/style.css', 'css/style.css'],
    ['icons/icon16.png', 'icons/icon16.png'],
    ['icons/icon48.png', 'icons/icon48.png'],
    ['icons/icon128.png', 'icons/icon128.png'],
];

let copied = 0;
const missing = [];
for (const [src, dest] of files) {
    const s = path.join(root, src);
    const d = path.join(out, dest);
    if (!fs.existsSync(s)) { missing.push(src); continue; }
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
    copied++;
}

console.log(`[release] 已同步 ${copied} 个文件到 ${OUT_DIR}/`);
if (missing.length) {
    console.warn('[release] 警告：缺少源文件 -> ' + missing.join(', '));
    process.exit(1);
}
