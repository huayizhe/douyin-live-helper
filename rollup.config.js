const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');
const terser = require('@rollup/plugin-terser');

const production = !process.env.ROLLUP_WATCH;

const plugins = () => [
  nodeResolve({
    browser: true,
    mainFields: ['browser', 'module', 'main']
  }),
  commonjs(),
  production && terser({
    format: {
      comments: false
    },
    compress: {
      drop_console: false,
      drop_debugger: true
    },
    mangle: {
      reserved: ['Logger', 'DOMUtils', 'StyleUtils', 'ResourceMonitor']
    }
  })
].filter(Boolean);

module.exports = [
  {
    input: 'js/content.js',
    output: {
      file: 'dist/content.js',
      format: 'iife',
      sourcemap: true,
      name: 'DouyinLiveHelper'
    },
    plugins: plugins()
  },
  {
    // MAIN 世界桥接脚本（独立打包，注入页面主世界）
    input: 'js/bridge.js',
    output: {
      file: 'dist/bridge.js',
      format: 'iife',
      sourcemap: true,
      name: 'DouyinLiveBridge'
    },
    plugins: plugins()
  }
];