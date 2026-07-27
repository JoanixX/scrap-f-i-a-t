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

  public async extract(): Promise<RawInstagramData> {
    logger.info(`Extracting Instagram profile data from: ${this.currentUrl}`);
    
    // Wait for main header or body to load
    await this.page.waitForLoadState('domcontentloaded');
    await this.humanDelay(2000, 3500);

    // Extract basic profile headers via header / meta tags or DOM selectors
    const profileInfo = await this.page.evaluate(() => {
      const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const metaDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

      // Meta desc usually looks like: "1,234 Followers, 500 Following, 120 Posts - See Instagram photos and videos from Name (@username)"
      const followersMatch = metaDesc.match(/([\d.,KkMm]+)\s*Followers/i) || metaDesc.match(/([\d.,KkMm]+)\s*Seguidores/i);
      const followingMatch = metaDesc.match(/([\d.,KkMm]+)\s*Following/i) || metaDesc.match(/([\d.,KkMm]+)\s*Seguidos/i);
      const postsMatch = metaDesc.match(/([\d.,KkMm]+)\s*Posts/i) || metaDesc.match(/([\d.,KkMm]+)\s*Publicaciones/i);

      // Extract username from URL path or meta title
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      const username = pathParts.length > 0 ? pathParts[0] : null;

      // Extract Header Name
      const nameElem = document.querySelector('header h1, header h2, header section span');
      const name = nameElem ? nameElem.textContent?.trim() : null;

      // Bio text
      const bioElem = document.querySelector('header section > div:last-child, header h1 ~ span, header h2 ~ span');
      const bio = bioElem ? bioElem.textContent?.trim() : null;

      // External links
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

    // Scroll down to expose post grid
    await this.smoothScroll(3, 400);
    await this.humanDelay(1500, 2500);

    // Extract recent post grid items
    const extractedPosts: InstagramPost[] = await this.page.evaluate((limit) => {
      const posts: InstagramPost[] = [];
      // Posts are usually <a> elements inside the profile main container pointing to /p/code/ or /reel/code/
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

    // Process hashtags across extracted posts and bio
    const allText = (profileInfo.bio || '') + ' ' + extractedPosts.map((p) => p.text || '').join(' ');
    const frequentHashtags = extractHashtags(allText);

    // Enrich post objects with hashtags
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
