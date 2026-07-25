/**
 * 通用工具模块
 */

import { Logger } from './logger.js';
import { NETWORK, LIVE_QUALITY, SPEECH } from './constants.js';

/**
 * DOM操作工具类
 */
const DOMUtils = {
    /**
     * 查找单个元素
     * @param {string} selector - CSS选择器
     * @param {Element} [context=document] - 查找上下文
     * @returns {Element|null}
     */
    findElement(selector, context = document) {
        return context.querySelector(selector);
    },

    /**
     * 查找多个元素
     * @param {string} selector - CSS选择器
     * @param {Element} [context=document] - 查找上下文
     * @returns {Element[]}
     */
    findElements(selector, context = document) {
        return Array.from(context.querySelectorAll(selector));
    },

    /**
     * 创建元素
     * @param {string} tag - 要创建的元素的标签名
     * @param {Object} [options={}] - 创建元素时的选项对象
     * @param {string} [options.className] - 元素的类名
     * @param {string} [options.innerHTML] - 元素的内部HTML内容
     * @param {Object} [options.styles] - 元素的样式对象
     * @param {Object} [options.attributes] - 元素的属性对象
     * @returns {Element} 创建的元素
     */
    createElement(tag, options = {}) {
        const element = document.createElement(tag);
        
        if (options.className) {
            element.className = options.className;
        }
        
        if (options.innerHTML) {
            element.innerHTML = options.innerHTML;
        }
        
        if (options.styles) {
            Object.assign(element.style, options.styles);
        }
        
        if (options.attributes) {
            Object.entries(options.attributes).forEach(([key, value]) => {
                element.setAttribute(key, value);
            });
        }
        
        return element;
    },

    /**
     * 防抖函数
     * @param {Function} func 要执行的函数
     * @param {number} wait 等待时间（毫秒）
     * @returns {Function} 防抖后的函数
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

/**
 * 样式工具类
 */
const StyleUtils = {
    /**
     * 检查是否为暗色模式
     * @returns {boolean}
     */
    isDarkMode() {
        return document.documentElement.getAttribute('dark') === 'true';
    },

    /**
     * 获取主题相关颜色
     * @param {Object} options - 颜色选项
     * @returns {string}
     */
    getThemeColor(options) {
        const isDark = this.isDarkMode();
        return isDark ? options.dark : options.light;
    },

    /**
     * 判断是否横屏（宽高比 > 1.2 视为横屏）
     * @param {number} aspect - videoWidth/videoHeight
     * @returns {boolean}
     */
    isLandscapeRatio(aspect) {
        return !!aspect && aspect > 1.2;
    },

    /**
     * 按横竖屏渲染视频：竖屏铺满(cover)；横屏完整居中(contain) + 上下用同一帧放大模糊填充。
     * 模糊层取 containerEl 当前的 background-image（封面/抓帧），不额外开第二个视频解码。
     * @param {HTMLElement} containerEl - 视频所在的卡片预览容器（position:relative）
     * @param {HTMLVideoElement} videoEl - 要渲染的视频元素
     * @param {boolean} isLandscape - 是否横屏
     */
    applyMediaOrientation(containerEl, videoEl, isLandscape) {
        videoEl.style.objectFit = isLandscape ? 'contain' : 'cover';
        // 视频必须高于模糊层：二者同为 0 时，滚回重挂会把 video 插到 blur 前，后绘的 blur 盖住画面
        videoEl.style.zIndex = '1';

        let blur = containerEl.querySelector(':scope > .dy-media-blur');
        if (isLandscape) {
            if (!blur) {
                blur = document.createElement('div');
                blur.className = 'dy-media-blur';
                Object.assign(blur.style, {
                    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
                    zIndex: '0', backgroundSize: 'cover', backgroundPosition: 'center',
                    filter: 'blur(24px)', transform: 'scale(1.15)', pointerEvents: 'none'
                });
                // 保证顺序：blur → video（同层时先插的在下）
                containerEl.insertBefore(blur, videoEl || containerEl.firstChild);
            }
            blur.style.backgroundImage = containerEl.style.backgroundImage;
        } else if (blur) {
            blur.remove();
        }
    }
};

/**
 * 事件工具类
 */
const EventUtils = {
    /**
     * 触发元素的事件
     * @param {Element} element - 目标元素
     * @param {string} eventName - 事件名称
     * @param {Object} [options={}] - 事件选项
     */
    triggerEvent(element, eventName, options = {}) {
        if (!element) return;
        
        const event = new MouseEvent(eventName, {
            bubbles: true,
            cancelable: true,
            view: window,
            ...options
        });
        
        element.dispatchEvent(event);
    }
};

/**
 * 网络工具类
 */
const NetworkUtils = {
    /**
     * 获取网络连接信息
     * @returns {Object} 包含网络类型和下行速度的对象
     */
    getNetworkInfo() {
        const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        return {
            type: connection?.effectiveType || NETWORK.TYPE._4G,
            downlink: connection?.downlink || 10
        };
    },

    /**
     * 获取适合当前网络的清晰度
     * @returns {string} 清晰度代码：'FULL_HD1'(蓝光)/'HD1'(超清)/'SD2'(高清)/'SD1'(标清)
     */
    getAppropriateQuality() {
        const { type, downlink } = this.getNetworkInfo();
        
        if (type === NETWORK.TYPE._4G && downlink > NETWORK.DOWNLINK_SPEED.FULL_HD1) {
            return LIVE_QUALITY.FULL_HD1;  // 蓝光
        } else if (type === NETWORK.TYPE._4G || downlink > NETWORK.DOWNLINK_SPEED.HD1) {
            return LIVE_QUALITY.HD1;       // 超清
        } else if (type === NETWORK.TYPE._3G || downlink > NETWORK.DOWNLINK_SPEED.SD2) {
            return LIVE_QUALITY.SD2;       // 高清
        } else {
            return LIVE_QUALITY.SD1;       // 标清
        }
    },

    /**
     * 根据清晰度获取对应的流地址
     * @param {Object} streamUrlMap - 流地址映射对象
     * @param {string} quality - 清晰度代码（FULL_HD1:蓝光/HD1:超清/SD2:高清/SD1:标清）
     * @returns {string} 对应清晰度的流地址，如果没有对应清晰度则返回可用的最高清晰度
     */
    getStreamUrlByQuality(streamUrlMap, quality) {
        if (!streamUrlMap || typeof streamUrlMap !== 'object') return null;

        // 尝试获取指定清晰度的流地址
        if (streamUrlMap[quality]) {
            return streamUrlMap[quality];
        }

        // 档不可用：先向下（更低清晰度）再向上回退，避免直接跳到蓝光吃带宽
        const order = LIVE_QUALITY.ORDER; // 高 → 低
        const idx = order.indexOf(quality);
        if (idx >= 0) {
            for (let i = idx + 1; i < order.length; i++) {
                if (streamUrlMap[order[i]]) return streamUrlMap[order[i]];
            }
            for (let i = idx - 1; i >= 0; i--) {
                if (streamUrlMap[order[i]]) return streamUrlMap[order[i]];
            }
        }

        // 未知档位：任意可用最高档
        for (const q of order) {
            if (streamUrlMap[q]) return streamUrlMap[q];
        }

        return null;
    },

    /**
     * 获取最低清晰度url 如果获取不到则向上获取
     * @param {Object} streamUrlMap - 流地址映射对象
     * @returns {string} 最低清晰度的流地址，如果没有最低清晰度则返回可用的最高清晰度
     */
    getLowestQualityUrl(streamUrlMap) {
        for (let i = LIVE_QUALITY.ORDER.length - 1; i >= 0; i--) {
            const q = LIVE_QUALITY.ORDER[i];
            if (streamUrlMap[q]) {
                return streamUrlMap[q];
            }
        }
        return null;
    }
};

/**
 * 语音播报控制类
 * 用于管理和控制文本到语音的转换和播放
 * 支持队列播放、语音设置调整、播放状态管理等功能
 */
const SpeechUtils = {
    /** 语音合成器实例 */
    synthesizer: null,
    
    /** 当前是否正在播放语音 */
    isPlaying: false,
    
    /** 待播放的文本队列 */
    messageQueue: [],
    
    /** 
     * 语音播放的基本设置
     * @property {string} lang - 语音语言，默认中文
     * @property {number} pitch - 音高，范围0-2，1为正常音高
     * @property {number} rate - 语速，范围0.1-10，1为正常语速
     * @property {number} volume - 音量，范围0-1，1为最大音量
     */
    voiceSettings: {
        lang: SPEECH.LANGUAGE.CHINESE,
        pitch: SPEECH.SETTINGS.PITCH,    // 音高稍微提高，使语音更清晰
        rate: SPEECH.SETTINGS.RATE,      // 语速稍快，提升播报效率
        volume: SPEECH.SETTINGS.VOLUME   // 音量适中，避免声音过大
    },
    
    /** 是否启用语音播报功能 */
    isEnabled: true,
    
    /** 队列播放完成时的回调函数 */
    onQueueEmptyCallback: null,
    
    /** 当前选中的语音配置 */
    selectedVoice: null,

    /**
     * 当前选择的语音性别
     */
    preferredGender: SPEECH.VOICE_GENDER.FEMALE,

    /**
     * 加载语音列表
     * @private
     * @returns {Promise<SpeechSynthesisVoice[]>} 语音列表
     */
    loadVoices() {
        return new Promise((resolve) => {
            let voices = this.synthesizer.getVoices();
            if (voices && voices.length > 0) {
                resolve(voices);
            } else {
                this.synthesizer.addEventListener('voiceschanged', () => {
                    voices = this.synthesizer.getVoices();
                    resolve(voices);
                }, { once: true }); // 只监听一次事件
            }
        });
    },

    /**
     * 设置静音（true=静音）。
     * 词条仍按原有"语音回调驱动"逻辑播放（保证显示与节奏同步），静音只是音量为 0。
     */
    setMuted(muted) {
        this.voiceMuted = !!muted;
    },

    /**
     * 初始化语音播报系统
     */
    init() {
        try {
            // 1. 初始化语音合成器
            this.synthesizer = window.speechSynthesis;
            Logger.log('初始化语音播报系统', this.synthesizer);
            
            if (!this.synthesizer) {
                Logger.error('浏览器不支持语音合成功能');
                return;
            }

            // 2. 绑定所有方法的 this 指向
            this.setupVoice = this.setupVoice.bind(this);
            this.speakText = this.speakText.bind(this);
            this.processNextMessage = this.processNextMessage.bind(this);
            this.addTextToPlayQueue = this.addTextToPlayQueue.bind(this);
            this.stopPlayback = this.stopPlayback.bind(this);
            this.detectPreferredGender = this.detectPreferredGender.bind(this);
            this.loadVoices = this.loadVoices.bind(this);

            // 3. 添加页面卸载时的清理
            window.addEventListener('beforeunload', () => {
                this.stopPlayback();
            });

            // 4. 等待语音列表加载完成后再设置语音
            this.loadVoices().then(voices => {
                if (voices && voices.length > 0) {
                    Logger.log('语音列表加载完成:', voices.length);
                    this.setupVoice();
                } else {
                    Logger.error('未找到可用的语音');
                }
            }).catch(error => {
                Logger.error('加载语音列表失败:', error);
            });

        } catch (error) {
            Logger.error('初始化语音播报系统失败:', error);
        }
    },

    /**
     * 智能识别文本内容适合使用的语音性别
     * @private
     * @param {string} text - 要分析的文本内容
     * @returns {string} 返回适合的语音性别
     */
    detectPreferredGender(text) {
        // 确保 text 是字符串类型
        if (!text || typeof text !== 'string') {
            Logger.log('无效的文本类型:', typeof text, '将使用默认性别:', this.preferredGender);
            return this.preferredGender;
        }

        // 开头称谓特征
        const femaleIndicators = ['女士', '小姐', '女神', '美女', '姐姐', '妹妹'];
        const maleIndicators = ['先生', '男士', '帅哥', '哥哥', '弟弟'];
        
        // 结尾语气词特征
        const femaleEndings = ['呢', '啦', '呀', '哦'];
        const maleEndings = ['啊', '哈', '嗯'];

        // 计算倾向性得分
        let score = 0;
        
        try {
            femaleIndicators.forEach(word => {
                if (text.includes(word)) score -= 1;
            });
            maleIndicators.forEach(word => {
                if (text.includes(word)) score += 1;
            });
            femaleEndings.forEach(ending => {
                if (text.endsWith(ending)) score -= 0.5;
            });
            maleEndings.forEach(ending => {
                if (text.endsWith(ending)) score += 0.5;
            });
        } catch (error) {
            Logger.error('文本分析失败:', error);
            return this.preferredGender;
        }

        // 根据得分决定性别
        return score > 0 ? SPEECH.VOICE_GENDER.MALE : SPEECH.VOICE_GENDER.FEMALE;
    },

    /**
     * 设置默认语音配置
     * 根据当前环境和文本内容选择最合适的语音
     * @private
     * @param {string} [text=''] - 要播放的文本内容
     */
    setupVoice(text = '') {
        try {
            Logger.log('设置默认语音配置', this.synthesizer);
            
            // 安全地获取可用语音列表
            let availableVoices = [];
            try {
                availableVoices = this.synthesizer.getVoices() || [];
            } catch (error) {
                Logger.error('获取语音列表失败:', error);
                return;
            }

            if (availableVoices.length === 0) {
                Logger.error('未找到可用的语音');
                return;
            }

            // 确定要使用的性别
            const gender = text ? this.detectPreferredGender(text) : this.preferredGender;
            const priorityList = SPEECH.VOICE_PRIORITY[gender];
            
            if (!priorityList || !Array.isArray(priorityList)) {
                Logger.error('无效的优先级列表');
                return;
            }

            // 1. 按优先级查找语音
            for (const voiceName of priorityList) {
                const voice = availableVoices.find(v => v.name === voiceName);
                if (voice) {
                    this.selectedVoice = voice;
                    Logger.log(`已选择${gender === SPEECH.VOICE_GENDER.FEMALE ? '女声' : '男声'}语音:`, voice.name);
                    return;
                }
            }

        // 2. 如果没有找到优选语音，则按关键词匹配
        const genderKeywords = gender === SPEECH.VOICE_GENDER.FEMALE 
            ? SPEECH.VOICE_NAME.FALLBACK.FEMALE_VOICES 
            : SPEECH.VOICE_NAME.FALLBACK.MALE_VOICES;

        for (const keyword of genderKeywords) {
            const voice = availableVoices.find(v => v.name.includes(keyword));
            if (voice) {
                this.selectedVoice = voice;
                Logger.log(`已选择备选${gender === SPEECH.VOICE_GENDER.FEMALE ? '女声' : '男声'}语音:`, voice.name);
                return;
            }
        }

        // 3. 如果还是没有找到对应性别的语音，尝试其他性别的语音
        const otherGenderPriorityList = SPEECH.VOICE_PRIORITY[
            gender === SPEECH.VOICE_GENDER.FEMALE ? SPEECH.VOICE_GENDER.MALE : SPEECH.VOICE_GENDER.FEMALE
        ];
        
        for (const voiceName of otherGenderPriorityList) {
            const voice = availableVoices.find(v => v.name === voiceName);
            if (voice) {
                this.selectedVoice = voice;
                Logger.log('未找到对应性别语音，使用其他性别语音:', voice.name);
                return;
            }
        }

        // 4. 最后才使用任意可用语音
        if (availableVoices.length > 0) {
            this.selectedVoice = availableVoices[0];
            Logger.log('使用默认语音:', this.selectedVoice.name);
            } else {
                Logger.error('未找到可用的语音');
            }
        } catch (error) {
            Logger.error('设置语音配置失败:', error);
        }
    },

    /**
     * 播放指定文本
     * @private
     * @param {string} text - 要播放的文本内容
     * @returns {Promise<void>} 播放完成后的Promise
     */
    speakText(text) {
        return new Promise((resolve) => {
            if (!this.synthesizer || !text || !this.isEnabled) {
                resolve();
                return;
            }

            // 根据文本内容重新选择合适的语音
            this.setupVoice(text);

            // 创建语音合成器实例
            const utterance = new SpeechSynthesisUtterance(text);
            Object.assign(utterance, this.voiceSettings);
            utterance.voice = this.selectedVoice;
            // 语音播报开关（静音法）：静音时音量置 0，但仍正常播放并触发 onend，
            // 不影响词条显示节奏与同步——只是听不见声音。
            if (this.voiceMuted) utterance.volume = 0;

            // 绑定事件处理器
            const handlePlaybackEnd = () => {
                this.isPlaying = false;
                resolve();
            };

            const handlePlaybackError = (event) => {
                // 分析错误原因
                let errorReason = '';
                if (!this.selectedVoice) {
                    errorReason = '未找到可用的语音合成声音';
                } else if (text.length > 200) {
                    errorReason = '文本内容过长';
                } else if (!navigator.onLine) {
                    errorReason = '网络连接已断开';
                } else if (event.error === 'synthesis-failed') {
                    errorReason = '语音合成失败';
                } else if (event.error === 'audio-busy') {
                    errorReason = '音频系统正忙';
                } else if (event.error === 'network') {
                    errorReason = '网络请求失败';
                } else {
                    errorReason = `未知错误: ${event.error}`;
                }

                // 忽略 interrupted 错误，因为这是预期的行为
                Logger.error(`语音播放出现错误: ${errorReason}`, {
                    error: event,
                    text: text,
                    voice: this.selectedVoice?.name
                });
                
                this.isPlaying = false;
                resolve();
            };

            utterance.onend = handlePlaybackEnd;
            utterance.onerror = handlePlaybackError;

            this.isPlaying = true;
            this.synthesizer.speak(utterance);
        });
    },

    /**
     * 处理队列中的下一条消息
     */
    async processNextMessage() {
        if (this.isPlaying || this.messageQueue.length === 0) {
            if (this.messageQueue.length === 0 && this.onQueueEmptyCallback) {
                this.onQueueEmptyCallback();
            }
            return;
        }

        const text = this.messageQueue.shift();
        await this.speakText(text);
        
        if (this.messageQueue.length > 0) {
            this.processNextMessage();
        } else if (this.onQueueEmptyCallback) {
            this.onQueueEmptyCallback();
        }
    },

    /**
     * 添加消息到播放队列
     * @param {string} text - 要播放的文本内容
     * @param {boolean} [enabled=true] - 是否启用语音播放
     * @param {Function} [onQueueEmpty=null] - 队列播放完成时的回调函数
     */
    addTextToPlayQueue(text, enabled = true, onQueueEmpty = null) {
        // 检查参数类型
        if (!text || typeof text !== 'string') {
            Logger.error('无效的文本类型:', typeof text);
            return;
        }

        this.isEnabled = enabled;
        if (!enabled) {
            this.stopPlayback();
            return;
        }
        this.onQueueEmptyCallback = onQueueEmpty;
        this.messageQueue.push(text);
        this.processNextMessage();
    },

    /**
     * 停止所有语音播放并清空队列
     */
    stopPlayback() {
        if (this.synthesizer) {
            try {
                // 如果当前没有在播放，直接清理状态
                if (!this.synthesizer.speaking && !this.synthesizer.pending) {
                    this.messageQueue = [];
                    this.isEnabled = false;
                    this.onQueueEmptyCallback = null;
                    return;
                }

                // 直接取消所有语音播放
                this.synthesizer.cancel();
                
                // 重置状态
                this.isEnabled = false;
                this.isPlaying = false;
                this.messageQueue = [];
                this.onQueueEmptyCallback = null;
            } catch (error) {
                // 忽略 interrupted 错误，因为这是预期的行为
                if (error.message !== 'interrupted') {
                    Logger.error('停止播放失败:', error);
                }
                // 确保状态被重置
                this.isPlaying = false;
                this.isEnabled = false;
                this.messageQueue = [];
                this.onQueueEmptyCallback = null;
            }
        }
    },

    /**
     * 设置偏好的语音性别
     * @param {string} gender - 语音性别 (SPEECH.VOICE_GENDER.FEMALE 或 SPEECH.VOICE_GENDER.MALE)
     */
    setPreferredGender(gender) {
        if (Object.values(SPEECH.VOICE_GENDER).includes(gender)) {
            this.preferredGender = gender;
            this.setupVoice();
        }
    }
};

/**
 * HLS工具类
 * 用于管理HLS相关的配置和功能
 */
const HLSUtils = {
    /**
     * 创建HLS实例配置
     * @param {Object} [options={}] - 额外的配置选项
     * @returns {Object} HLS配置对象
     */
    createConfig(options = {}) {
        const defaultConfig = {
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 5,
            timeout: 10000,
            manifestLoadingTimeOut: 10000,
            manifestLoadingMaxRetry: 3,
            manifestLoadingRetryDelay: 1000,
            enableSoftwareAES: true,
            recovery: {
                enabled: true,
                maxRetries: 3,
                retryDelay: 1000
            },
            maxBufferLength: 10,
            maxMaxBufferLength: 15,
            maxBufferSize: 15 * 1000 * 1000,
            highBufferWatchdogPeriod: 5,
            nudgeOffset: 0.2,
            xhrSetup: function(xhr, url) {
                xhr.setRequestHeader('Accept', '*/*');
                xhr.setRequestHeader('Accept-Language', 'zh-CN,zh;q=0.9');
            }
        };

        // 合并默认配置和额外选项
        return { ...defaultConfig, ...options };
    },

    /**
     * 创建预加载专用的HLS配置
     * @returns {Object} 预加载专用的HLS配置，降低资源消耗
     */
    createPreloadConfig() {
        return this.createConfig({
            // 预加载特定的配置
            maxBufferLength: 10,
            maxMaxBufferLength: 15,
            maxBufferSize: 15 * 1000 * 1000
        });
    },

    /**
     * 创建预览专用的HLS配置
     * @returns {Object} 预览专用的HLS配置，提高播放体验
     */
    createPreviewConfig() {
        return this.createConfig({
            // 预览特定的配置
            maxBufferLength: 30,
            maxMaxBufferLength: 30,
            maxBufferSize: 30 * 1000 * 1000
        });
    }
};

/**
 * 文本处理工具类
 * 用于处理文本中的表情符号、变体字符和繁体中文
 */
const TextUtils = {
    /**
     * 标准化文本，通过删除表情符号、变体字符和转换繁体中文来标准化文本
     * @param {string} text - 文本
     * @returns {string} 标准化后的文本
     */
    standardizeText(text) {
        if (!text) return '';

        // 1. 移除表情符号和特殊字符
        text = text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '');  // 移除 emoji
        text = text.replace(/[\u2600-\u26FF\u2700-\u27BF]/g, '');    // 移除其他特殊符号
        text = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s@]/g, '');    // 只保留中文、英文、数字、空格和@符号

        // 2. 繁体转简体映射表
        const traditionalToSimplified = {
            '說': '说', '妳': '你', '壹': '一', '貳': '二', '參': '三',
            '肆': '四', '伍': '五', '陸': '六', '柒': '七', '捌': '八',
            '玖': '九', '拾': '十', '佰': '百', '仟': '千', '萬': '万',
            '與': '与', '關': '关', '個': '个', '這': '这', '麼': '么',
            '時': '时', '從': '从', '妳': '你', '會': '会', '來': '来',
            '歲': '岁', '實': '实', '點': '点', '樣': '样', '麗': '丽',
            '對': '对', '嗎': '吗', '們': '们', '還': '还', '沒': '没',
            '謝': '谢', '愛': '爱', '過': '过', '錯': '错', '經': '经',
            '樂': '乐', '歡': '欢', '現': '现', '當': '当', '眾': '众',
            '產': '产', '樣': '样', '發': '发', '顯': '显', '燈': '灯',
            '歲': '岁', '點': '点', '號': '号', '後': '后', '華': '华',
            '國': '国', '話': '话', '實': '实', '親': '亲', '應': '应',
            '該': '该', '記': '记', '處': '处', '務': '务', '員': '员',
            '問': '问', '開': '开', '關': '关', '裡': '里', '樣': '样'
        };

        // 3. 应用繁体转简体转换
        for (const [traditional, simplified] of Object.entries(traditionalToSimplified)) {
            text = text.replace(new RegExp(traditional, 'g'), simplified);
        }

        // 4. 去除多余空格
        text = text.replace(/\s+/g, ' ').trim();

        return text;
    }
};

export { DOMUtils, StyleUtils, EventUtils, NetworkUtils, SpeechUtils, HLSUtils, TextUtils }; 