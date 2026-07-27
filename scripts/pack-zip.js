/**
 * 打包发布 zip：生成「抖音关注直播助手-v{version}.zip」，并删除仓库根目录旧版同系列 zip。
 * 由 `npm run release`（构建+同步后）或 `npm run pack` 调用。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const OUT_DIR = 'douyin_live_helper_plugin';
const srcDir = path.join(root, OUT_DIR);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const zipName = `抖音关注直播助手-v${version}.zip`;
const zipPath = path.join(root, zipName);
const ZIP_PREFIX = '抖音关注直播助手-v';

if (!fs.existsSync(srcDir)) {
    console.error(`[pack] 缺少目录 ${OUT_DIR}/，请先 npm run release / sync`);
    process.exit(1);
}

// 删掉根目录旧版安装包（保留即将生成的当前版文件名对应项会先删再写）
for (const name of fs.readdirSync(root)) {
    if (!name.startsWith(ZIP_PREFIX) || !name.endsWith('.zip')) continue;
    const full = path.join(root, name);
    try {
        fs.unlinkSync(full);
        console.log(`[pack] 已删除旧包 ${name}`);
    } catch (e) {
        console.warn(`[pack] 删除失败 ${name}:`, e.message);
    }
}

if (process.platform === 'win32') {
    // Compress-Archive 路径用正斜杠/引号更稳
    const ps = `Compress-Archive -Path (Join-Path '${srcDir.replace(/'/g, "''")}' '*') -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
    execSync(`powershell -NoProfile -Command "${ps}"`, { stdio: 'inherit' });
} else {
    execSync(`zip -r -q "${zipPath}" .`, { cwd: srcDir, stdio: 'inherit' });
}

const st = fs.statSync(zipPath);
console.log(`[pack] 已生成 ${zipName} (${Math.round(st.size / 1024)} KB)`);
