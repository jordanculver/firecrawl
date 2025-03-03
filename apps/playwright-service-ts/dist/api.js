"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const playwright_1 = require("playwright");
const dotenv_1 = __importDefault(require("dotenv"));
const get_error_1 = require("./helpers/get_error");
const fs_1 = require("fs");
const headersConfig = JSON.parse((0, fs_1.readFileSync)('./headers_config.json', 'utf8'));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3003;
app.use(body_parser_1.default.json());
const BLOCK_MEDIA = (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';
const PROXY_SERVER = process.env.PROXY_SERVER || null;
const PROXY_USERNAME = process.env.PROXY_USERNAME || null;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || null;
const AD_SERVING_DOMAINS = [
    'doubleclick.net',
    'adservice.google.com',
    'googlesyndication.com',
    'googletagservices.com',
    'googletagmanager.com',
    'google-analytics.com',
    'adsystem.com',
    'adservice.com',
    'adnxs.com',
    'ads-twitter.com',
    'facebook.net',
    'fbcdn.net',
    'amazon-adsystem.com'
];
let browser;
let context;
const initializeBrowser = () => __awaiter(void 0, void 0, void 0, function* () {
    browser = yield playwright_1.chromium.launch({
        headless: true,
        args: [
            '--headless',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    });
    // const userAgent = new UserAgent().toString();
    const viewport = { width: 1280, height: 800 };
    const contextOptions = {
        // userAgent,
        viewport,
    };
    if (PROXY_SERVER && PROXY_USERNAME && PROXY_PASSWORD) {
        contextOptions.proxy = {
            server: PROXY_SERVER,
            username: PROXY_USERNAME,
            password: PROXY_PASSWORD,
        };
    }
    else if (PROXY_SERVER) {
        contextOptions.proxy = {
            server: PROXY_SERVER,
        };
    }
    context = yield browser.newContext(contextOptions);
    if (BLOCK_MEDIA) {
        yield context.route('**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm}', (route, request) => __awaiter(void 0, void 0, void 0, function* () {
            yield route.abort();
        }));
    }
    // Intercept all requests to avoid loading ads
    yield context.route('**/*', (route, request) => {
        const requestUrl = new URL(request.url());
        const hostname = requestUrl.hostname;
        if (AD_SERVING_DOMAINS.some(domain => hostname.includes(domain))) {
            console.log(hostname);
            return route.abort();
        }
        return route.continue();
    });
});
const shutdownBrowser = () => __awaiter(void 0, void 0, void 0, function* () {
    if (context) {
        yield context.close();
    }
    if (browser) {
        yield browser.close();
    }
});
const isValidUrl = (urlString) => {
    try {
        new URL(urlString);
        return true;
    }
    catch (_) {
        return false;
    }
};
const scrapePage = (page, url, waitUntil, waitAfterLoad, timeout, checkSelector) => __awaiter(void 0, void 0, void 0, function* () {
    console.log(`Navigating to ${url} with waitUntil: ${waitUntil} and timeout: ${timeout}ms`);
    const response = yield page.goto(url, { waitUntil, timeout });
    if (waitAfterLoad > 0) {
        yield page.waitForTimeout(waitAfterLoad);
    }
    if (checkSelector) {
        try {
            yield page.waitForSelector(checkSelector, { timeout });
        }
        catch (error) {
            throw new Error('Required selector not found');
        }
    }
    let headers = null, content = yield page.content();
    if (response) {
        headers = yield response.allHeaders();
        const ct = Object.entries(headers).find(x => x[0].toLowerCase() === "content-type");
        if (ct && (ct[1].includes("application/json") || ct[1].includes("text/plain"))) {
            content = (yield response.body()).toString("utf8"); // TODO: determine real encoding
        }
    }
    return {
        content,
        status: response ? response.status() : null,
        headers,
    };
});
app.post('/scrape', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { url, wait_after_load = 0, timeout = 15000, headers, check_selector } = req.body;
    console.log(`================= Scrape Request =================`);
    console.log(`URL: ${url}`);
    console.log(`Wait After Load: ${wait_after_load}`);
    console.log(`Timeout: ${timeout}`);
    console.log(`Headers: ${headers ? JSON.stringify(headers) : 'None'}`);
    console.log(`Check Selector: ${check_selector ? check_selector : 'None'}`);
    console.log(`==================================================`);
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    if (!isValidUrl(url)) {
        return res.status(400).json({ error: 'Invalid URL' });
    }
    if (!PROXY_SERVER) {
        console.warn('⚠️ WARNING: No proxy server provided. Your IP address may be blocked.');
    }
    if (!browser || !context) {
        yield initializeBrowser();
    }
    const page = yield context.newPage();
    yield page.setExtraHTTPHeaders({
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "en-US,en;q=0.9",
        "sec-ch-ua": "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"",
        "sec-ch-ua-full-version-list": "\"Google Chrome\";v=\"131.0.6778.264\", \"Chromium\";v=\"131.0.6778.264\", \"Not_A Brand\";v=\"24.0.0.0\"",
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    });
    // Set headers if provided
    if (headers) {
        yield page.setExtraHTTPHeaders(headers);
    }
    let result;
    try {
        // Strategy 1: Normal
        console.log('Attempting strategy 1: Normal load');
        result = yield scrapePage(page, url, 'load', wait_after_load, timeout, check_selector);
    }
    catch (error) {
        console.log('Strategy 1 failed, attempting strategy 2: Wait until networkidle');
        try {
            // Strategy 2: Wait until networkidle
            result = yield scrapePage(page, url, 'networkidle', wait_after_load, timeout, check_selector);
        }
        catch (finalError) {
            yield page.close();
            return res.status(500).json({ error: 'An error occurred while fetching the page.' });
        }
    }
    const pageError = result.status !== 200 ? (0, get_error_1.getError)(result.status) : undefined;
    if (!pageError) {
        console.log(`✅ Scrape successful!`);
    }
    else {
        console.log(`🚨 Scrape failed with status code: ${result.status} ${pageError}`);
    }
    yield page.close();
    res.json(Object.assign({ content: result.content, pageStatusCode: result.status }, (pageError && { pageError })));
}));
app.listen(port, () => {
    initializeBrowser().then(() => {
        console.log(`Server is running on port ${port}`);
    });
});
process.on('SIGINT', () => {
    shutdownBrowser().then(() => {
        console.log('Browser closed');
        process.exit(0);
    });
});
