/**
 * 菜单相关的选择器常量
 */
export const MENU_SELECTORS = {
    TABS: {
        FRIEND: '.tab-friend',
        FOLLOW: '.tab-follow'
    },
    
    // 从 tab-friend/tab-follow 元素向上遍历几层，到达 item 外层容器（与导航列表直接子元素同级）
    // 结构：tab-friend div → 匿名 div → item 外层容器 div，共 2 层
    // 使用层级遍历代替 class 名称，避免抖音每次发版改 class 导致失效
    TAB_PARENT_LEVELS: 2,

    // 菜单巡检间隔（毫秒）：每隔这么久检查一次菜单是否还在，不在就补回
    CHECK_INTERVAL: 3000,

    // 连续失败多少次后判定失败并停止巡检（连续，成功会清零）
    MAX_RETRY: 5
}; 

/**
 * 网络相关常量
 */
export const NETWORK = {
    // 网络类型
    TYPE: {
        _4G: '4g',
        _3G: '3g',
        UNKNOWN: 'unknown'
    },
    // 网络速度阈值（Mbps）
    DOWNLINK_SPEED: {
        FULL_HD1: 8,    // 蓝光需要的最小下行速度 单位：Mbps
        HD1: 5,         // 超清需要的最小下行速度 单位：Mbps
        SD2: 2,         // 高清需要的最小下行速度 单位：Mbps
        SD1: 1          // 标清需要的最小下行速度 单位：Mbps
    }
};

/**
 * 清晰度相关常量
 */
export const LIVE_QUALITY = {
    // 清晰度级别
    FULL_HD1: 'FULL_HD1',  // 蓝光
    HD1: 'HD1',            // 超清
    SD2: 'SD2',            // 高清 这个级别应该是后续增加的 所以值是SD2，清晰度在SD1之上
    SD1: 'SD1',            // 标清
    // 清晰度顺序（从高到低）
    ORDER: ['FULL_HD1', 'HD1', 'SD2', 'SD1']
}; 

/**
 * 语音播报相关常量
 */
export const SPEECH = {
    /** 语音语言 */
    LANGUAGE: {
        CHINESE: 'zh-CN'
    },
    
    /** 语音设置默认值 */
    SETTINGS: {
        /** 音高 (范围: 0-2) */
        PITCH: 1.2,
        /** 语速 (范围: 0.1-10) */
        RATE: 1.1,
        /** 音量 (范围: 0-1) */
        VOLUME: 0.5
    },
    
    /** 语音性别 */
    VOICE_GENDER: {
        FEMALE: 'FEMALE',
        MALE: 'MALE'
    },

    /** 语音名称 */
    VOICE_NAME: {
        /** Windows系统 - Edge/Chrome浏览器 */
        WINDOWS: {
            FEMALE: {
                XIAOXIAO: {
                    EDGE_CHROME: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)',
                    CHROME_OLD: 'Microsoft Xiaoxiao - Chinese (Mainland)',
                    EDGE_OLD: 'Microsoft Xiaoxiao Desktop - Chinese (Mainland)'
                },
                HUIHUI: 'Microsoft Huihui Desktop - Chinese (Simplified, PRC)'
            },
            MALE: {
                YUNYANG: {
                    EDGE_CHROME: 'Microsoft Yunyang Online (Natural) - Chinese (Mainland)',
                    CHROME_OLD: 'Microsoft Yunyang - Chinese (Mainland)',
                    EDGE_OLD: 'Microsoft Yunyang Desktop - Chinese (Mainland)'
                },
                KANGKANG: 'Microsoft Kangkang - Chinese (Simplified, PRC)'
            }
        },
        /** MacOS系统 */
        MACOS: {
            FEMALE: {
                GOOGLE: 'Google 普通话（中国大陆）',
                TINGTING: 'Ting-Ting'
            },
            MALE: {
                GOOGLE_MALE: 'Google 普通话（男声）',
                LIXIAO: 'Li-Xiao'
            }
        },
        /** 备选方案关键词 */
        FALLBACK: {
            MICROSOFT: 'Microsoft',
            FEMALE_VOICES: ['Xiaoxiao', 'Huihui', 'Ting-Ting'],
            MALE_VOICES: ['Yunyang', 'Kangkang', 'Li-Xiao'],
            GOOGLE_ZH: '普通话',
            CHINESE: 'Chinese',
            ZH: 'zh'
        }
    },

    /** 语音优先级顺序（按性别分类）*/
    VOICE_PRIORITY: {
        FEMALE: [
            'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)',
            'Microsoft Xiaoxiao - Chinese (Mainland)',
            'Microsoft Xiaoxiao Desktop - Chinese (Mainland)',
            'Microsoft Huihui Desktop - Chinese (Simplified, PRC)',
            'Google 普通话（中国大陆）',
            'Ting-Ting'
        ],
        MALE: [
            'Microsoft Yunyang Online (Natural) - Chinese (Mainland)',
            'Microsoft Yunyang - Chinese (Mainland)',
            'Microsoft Yunyang Desktop - Chinese (Mainland)',
            'Microsoft Kangkang - Chinese (Simplified, PRC)',
            'Google 普通话（男声）',
            'Li-Xiao'
        ]
    }
}; 

