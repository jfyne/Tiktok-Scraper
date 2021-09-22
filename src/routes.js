const Apify = require('apify');

const { utils: { log } } = Apify;

exports.handleList = async ({ request, page }, requestQueue, maxResultsPerPage) => {
    // Wait for the network to settle, initially there will be 36 videos loaded. There
    // are more with a scroll event - not implemented yet.
    await page.waitForNetworkIdle({
        idleTime: 2000
    });
    // video-feed list
    let videoUrls = await page.evaluate(() => {
        const result = [];
        [...document.querySelectorAll('main .video-feed-item')].map((video) => {
            result.push(video.querySelector('a')?.getAttribute('href'));
        });
        return result;
    });
    log.info(`[SEARCH VIDEOS]: Found ${videoUrls.length} videos.`)
    if (maxResultsPerPage !== undefined && maxResultsPerPage !== 0) {
        videoUrls = videoUrls.splice(0, maxResultsPerPage);
    }
    log.info(`[SEARCH VIDEOS]: Adding ${videoUrls.length} videos to queue.`)

    if (request.url.includes('tag')) {
        // hashtag url
        const header = await page.evaluate(() => {
            return {
                searchHashtag: document.querySelector('header .share-title')
                    .innerText
                    .substr(1),
                numberOfViewsOnHashtag: document.querySelector('header [title="views"]')
                    .innerText
                    .split(' ')[0],
            };
        });
        for (const videoUrl of videoUrls) {
            const userUrl = videoUrl.match(/.*\/video/)[0] || null
            if (userUrl) {
                await requestQueue.addRequest({
                    url: userUrl.substr(0, (userUrl.length - 6)),
                    userData: {
                        label: 'USER',
                        header,
                        videoUrl,
                    },
                    uniqueKey: videoUrl.match(/[0-9]+/)[0],
                });
            }else{
                throw new Error('User url was not found in video url.');
            }
        }
    } else {
        // user url
        const userInfo = await getUserInfo(page, request.url);

        for (const videoUrl of videoUrls) {
            await requestQueue.addRequest({
                url: videoUrl,
                userData: {
                    label: 'VIDEO',
                    userInfo,
                },
            });
        }
    }
};

exports.handleUser = async ({ request, page }, requestQueue) => {
    const userInfo = await getUserInfo(page, request.url);

    await requestQueue.addRequest({
        url: request.userData.videoUrl,
        userData: {
            label: 'VIDEO',
            header: request.userData.header,
            userInfo,
        },
    }, {forefront: true});
};

exports.handleVideo = async ({ request, page }) => {
    let output = await page.evaluate((url, userInfo) => {
        const nicknameAndDate = document.querySelector('.feed-item-content .author-nickname').innerText.split(' · ');
        const hashtags = [];
        [...document.querySelector('.feed-item-content .tt-video-meta-caption').querySelectorAll('a')]
            .map((hashtag) => {
                hashtags.push({
                    hashtag: hashtag.innerText.substr(1).trim(),
                    url: `https://www.tiktok.com${hashtag.getAttribute('href')}`,
                });
            });
        const video = document.querySelector('.feed-item-content .item-video-container video');

        return {
            ...userInfo,
            userImageUrl: document.querySelector('.video-detail .user-avatar img').getAttribute('src'),
            userName: document.querySelector('.feed-item-content .author-uniqueId').innerText,
            userNickname: nicknameAndDate[0] || null,
            uploadDate: nicknameAndDate[1] || null,
            caption: document.querySelector('.feed-item-content .tt-video-meta-caption').querySelector('strong').innerText.trim(),
            hashtags,
            music: document.querySelector('.feed-item-content .tt-video-music').innerText,
            videoUrlOnTiktok: url,
            videoId: url.match(/[0-9]+/)[0],
            userId: video.getAttribute('authorid'),
            videoUrl: video.getAttribute('src'),
            likes: document.querySelector('.feed-item-content .item-video-container [title="like"]').innerText,
            comments: document.querySelector('.feed-item-content .item-video-container [title="comment"]').innerText,
            shares: document.querySelector('.feed-item-content .item-video-container [title="share"]').innerText,
            scrapedAt: new Date().toISOString(),
        };
    }, request.url, request.userData.userInfo);

    //Add header if it was a tag search
    if (request.userData.header){
        output = {
            ...request.userData.header,
            ...output,
        }
    }

    await Apify.pushData(output);
};

const getUserInfo = async (page, url) => {
    return await page.evaluate((url) => {
        const shareLinks = [];
        if (document.querySelector('.share-links')) {
            [...document.querySelector('.share-links')
                .querySelectorAll('a')]
                .map((link) => {
                    shareLinks.push(link.innerText);
                });
        }

        return {
            userUrl: url,
            following: document.querySelector('.count-infos [title="Following"]').innerText,
            followers: document.querySelector('.count-infos [title="Followers"]').innerText,
            userTotalLikes: document.querySelector('.count-infos [title="Likes"]').innerText,
            userDescription: document.querySelector('.share-desc').innerText,
            userShareLinks: shareLinks,
        };
    }, url);
};
