/**
 * MAIN 世界桥接脚本
 *
 * 内容脚本运行在隔离世界（isolated world），它的 fetch 不会被抖音页面打补丁，
 * 因此请求 /webcast/web/feed/follow/ 时拿不到抖音的反爬签名（a_bogus / msToken），
 * 导致接口返回空 feed。
 *
 * 本脚本以 world: "MAIN" 注入到页面主世界，复用抖音页面自身（已自动签名）的
 * fetch + Cookie 发起请求，再通过 postMessage 把结果回传给隔离世界的内容脚本。
 */
(function () {
    const REQUEST_TYPE = 'DYLH_FETCH_FOLLOW_FEED';
    const RESULT_TYPE = 'DYLH_FOLLOW_FEED_RESULT';

    function getBrowserInfo() {
        const ua = navigator.userAgent;
        let browserName = 'Chrome';
        let browserVersion = '';
        let engineName = 'Blink';
        let engineVersion = '';

        const chromeMatch = ua.match(/Chrome\/([0-9.]+)/);
        if (chromeMatch) {
            browserVersion = chromeMatch[1];
            engineVersion = chromeMatch[1];
        }
        if (ua.indexOf('Edg') > -1) {
            browserName = 'Edge';
        }
        return { browserName, browserVersion, engineName, engineVersion };
    }

    function buildFeedUrl() {
        const baseUrl = location.hostname === 'live.douyin.com'
            ? 'https://live.douyin.com'
            : 'https://www.douyin.com';

        const info = getBrowserInfo();
        const conn = navigator.connection || {};

        // 不再手动拼签名参数（webid / msToken / a_bogus）——交给抖音页面的 fetch 自动注入
        const params = {
            device_platform: 'webapp',
            aid: '6383',
            channel: 'channel_pc_web',
            scene: 'aweme_pc_follow_top',
            version_code: '170400',
            version_name: '17.4.0',
            cookie_enabled: String(navigator.cookieEnabled),
            screen_width: window.screen.width,
            screen_height: window.screen.height,
            browser_language: navigator.language,
            browser_platform: navigator.platform,
            browser_name: info.browserName,
            browser_version: info.browserVersion,
            browser_online: String(navigator.onLine),
            engine_name: info.engineName,
            engine_version: info.engineVersion,
            os_name: navigator.platform.indexOf('Win') > -1 ? 'Windows'
                : navigator.platform.indexOf('Mac') > -1 ? 'MacOS'
                : navigator.platform.indexOf('Linux') > -1 ? 'Linux' : 'Unknown',
            os_version: '10',
            cpu_core_num: navigator.hardwareConcurrency || 4,
            device_memory: navigator.deviceMemory || 8,
            platform: 'PC',
            downlink: conn.downlink || '10',
            effective_type: conn.effectiveType || '4g',
            round_trip_time: '50'
        };

        const queryString = Object.entries(params)
            .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
            .join('&');

        return `${baseUrl}/webcast/web/feed/follow/?${queryString}`;
    }

    async function fetchFollowFeed() {
        const url = buildFeedUrl();
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
                'Accept-Language': 'zh-CN,zh;q=0.9'
            }
        });
        const data = await response.json();
        return { httpStatus: response.status, data };
    }

    window.addEventListener('message', async (event) => {
        if (event.source !== window) return;
        const msg = event.data;
        if (!msg || msg.type !== REQUEST_TYPE) return;

        const requestId = msg.requestId;
        try {
            const { httpStatus, data } = await fetchFollowFeed();
            window.postMessage(
                { type: RESULT_TYPE, requestId, ok: true, httpStatus, data },
                location.origin
            );
        } catch (err) {
            window.postMessage(
                { type: RESULT_TYPE, requestId, ok: false, error: String((err && err.message) || err) },
                location.origin
            );
        }
    });
})();
