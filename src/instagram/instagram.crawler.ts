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

export interface InstagramPost {
  text?: string;
  hashtags?: string[];
  date?: string;
  likes?: number | string;
  comments?: number | string;
  type?: string;
  imgUrl?: string;
}

export interface RawInstagramData {
  url: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  totalPosts: number | null;
  externalLinks: string[];
  frequentHashtags: string[];
  posts: InstagramPost[];
  scrapedAt: string;
}

export class InstagramCrawler extends BaseCrawler {
  private maxPosts: number;

  constructor(page: Page, maxPosts: number = 12) {
    super(page);
    this.maxPosts = maxPosts;
  }

  protected getPlatformName(): string {
    return 'Instagram';
  }

  /**
   * Searches Instagram across query variations/hashtags.
   * Immediately cuts off query loop once 10 competitor profile URLs are collected.
   */
  public override async search(queries: string[], maxResults: number = 10): Promise<string[]> {
    const discoveredUrls: Set<string> = new Set();
    const limit = Math.min(maxResults, 10);

    logger.info(`[Instagram Search] Starting discovery (Target Limit: ${limit})`);

    const endpoints: string[] = [];
    for (const q of queries) {
      endpoints.push(`https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(q)}`);
    }

    endpoints.push('https://www.instagram.com/explore/tags/santarosadequives/');
    endpoints.push('https://www.instagram.com/explore/tags/casadecampoquives/');

    for (const searchUrl of endpoints) {
      if (discoveredUrls.size >= limit) {
        logger.info(`[Instagram Search] Target limit of ${limit} reached. Cutting off query loop.`);
        break;
      }
      logger.info(`[Instagram Search] Query: ${searchUrl}`);

      try {
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await this.humanDelay(2000, 3500);

        let scrollAttempts = 0;
        const maxScrolls = 3;

        while (discoveredUrls.size < limit && scrollAttempts < maxScrolls) {
          await this.smoothScroll(4, 600);
          await this.humanDelay(1200, 2000);

          const foundLinks = await this.page.evaluate(() => {
            const anchors = Array.from(document.querySelectorAll('a[href*="/"]'));
            const urls: string[] = [];
            anchors.forEach((a) => {
              const href = a.getAttribute('href') || '';
              if (href.startsWith('/') && !href.includes('/explore/') && !href.includes('/reels/') && !href.includes('/direct/')) {
                const parts = href.split('/').filter(Boolean);
                if (parts.length === 1 && !['about', 'legal', 'privacy', 'help', 'api', 'accounts'].includes(parts[0])) {
                  urls.push(`https://www.instagram.com/${parts[0]}`);
                }
              }
            });
            return urls;
          });

          foundLinks.forEach((url) => {
            if (discoveredUrls.size < limit) {
              discoveredUrls.add(url);
            }
          });

          logger.info(`[Instagram Search] Total collected: ${discoveredUrls.size}/${limit}`);
          scrollAttempts++;
        }
      } catch (err: any) {
        logger.warn(`[Instagram Search] Error querying ${searchUrl}: ${err.message}`);
      }
    }

    const result = Array.from(discoveredUrls).slice(0, limit);
    logger.info(`[Instagram Search] Final discovered competitor URLs: ${result.length}/${limit}`);
    return result;
  }

