const Apify = require('apify');
const { handleList, handleVideo, handleUser } = require('./routes');
const { proxyConfiguration } = require('./proxyValidation');

const { utils: { log } } = Apify;

Apify.main(async () => {
    // TODO: maxItems, extendedOutputFunction
    const input = await Apify.getInput();
    const { startURLs, hashtags, maxResultsPerPage } = input;
    if (!startURLs && !hashtags) {
        throw new Error('Input must contain startURL or hashtag.');
    }

    const proxyConfig = await proxyConfiguration({
        proxyConfig: input.proxyConfiguration,
    });

    let startingUrls = [];
    if (startURLs) {
        startingUrls = startURLs;
    }
    const requestList = await Apify.openRequestList('start-urls', startingUrls);
    const requestQueue = await Apify.openRequestQueue();
    if (hashtags) {
        for (const hashtag of hashtags) {
            // remove all white spaces from hashtag
            hashtag.replaceAll(/\s/g, '');
            await requestQueue.addRequest({
                url: `https://www.tiktok.com/tag/${hashtag}`,
            });
        }
    }

    const crawler = new Apify.PuppeteerCrawler({
        maxRequestRetries: 10,
        requestList,
        requestQueue,
        proxyConfiguration: proxyConfig,
        maxConcurrency: 30,
        useSessionPool: true,
        persistCookiesPerSession: true,
        launchContext: {
            useChrome: true,
            stealth: true,
        },
        handlePageFunction: async (context) => {
            const { url, userData: { label } } = context.request;
            log.info(`${context.response.status()}|${label}|${url}`);

            const title = await context.page.$eval('title', (titl) => titl.innerText.trim());
            if (title.includes('Something went wrong')
                || title.includes('Robot Check')
                || title.includes('verify')) {
                // retire the session
                context.session.retire();
                throw new Error(`${url} was blocked and needs to retry.`);
            }
            // If the page is not found do nothing.
            if (context.response.status() === 404) {
                log.info(`Stopping with not found --- ${context.response.status()} - ${url}`);
                return;
            }
            switch (label) {
                case 'USER':
                    return handleUser(context, requestQueue);
                case 'VIDEO':
                    return handleVideo(context);
                default:
                    return handleList(context, requestQueue, maxResultsPerPage);
            }
        },
        handleFailedRequestFunction: async (context) => {
            log.error(`Request failed too many times --- ${context.request.url}`);
        },
    });

    log.info('Starting the crawl.');
    await crawler.run();
    log.info('Crawl finished.');
});
