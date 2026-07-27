import { Page } from 'playwright';
import { BaseCrawler } from '../core/base-crawler';
import { NormalizedCompetitorData } from '../core/interfaces';
import { logger } from '../core/logger';
import {
  cleanText,
  extractEmail,
  extractHashtags,
  extractPhone,
  extractWhatsApp,
  parseNumber,
} from '../utils/helpers';

export interface RawFacebookData {
  url: string;
  title: string | null;
  pageName: string | null;
  category: string | null;
  description: string | null;
  fullText: string | null;
  price: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  website: string | null;
  hours: string | null;
  services: string[];
  amenities: string[];
  postDate: string | null;
  imageCount: number;
  reactions: number | null;
  comments: Array<{ author?: string; text?: string; date?: string }>;
  scrapedAt: string;
}

export class FacebookCrawler extends BaseCrawler {
  constructor(page: Page) {
    super(page);
  }

  protected getPlatformName(): string {
    return 'Facebook';
  }

  /**
   * Searches Facebook for pages/profiles. Cuts off immediately once 10 URLs are collected.
   */
  public override async search(queries: string[], maxResults: number = 10): Promise<string[]> {
    const discoveredUrls: Set<string> = new Set();
    const limit = Math.min(maxResults, 10);

    logger.info(`[Facebook Search] Starting discovery (Target Limit: ${limit})`);

    for (const query of queries) {
      if (discoveredUrls.size >= limit) {
        logger.info(`[Facebook Search] Limit of ${limit} reached. Cutting off query loop.`);
        break;
      }

      const searchEndpoints = [
        `https://www.facebook.com/search/pages/?q=${encodeURIComponent(query)}`,
        `https://www.facebook.com/search/top/?q=${encodeURIComponent(query)}`,
      ];

      for (const searchUrl of searchEndpoints) {
        if (discoveredUrls.size >= limit) break;
        logger.info(`[Facebook Search] Query: "${query}" -> ${searchUrl}`);

        try {
          await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
          await this.humanDelay(2000, 3500);

          let scrollAttempts = 0;
          const maxScrolls = 5;

          while (discoveredUrls.size < limit && scrollAttempts < maxScrolls) {
            await this.smoothScroll(4, 700);
            await this.humanDelay(1200, 2000);

            const foundLinks = await this.page.evaluate(() => {
              const anchors = Array.from(document.querySelectorAll('a[href*="facebook.com/"]'));
              const urls: string[] = [];
              anchors.forEach((a) => {
                const href = a.getAttribute('href') || '';
                if (
                  href.includes('facebook.com') &&
                  !href.includes('/search/') &&
                  !href.includes('/groups/') &&
                  !href.includes('/watch/') &&
                  !href.includes('/help/') &&
                  !href.includes('/login')
                ) {
                  const cleanUrl = href.split('?')[0].split('&')[0];
                  if (cleanUrl.length > 22 && !cleanUrl.endsWith('facebook.com/')) {
                    urls.push(cleanUrl);
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

            logger.info(`[Facebook Search] Total collected: ${discoveredUrls.size}/${limit}`);
            scrollAttempts++;
          }
        } catch (err: any) {
          logger.warn(`[Facebook Search] Error querying ${searchUrl}: ${err.message}`);
        }
      }
    }

    const result = Array.from(discoveredUrls).slice(0, limit);
    logger.info(`[Facebook Search] Final discovered competitor URLs: ${result.length}/${limit}`);
    return result;
  }

  public async extract(): Promise<RawFacebookData> {
    logger.info(`Extracting Facebook data from: ${this.currentUrl}`);
    
    await this.smoothScroll(4, 500);
    await this.humanDelay(1500, 2500);

    const title = await this.page.title();

    const pageName = await this.page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (h1 && h1.textContent?.trim()) return h1.textContent.trim();
      const metaTitle = document.querySelector('meta[property="og:title"]');
      if (metaTitle) return metaTitle.getAttribute('content');
      return null;
    });

    const fullText = await this.page.evaluate(() => {
      const clone = (document.querySelector('div[role="main"]') || document.body).cloneNode(true) as Element;
      const unwanted = clone.querySelectorAll('script, style, noscript, svg, template');
      unwanted.forEach((n) => n.remove());
      return clone.textContent || '';
    });

    const ogDescription = await this.page.evaluate(() => {
      const metaDesc = document.querySelector('meta[property="og:description"]') || document.querySelector('meta[name="description"]');
      return metaDesc ? metaDesc.getAttribute('content') : null;
    });

    const description = cleanText(ogDescription || fullText.substring(0, 500));

    const phone = extractPhone(fullText);
    const email = extractEmail(fullText);
    const whatsapp = extractWhatsApp(fullText);

    const website = await this.page.evaluate(() => {
      const linkElems = Array.from(document.querySelectorAll('a[href*="http"]'));
      for (const el of linkElems) {
        const href = el.getAttribute('href') || '';
        if (!href.includes('facebook.com') && !href.includes('fb.me') && !href.includes('instagram.com')) {
          return href;
        }
      }
      return null;
    });

    const imageCount = await this.page.evaluate(() => {
      const imgs = document.querySelectorAll('img');
      let count = 0;
      imgs.forEach((img) => {
        const src = img.src || '';
        if (src.includes('scontent') || src.includes('fbcdn')) {
          count++;
        }
      });
      return count > 0 ? count : imgs.length;
    });

    const priceMatch = fullText.match(/(\$|USD\s?|COP\s?|€\s?)\d+([.,]\d+)?/i);
    const price = priceMatch ? priceMatch[0] : null;

    const locationMatch = fullText.match(/(Ubicación|Location|Dirección|Address|Ciudad|En)\s*:\s*([^.\n]+)/i);
    const location = locationMatch ? cleanText(locationMatch[2]) : null;

    const categoryMatch = fullText.match(/(Categoría|Category)\s*:\s*([^.\n]+)/i);
    const category = categoryMatch ? cleanText(categoryMatch[2]) : null;

    const hoursMatch = fullText.match(/(Horario|Hours|Abierto|Open)\s*:\s*([^.\n]+)/i);
    const hours = hoursMatch ? cleanText(hoursMatch[2]) : null;

    const comments = await this.page.evaluate(() => {
      const results: Array<{ author?: string; text?: string }> = [];
      const commentNodes = document.querySelectorAll('div[role="article"], div[aria-label*="Comentario"], div[aria-label*="Comment"]');
      commentNodes.forEach((node) => {
        const text = node.textContent?.trim();
        if (text && text.length > 5 && text.length < 500) {
          results.push({ text });
        }
      });
      return results.slice(0, 15);
    });

    const reactionsText = await this.page.evaluate(() => {
      const elem = document.querySelector('span[aria-label*="reacciones"], span[aria-label*="reactions"], span[aria-label*="Me gusta"]');
      return elem ? elem.getAttribute('aria-label') || elem.textContent : null;
    });
    const reactions = parseNumber(reactionsText);

    return {
      url: this.currentUrl,
      title: title || null,
      pageName: cleanText(pageName),
      category: category,
      description: description,
      fullText: cleanText(fullText),
      price: price,
      location: location,
      phone: phone,
      email: email,
      whatsapp: whatsapp,
      website: website,
      hours: hours,
      services: [],
      amenities: [],
      postDate: null,
      imageCount: imageCount,
      reactions: reactions,
      comments: comments,
      scrapedAt: new Date().toISOString(),
    };
  }

  public normalize(raw: RawFacebookData): NormalizedCompetitorData {
    const hashtags = extractHashtags(raw.fullText);
    
    return {
      source: 'facebook',
      url: raw.url,
      name: raw.pageName || raw.title || 'Facebook Page',
      username: null,
      price: raw.price,
      currency: raw.price ? (raw.price.includes('$') ? 'USD' : null) : null,
      rating: null,
      reviews: raw.reactions,
      followers: null,
      location: raw.location,
      phone: raw.phone,
      email: raw.email,
      website: raw.website,
      description: raw.description,
      amenities: raw.amenities || [],
      hashtags: hashtags,
      posts: [
        {
          text: raw.fullText ? raw.fullText.substring(0, 1000) : undefined,
          hashtags: hashtags,
          date: raw.postDate || undefined,
          likes: raw.reactions || undefined,
          comments: raw.comments.length,
        },
      ],
      comments: raw.comments,
      images: raw.imageCount > 0 ? [`${raw.imageCount} images detected`] : [],
      scrapedAt: raw.scrapedAt,
    };
  }
}
