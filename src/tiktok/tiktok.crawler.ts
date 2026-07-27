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

  public async extract(): Promise<RawTikTokData> {
    logger.info(`Extracting TikTok data from: ${this.currentUrl}`);
    
    await this.page.waitForLoadState('domcontentloaded');
    await this.humanDelay(2500, 4000);

    // Scroll down to load profile header & videos
    await this.smoothScroll(3, 400);
    await this.humanDelay(1500, 2500);

    const extracted = await this.page.evaluate((limit) => {
      // Extract from meta tags as robust fallback
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

      // Username extraction from URL
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      const usernamePart = pathParts.find((p) => p.startsWith('@'));
      const username = usernamePart ? usernamePart.replace('@', '') : null;

      // Extract Followers & Likes from page or meta description
      // Meta desc often contains: "Watch the latest videos from Name (@user). 10.5K Followers. 500K Likes."
      const followersMatch = ogDesc.match(/([\d.,KkMm]+)\s*Followers/i) || ogDesc.match(/([\d.,KkMm]+)\s*Seguidores/i);
      const likesMatch = ogDesc.match(/([\d.,KkMm]+)\s*Likes/i) || ogDesc.match(/([\d.,KkMm]+)\s*Me gusta/i);

      // DOM selectors for Name & Bio
      const nameElem = document.querySelector('h1[data-e2e="user-title"], h2[data-e2e="user-subtitle"], [data-e2e="user-title"]');
      const bioElem = document.querySelector('h2[data-e2e="user-bio"], [data-e2e="user-bio"]');
      const linkElem = document.querySelector('a[data-e2e="user-link"]');

      // Video items from profile video grid
      const videoNodes = Array.from(document.querySelectorAll('div[data-e2e="user-post-item"], a[href*="/video/"]'));
      const videos: TikTokVideo[] = [];

      videoNodes.slice(0, limit).forEach((node) => {
        const aElem = node.tagName.toLowerCase() === 'a' ? node : node.querySelector('a[href*="/video/"]');
        const href = aElem ? aElem.getAttribute('href') || '' : '';
        
        // Views count overlay
        const viewsElem = node.querySelector('[data-e2e="video-views"], span');
        const viewsText = viewsElem ? viewsElem.textContent?.trim() : null;

        // Image or text alt
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

    // Process hashtags across extracted video descriptions
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