/**
 * 日志相关常量
 */
export const LOG = {
    // 日志级别
    LEVEL: {
        DEBUG: 'debug',
        INFO: 'info',
        WARN: 'warn',
        ERROR: 'error'
    },
    // 日志前缀
    PREFIX: '[抖音关注直播助手]',
    // 是否开启调试模式
    DEBUG: true
}; 

/**
 * 许可证 / PRO 相关常量
 */
export const LICENSE = {
    // 客服微信号（半自动收款：用户付款后联系你领取密钥）
    CONTACT_WECHAT: 'cxjingxuan',

    // 购买说明页（可选，留空则只显示微信）。阶段二可换成爱发电商品链接
    BUY_URL: '',

    // 阶段二：许可证服务器地址（阶段一离线，留空）
    SERVER: '',

    // 价格档位（仅用于权益对比页展示，真实金额以收款为准）
    PRICING: {
        month:    { label: '月付',     price: '¥12.9', note: '尝鲜，随时停' },
        year:     { label: '年付',     price: '¥98',   note: '相当于 6.3 折', best: true },
        lifetime: { label: '永久买断', price: '¥258',  note: '一次付清，终身更新' }
    },

    // 阶段二联网续期：Token 过期后断网宽限期（30 天）
    GRACE_PERIOD: 30 * 24 * 3600 * 1000,
};

/**
 * Toast提示相关常量
 */
export const TOAST = {
    // 提示类型
    TYPE: {
        INFO: 'info',
        SUCCESS: 'success',
        WARNING: 'warning',
        ERROR: 'error'
    },
    // 显示时长（毫秒）
    DURATION: {
        DEFAULT: 2000,
        SHORT: 1500,
        LONG: 3000
    },
    // 样式相关
    STYLE: {
        // z-index确保显示在最上层
        Z_INDEX: 20001,
        // 背景色（rgba格式）
        BACKGROUND: {
            INFO: {
                LIGHT: 'rgba(0, 0, 0, 0.8)',
                DARK: 'rgba(255, 255, 255, 0.8)'
            },
            SUCCESS: {
                LIGHT: 'rgba(40, 167, 69, 0.9)',
                DARK: 'rgba(40, 167, 69, 0.9)'
            },
            WARNING: {
                LIGHT: 'rgba(255, 193, 7, 0.9)',
                DARK: 'rgba(255, 193, 7, 0.9)'
            },
            ERROR: {
                LIGHT: 'rgba(220, 53, 69, 0.9)',
                DARK: 'rgba(220, 53, 69, 0.9)'
            }
        },
        // 文字颜色
        TEXT: {
            LIGHT: '#FFFFFF',
            DARK: '#000000'
        }
    },
    // 动画相关
    ANIMATION: {
        FADE_DURATION: 300,  // 淡入淡出动画时长（毫秒）
        SHOW_DURATION: 2000  // 显示持续时长（毫秒）
    }
}; 