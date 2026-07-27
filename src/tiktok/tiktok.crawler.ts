import { Page } from 'playwright';
import { BaseCrawler } from '../core/base-crawler';
import { NormalizedCompetitorData } from '../core/interfaces';
import { logger } from '../core/logger';
import {
  cleanText,
  extractEmail,
  extractHashtags,
  extractPhone,
  parseNumber,
} from '../utils/helpers';

export interface TikTokVideo {
  description?: string;
  hashtags?: string[];
  date?: string;
  views?: number | string;
  likes?: number | string;
  commentsCount?: number | string;
  url?: string;
}

export interface RawTikTokData {
  url: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  followers: number | null;
  likesCount: number | null;
  links: string[];
  recentVideos: TikTokVideo[];
  scrapedAt: string;
}

export class TikTokCrawler extends BaseCrawler {
  private maxVideos: number;

  constructor(page: Page, maxVideos: number = 12) {
    super(page);
    this.maxVideos = maxVideos;
  }

  protected getPlatformName(): string {
    return 'TikTok';
  }

  /**
   * Searches TikTok across queries/endpoints.
   * Immediately cuts off query loop once 10 competitor URLs are collected.
   */
  public override async search(queries: string[], maxResults: number = 10): Promise<string[]> {
    const discoveredUrls: Set<string> = new Set();
    const limit = Math.min(maxResults, 10);

    logger.info(`[TikTok Search] Starting discovery (Target Limit: ${limit})`);

    for (const query of queries) {
      if (discoveredUrls.size >= limit) {
        logger.info(`[TikTok Search] Target limit of ${limit} reached. Cutting off query loop.`);
        break;
      }

      const endpoints = [
        `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`,
        `https://www.tiktok.com/search/user?q=${encodeURIComponent(query)}`,
      ];

      for (const searchUrl of endpoints) {
        if (discoveredUrls.size >= limit) break;
        logger.info(`[TikTok Search] Query: "${query}" -> ${searchUrl}`);

        try {
          await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await this.humanDelay(2000, 3500);

          let scrollAttempts = 0;
          const maxScrolls = 4;

          while (discoveredUrls.size < limit && scrollAttempts < maxScrolls) {
            await this.smoothScroll(4, 600);
            await this.humanDelay(1200, 2000);

            const foundLinks = await this.page.evaluate(() => {
              const anchors = Array.from(document.querySelectorAll('a[href*="/video/"], a[href*="/@"]'));
              const urls: string[] = [];
              anchors.forEach((a) => {
                const href = a.getAttribute('href') || '';
                if (href.startsWith('http')) {
                  urls.push(href);
                } else if (href.startsWith('/') && href.length > 2) {
                  urls.push(`https://www.tiktok.com${href}`);
                }
              });
              return urls;
            });

            foundLinks.forEach((url) => {
              if (discoveredUrls.size < limit && (url.includes('/video/') || url.includes('/@'))) {
                const clean = url.split('?')[0];
                if (!clean.endsWith('tiktok.com/@') && !clean.endsWith('tiktok.com/')) {
                  discoveredUrls.add(clean);
                }
              }
            });

            logger.info(`[TikTok Search] Total collected: ${discoveredUrls.size}/${limit}`);
            scrollAttempts++;
          }
        } catch (err: any) {
          logger.warn(`[TikTok Search] Error querying ${searchUrl}: ${err.message}`);
        }
      }
    }

    const result = Array.from(discoveredUrls).slice(0, limit);
    logger.info(`[TikTok Search] Final discovered competitor URLs: ${result.length}/${limit}`);
    return result;
  }

  public async extract(): Promise<RawTikTokData> {
    logger.info(`Extracting TikTok data from: ${this.currentUrl}`);
    
    await this.page.waitForLoadState('domcontentloaded');
    await this.humanDelay(2500, 4000);

    await this.smoothScroll(3, 400);
    await this.humanDelay(1500, 2500);

    const extracted = await this.page.evaluate((limit) => {
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

      const pathParts = window.location.pathname.split('/').filter(Boolean);
      const usernamePart = pathParts.find((p) => p.startsWith('@'));
      const username = usernamePart ? usernamePart.replace('@', '') : null;

      const followersMatch = ogDesc.match(/([\d.,KkMm]+)\s*Followers/i) || ogDesc.match(/([\d.,KkMm]+)\s*Seguidores/i);
      const likesMatch = ogDesc.match(/([\d.,KkMm]+)\s*Likes/i) || ogDesc.match(/([\d.,KkMm]+)\s*Me gusta/i);

      const nameElem = document.querySelector('h1[data-e2e="user-title"], h2[data-e2e="user-subtitle"], [data-e2e="user-title"]');
      const bioElem = document.querySelector('h2[data-e2e="user-bio"], [data-e2e="user-bio"]');
      const linkElem = document.querySelector('a[data-e2e="user-link"]');

      const videoNodes = Array.from(document.querySelectorAll('div[data-e2e="user-post-item"], a[href*="/video/"]'));
      const videos: TikTokVideo[] = [];

      videoNodes.slice(0, limit).forEach((node) => {
        const aElem = node.tagName.toLowerCase() === 'a' ? node : node.querySelector('a[href*="/video/"]');
        const href = aElem ? aElem.getAttribute('href') || '' : '';
        
        const viewsElem = node.querySelector('[data-e2e="video-views"], span');
        const viewsText = viewsElem ? viewsElem.textContent?.trim() : null;

        const img = node.querySelector('img');
        const desc = img ? img.getAttribute('alt') || '' : '';

        videos.push({
          description: desc,
          views: viewsText || undefined,
          url: href.startsWith('http') ? href : `https://www.tiktok.com${href}`,
        });
      });

      return {
        ogTitle,
        ogDesc,
        username,
        name: nameElem ? nameElem.textContent?.trim() : ogTitle,
        bio: bioElem ? bioElem.textContent?.trim() : ogDesc,
        followersStr: followersMatch ? followersMatch[1] : null,
        likesStr: likesMatch ? likesMatch[1] : null,
        link: linkElem ? linkElem.getAttribute('href') : null,
        videos,
      };
    }, this.maxVideos);

    extracted.videos.forEach((video) => {
      if (video.description) {
        video.hashtags = extractHashtags(video.description);
      }
    });

    return {
      url: this.currentUrl,
      name: cleanText(extracted.name),
      username: extracted.username,
      bio: cleanText(extracted.bio),
      followers: parseNumber(extracted.followersStr),
      likesCount: parseNumber(extracted.likesStr),
      links: extracted.link ? [extracted.link] : [],
      recentVideos: extracted.videos,
      scrapedAt: new Date().toISOString(),
    };
  }

  public normalize(raw: RawTikTokData): NormalizedCompetitorData {
    const fullText = (raw.bio || '') + ' ' + raw.recentVideos.map((v) => v.description || '').join(' ');
    const hashtags = extractHashtags(fullText);
    const phone = extractPhone(fullText);
    const email = extractEmail(fullText);

    return {
      source: 'tiktok',
      url: raw.url,
      name: raw.name,
      username: raw.username,
      price: null,
      currency: null,
      rating: null,
      reviews: raw.likesCount,
      followers: raw.followers,
      location: null,
      phone: phone,
      email: email,
      website: raw.links.length > 0 ? raw.links[0] : null,
      description: raw.bio,
      amenities: [],
      hashtags: hashtags,
      posts: raw.recentVideos.map((v) => ({
        text: v.description,
        hashtags: v.hashtags,
        views: v.views,
        type: 'Video',
      })),
      comments: [],
      images: [],
      scrapedAt: raw.scrapedAt,
    };
  }
}