  public async extract(): Promise<RawInstagramData> {
    logger.info(`Extracting Instagram profile data from: ${this.currentUrl}`);
    
    await this.page.waitForLoadState('domcontentloaded');
    await this.humanDelay(2000, 3500);

    const profileInfo = await this.page.evaluate(() => {
      const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const metaDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

      const followersMatch = metaDesc.match(/([\d.,KkMm]+)\s*Followers/i) || metaDesc.match(/([\d.,KkMm]+)\s*Seguidores/i);
      const followingMatch = metaDesc.match(/([\d.,KkMm]+)\s*Following/i) || metaDesc.match(/([\d.,KkMm]+)\s*Seguidos/i);
      const postsMatch = metaDesc.match(/([\d.,KkMm]+)\s*Posts/i) || metaDesc.match(/([\d.,KkMm]+)\s*Publicaciones/i);

      const pathParts = window.location.pathname.split('/').filter(Boolean);
      const username = pathParts.length > 0 ? pathParts[0] : null;

      const nameElem = document.querySelector('header h1, header h2, header section span');
      const name = nameElem ? nameElem.textContent?.trim() : null;

      const bioElem = document.querySelector('header section > div:last-child, header h1 ~ span, header h2 ~ span');
      const bio = bioElem ? bioElem.textContent?.trim() : null;

      const links: string[] = [];
      const externalLinkElems = document.querySelectorAll('header a[target="_blank"]');
      externalLinkElems.forEach((a) => {
        const href = a.getAttribute('href');
        if (href && !href.includes('instagram.com')) {
          links.push(href);
        }
      });

      return {
        metaTitle,
        metaDesc,
        username,
        name,
        bio,
        followersStr: followersMatch ? followersMatch[1] : null,
        followingStr: followingMatch ? followingMatch[1] : null,
        postsStr: postsMatch ? postsMatch[1] : null,
        links,
      };
    });

    await this.smoothScroll(3, 400);
    await this.humanDelay(1500, 2500);

    const extractedPosts: InstagramPost[] = await this.page.evaluate((limit) => {
      const posts: InstagramPost[] = [];
      const postLinks = Array.from(document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]'));
      
      const uniqueLinks = postLinks.slice(0, limit);

      uniqueLinks.forEach((link) => {
        const href = link.getAttribute('href') || '';
        const img = link.querySelector('img');
        const altText = img ? img.getAttribute('alt') || '' : '';
        const imgSrc = img ? img.getAttribute('src') || '' : '';
        const isReel = href.includes('/reel/');

        posts.push({
          text: altText ? altText.substring(0, 500) : undefined,
          hashtags: [],
          type: isReel ? 'Reel/Video' : 'Image',
          imgUrl: imgSrc || undefined,
        });
      });

      return posts;
    }, this.maxPosts);

    const allText = (profileInfo.bio || '') + ' ' + extractedPosts.map((p) => p.text || '').join(' ');
    const frequentHashtags = extractHashtags(allText);

    extractedPosts.forEach((post) => {
      if (post.text) {
        post.hashtags = extractHashtags(post.text);
      }
    });

    return {
      url: this.currentUrl,
      name: cleanText(profileInfo.name || profileInfo.metaTitle),
      username: profileInfo.username ? profileInfo.username.replace('@', '') : null,
      bio: cleanText(profileInfo.bio || profileInfo.metaDesc),
      followers: parseNumber(profileInfo.followersStr),
      following: parseNumber(profileInfo.followingStr),
      totalPosts: parseNumber(profileInfo.postsStr),
      externalLinks: profileInfo.links,
      frequentHashtags,
      posts: extractedPosts,
      scrapedAt: new Date().toISOString(),
    };
  }

  public normalize(raw: RawInstagramData): NormalizedCompetitorData {
    const fullText = (raw.bio || '') + ' ' + raw.posts.map((p) => p.text || '').join(' ');
    const phone = extractPhone(fullText);
    const email = extractEmail(fullText);

    return {
      source: 'instagram',
      url: raw.url,
      name: raw.name,
      username: raw.username,
      price: null,
      currency: null,
      rating: null,
      reviews: null,
      followers: raw.followers,
      location: null,
      phone: phone,
      email: email,
      website: raw.externalLinks.length > 0 ? raw.externalLinks[0] : null,
      description: raw.bio,
      amenities: [],
      hashtags: raw.frequentHashtags,
      posts: raw.posts,
      comments: [],
      images: raw.posts.map((p) => p.imgUrl).filter((url): url is string => Boolean(url)),
      scrapedAt: raw.scrapedAt,
    };
  }
}
