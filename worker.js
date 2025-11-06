
const API_DOMAIN = 'https://---.qweatherapi.com'; 
const API_KEY = '---'; 
const CITY_ID = '---';


// Telegram 配置 (强烈建议使用 env 获取)
const TELEGRAM_TOKEN = '---';
const CHAT_ID = '---';

const location_API_URL = `${API_DOMAIN}/geo/v2/city/lookup?location=${CITY_ID}&key=${API_KEY}`;
const WEATHER_API_URL = `${API_DOMAIN}/v7/weather/3d?location=${CITY_ID}&key=${API_KEY}`;
const WEATHER_now_API_URL = `${API_DOMAIN}/v7/weather/now?location=${CITY_ID}&key=${API_KEY}`;
const WEATHER_indices_URL = `${API_DOMAIN}/v7/indices/3d?type=3,9&location=${CITY_ID}&key=${API_KEY}`;

// ----------------------------------------------------
// 封装的函数：向 Telegram 发送消息
// ----------------------------------------------------
async function sendMessageToTelegram(message) { // 移除 env 参数，直接使用常量
    if (!TELEGRAM_TOKEN || !CHAT_ID) {
        console.error("缺少 Telegram TOKEN 或 CHAT_ID！");
        return { success: false, error: "Missing config" };
    }

    const TELEGRAM_URL = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

    const payload = {
        chat_id: CHAT_ID,
        text: message,
        // Telegram MarkdownV2 模式下，特殊字符如 '.' '-' '(' ')' 
        // 在非粗体/斜体/链接等上下文时，需要使用 \ 转义。
        parse_mode: 'MarkdownV2', 
    };

    try {
        const response = await fetch(TELEGRAM_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (response.ok) {
            console.log("Telegram 消息发送成功！");
            return { success: true };
        } else {
            const errorData = await response.json();
            console.error("Telegram API 错误:", response.status, errorData);
            return { success: false, error: errorData };
        }
    } catch (e) {
        console.error("发送到 Telegram 时发生网络错误:", e);
        return { success: false, error: e.message };
    }
}

// ----------------------------------------------------
// 🌟 核心逻辑：定时任务处理函数
// ----------------------------------------------------

/**
 * 负责获取天气数据、生成消息并发送 Telegram 的主要逻辑
 * 供 fetch 和 scheduled 方法调用
 * @returns {object} 处理结果
 */
async function processWeatherAndSend() {
    try {
        // 1. 并行发起所有 API 请求 (提高效率)
        const [apiResponse, locationResponse, apinowResponse, indices] = await Promise.all([
            fetch(WEATHER_API_URL),
            fetch(location_API_URL),
            fetch(WEATHER_now_API_URL),
            fetch(WEATHER_indices_URL)
        ]);

        // 2. 检查所有响应状态 (重要!)
        if (!apiResponse.ok || !locationResponse.ok || !apinowResponse.ok || !indices.ok) {
             throw new Error("至少一个天气 API 请求失败。");
        }

        // 3. 并行解析所有 JSON 响应
        const [weatherData, locationData, weathernowData, weatherindices] = await Promise.all([
            apiResponse.json(),
            locationResponse.json(),
            apinowResponse.json(),
            indices.json()
        ]);

        // 4. 提取所需数据
        // 确保 location 数组存在且不为空
        const cityName = locationData.location[0].name;

        // 今天 (daily[0])
        const daily0 = weatherData.daily[0];
        const temperaturemin0 = daily0.tempMin;
        const temperaturemax0 = daily0.tempMax;
        const daydescription0 = daily0.textDay;
        const nightdescription0 = daily0.textNight;
        const indicesB = weatherindices.daily[1].text; // 感冒指数
        const indicesA = weatherindices.daily[0].text; // 穿衣指数
        
        // 明天 (daily[1])
        const daily1 = weatherData.daily[1];
        const temperaturemin1 = daily1.tempMin;
        const temperaturemax1 = daily1.tempMax;
        const daydescription1 = daily1.textDay;
        const nightdescription1 = daily1.textNight;
        const indicesD = weatherindices.daily[3].text; // 感冒指数
        const indicesC = weatherindices.daily[2].text; // 穿衣指数

        // 现在天气
        const nowtemp = weathernowData.now.temp;
        const nowweather = weathernowData.now.text;
        const nowdescription = `${nowweather} ${nowtemp}°C`;

        // 5. 构造 Telegram 消息 (使用 \- 转义中间的连字符)
        const telegramMessage = 
`🏘️*${cityName}*🏘️

❤️现在${nowdescription},今天白天${daydescription0},夜晚🌆${nightdescription0},最低温${temperaturemin0}°C,最高温${temperaturemax0}°C

${indicesB}

🎐${indicesA}

☁️⛅⛈️🌤️🌥️🌦️🌧️🌨️🌩️🌪️

💠明天白天${daydescription1},夜晚🌆${nightdescription1},${temperaturemin1}\\-${temperaturemax1}°C 💠

${indicesD}

🎐${indicesC}`;
        
        // 6. 发送 Telegram 消息
        const telegramResult = await sendMessageToTelegram(telegramMessage);

        return {
            status: 'success',
            city: cityName,
            telegram_sent: telegramResult.success,
            telegram_error: telegramResult.error || null,
            message: telegramMessage
        };

    } catch (error) {
        console.error('Workers 内部错误:', error);
        return {
            status: 'error',
            message: `Workers 内部错误: ${error.message}`,
            telegram_sent: false
        };
    }
}


/**
 * 调度事件的处理函数 (Cron Trigger 入口)
 */
async function handleScheduled(event, env, ctx) {
    // 调度模式下，我们只需要执行核心逻辑
    // 使用 ctx.waitUntil 确保异步的 Telegram 发送完成
    ctx.waitUntil(processWeatherAndSend());
}

/**
 * HTTP 请求的处理函数 (fetch 入口)
 */
async function handleRequest(request, env, ctx) {
    // HTTP 模式下，执行核心逻辑并返回 JSON 响应给客户端
    const result = await processWeatherAndSend();

    return new Response(JSON.stringify(result), {
        status: result.status === 'success' ? 200 : 500,
        headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*' 
        }
    });
}


// ----------------------------------------------------
// 🌟 导出 Worker 模块 (同时支持 fetch 和 scheduled)
// ----------------------------------------------------
export default {
    async fetch(request, env, ctx) {
        return handleRequest(request, env, ctx);
    },
    async scheduled(event, env, ctx) {
        return handleScheduled(event, env, ctx);
    },
};