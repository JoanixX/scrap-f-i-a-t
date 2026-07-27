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

  public async extract(): Promise<RawFacebookData> {
    logger.info(`Extracting Facebook data from: ${this.currentUrl}`);
    
    // Smooth scroll down to trigger dynamic loading of content & comments
    await this.smoothScroll(4, 500);
    await this.humanDelay(1500, 2500);

    const title = await this.page.title();

    // Extract basic page or post name from h1, page header, or meta title
    const pageName = await this.page.evaluate(() => {
      const h1 = document.querySelector('h1');
      if (h1 && h1.textContent?.trim()) return h1.textContent.trim();
      const metaTitle = document.querySelector('meta[property="og:title"]');
      if (metaTitle) return metaTitle.getAttribute('content');
      return null;
    });

    // Extract main visible text from the page body / main container
    const fullText = await this.page.evaluate(() => {
      const main = document.querySelector('div[role="main"]') || document.body;
      return main ? main.textContent || '' : '';
    });

    // Extract Open Graph description
    const ogDescription = await this.page.evaluate(() => {
      const metaDesc = document.querySelector('meta[property="og:description"]') || document.querySelector('meta[name="description"]');
      return metaDesc ? metaDesc.getAttribute('content') : null;
    });

    const description = cleanText(ogDescription || fullText.substring(0, 500));

    // Contact details & metadata extraction
    const phone = extractPhone(fullText);
    const email = extractEmail(fullText);
    const whatsapp = extractWhatsApp(fullText);

    // Website link extraction
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

    // Extract image elements count
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

    // Extract price if present (e.g. $150, USD 100, $150.00)
    const priceMatch = fullText.match(/(\$|USD\s?|COP\s?|€\s?)\d+([.,]\d+)?/i);
    const price = priceMatch ? priceMatch[0] : null;

    // Extract location hint
    const locationMatch = fullText.match(/(Ubicación|Location|Dirección|Address|Ciudad|En)\s*:\s*([^.\n]+)/i);
    const location = locationMatch ? cleanText(locationMatch[2]) : null;

    // Extract category hint
    const categoryMatch = fullText.match(/(Categoría|Category)\s*:\s*([^.\n]+)/i);
    const category = categoryMatch ? cleanText(categoryMatch[2]) : null;

    // Extract hours hint
    const hoursMatch = fullText.match(/(Horario|Hours|Abierto|Open)\s*:\s*([^.\n]+)/i);
    const hours = hoursMatch ? cleanText(hoursMatch[2]) : null;

    // Extract visible comments
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

    // Extract approximate reaction count
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
