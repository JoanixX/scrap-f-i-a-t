import { Page } from 'playwright';
import { BaseCrawler } from '../core/base-crawler';
import { NormalizedCompetitorData } from '../core/interfaces';
import { logger } from '../core/logger';
import {
  cleanText,
  extractEmail,
  extractPhone,
  parseNumber,
} from '../utils/helpers';

export interface RawAirbnbData {
  url: string;
  name: string | null;
  price: string | null;
  currency: string | null;
  rating: number | null;
  reviewCount: number | null;
  propertyType: string | null;
  capacity: string | null;
  bedrooms: string | null;
  beds: string | null;
  bathrooms: string | null;
  amenities: string[];
  approxLocation: string | null;
  description: string | null;
  houseRules: string[];
  checkInCheckOut: string | null;
  visibleReviews: Array<{ author?: string; text?: string; date?: string }>;
  isErrorPage?: boolean;
  scrapedAt: string;
}

export class AirbnbCrawler extends BaseCrawler {
  constructor(page: Page) {
    super(page);
  }

  protected getPlatformName(): string {
    return 'Airbnb';
  }

  /**
   * Searches Airbnb across query variations.
   * Immediately cuts off once target limit (default 10) is reached.
   */
  public override async search(queries: string[], maxResults: number = 10): Promise<string[]> {
    const discoveredUrls: Set<string> = new Set();
    const limit = Math.min(maxResults, 10);

    logger.info(`[Airbnb Search] Starting discovery (Target Limit: ${limit})`);

    for (const query of queries) {
      if (discoveredUrls.size >= limit) {
        logger.info(`[Airbnb Search] Target limit of ${limit} reached. Cutting off query loop.`);
        break;
      }

      const searchUrl = `https://www.airbnb.com/s/${encodeURIComponent(query)}/homes`;
      logger.info(`[Airbnb Search] Query: "${query}" -> ${searchUrl}`);

      try {
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await this.humanDelay(2000, 3500);

        let pageNum = 1;
        const maxPages = 2;

        while (discoveredUrls.size < limit && pageNum <= maxPages) {
          await this.smoothScroll(3, 500);
          await this.humanDelay(1000, 2000);

          const foundLinks = await this.page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/rooms/"]'));
            return links
              .map((a) => a.getAttribute('href') || '')
              .filter((href) => href.includes('/rooms/'));
          });

          for (const rawHref of foundLinks) {
            const match = rawHref.match(/\/rooms\/(\d+)/);
            if (match) {
              const canonicalUrl = `https://www.airbnb.com/rooms/${match[1]}`;
              discoveredUrls.add(canonicalUrl);
              if (discoveredUrls.size >= limit) break;
            }
          }

          logger.info(`[Airbnb Search] Total collected: ${discoveredUrls.size}/${limit}`);
          if (discoveredUrls.size >= limit) break;

          const navigatedNext = await this.page.evaluate(() => {
            const nextNav = document.querySelector('a[aria-label="Siguiente"], a[aria-label="Next"], button[aria-label="Siguiente"], button[aria-label="Next"]');
            if (nextNav) {
              (nextNav as HTMLElement).click();
              return true;
            }
            return false;
          });

          if (!navigatedNext) break;
          await this.humanDelay(2000, 3000);
          pageNum++;
        }
      } catch (err: any) {
        logger.warn(`[Airbnb Search] Error querying "${query}": ${err.message}`);
      }
    }

    const result = Array.from(discoveredUrls).slice(0, limit);
    logger.info(`[Airbnb Search] Final discovered competitor URLs: ${result.length}/${limit}`);
    return result;
  }

  public async extract(): Promise<RawAirbnbData> {
    logger.info(`Extracting Airbnb property listing data from: ${this.currentUrl}`);

    await this.page.waitForLoadState('domcontentloaded');
    await this.humanDelay(2000, 3500);

    await this.smoothScroll(5, 500);
    await this.humanDelay(1500, 2500);

    const extracted = await this.page.evaluate(() => {
      const getCleanDOMText = (root: Element | Document = document): string => {
        const clone = root.cloneNode(true) as Element;
        const unwanted = clone.querySelectorAll('script, style, noscript, svg, template, iframe');
        unwanted.forEach((n) => n.remove());
        return clone.textContent || '';
      };

      const visibleText = getCleanDOMText(document.body);

      const is404 = visibleText.includes('404') || visibleText.includes('No hemos podido encontrar la página') || visibleText.includes('Page not found');
      if (is404) {
        return {
          isErrorPage: true,
          name: 'Página no encontrada / Listing no disponible (404)',
          price: null,
          currency: null,
          rating: null,
          reviewCount: null,
          propertyType: null,
          capacity: null,
          bedrooms: null,
          beds: null,
          bathrooms: null,
          amenities: [],
          approxLocation: null,
          description: 'La propiedad solicitada de Airbnb no existe o ya no está disponible.',
          houseRules: [],
          checkInCheckOut: null,
          visibleReviews: [],
        };
      }

      const h1 = document.querySelector('h1');
      const name = h1 ? h1.textContent?.trim() : null;

      const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

      let priceText = null;
      let currencyText = null;

      const priceMatch = visibleText.match(/(\$|USD|COP|EUR|€)\s?([\d.,]+)\s*(?:noche|night|\/night)/i);
      if (priceMatch) {
        priceText = priceMatch[2];
        currencyText = priceMatch[1];
      }

      let rating: number | null = null;
      let reviewCount: number | null = null;

      const ratingMatch = visibleText.match(/([3-5]\.\d{1,2})\s*[·•]\s*([\d]+)\s*(?:reseñas|reviews)/i);
      if (ratingMatch) {
        rating = parseFloat(ratingMatch[1]);
        reviewCount = parseInt(ratingMatch[2], 10);
      } else {
        const altRatingMatch = visibleText.match(/([3-5]\.\d{1,2})\s*out of 5/i);
        if (altRatingMatch) {
          rating = parseFloat(altRatingMatch[1]);
        }
      }

      let capacity: string | null = null;
      let bedrooms: string | null = null;
      let beds: string | null = null;
      let bathrooms: string | null = null;

      const specsMatch = visibleText.match(/([\d]+\s*huéspedes|[\d]+\s*guests)/i);
      if (specsMatch) capacity = specsMatch[0];

      const bedMatch = visibleText.match(/([\d]+\s*dormitorios|[\d]+\s*habitaciones|[\d]+\s*bedrooms?)/i);
      if (bedMatch) bedrooms = bedMatch[0];

      const bedsMatch = visibleText.match(/([\d]+\s*camas|[\d]+\s*beds?)/i);
      if (bedsMatch) beds = bedsMatch[0];

      const bathMatch = visibleText.match(/([\d.,]+\s*baños|[\d.,]+\s*baths?)/i);
      if (bathMatch) bathrooms = bathMatch[0];

      const locationMatch = visibleText.match(/(?:Ubicación|Location|Dónde estarás|Where you'll be)\s*[:\n]?\s*([^\n.]{4,60})/i);
      const approxLocation = locationMatch ? locationMatch[1].trim() : null;

      const typeMatch = visibleText.match(/(Cabaña entera|Casa entera|Apartamento entero|Villa entera|Entire cabin|Entire home|Entire villa)/i);
      const propertyType = typeMatch ? typeMatch[0] : 'Alojamiento turístico';

      const amenities: string[] = [];
      const amenityElements = document.querySelectorAll('div[data-plugin-in-point="AMENITIES_DEFAULT"] div, section div[aria-label*="amenity"]');
      amenityElements.forEach((el) => {
        const txt = el.textContent?.trim();
        if (txt && txt.length > 2 && txt.length < 50 && !amenities.includes(txt)) {
          amenities.push(txt);
        }
      });

      const visibleReviews: Array<{ text: string }> = [];
      const reviewCards = document.querySelectorAll('div[data-review-id], div[aria-label*="Review"], span[class*="r15z1158"]');
      reviewCards.forEach((card) => {
        const txt = card.textContent?.trim();
        if (txt && txt.length > 20 && txt.length < 600) {
          visibleReviews.push({ text: txt });
        }
      });

      return {
        isErrorPage: false,
        name: name || metaTitle,
        price: priceText,
        currency: currencyText,
        rating,
        reviewCount,
        propertyType,
        capacity,
        bedrooms,
        beds,
        bathrooms,
        amenities,
        approxLocation,
        description: metaDesc || visibleText.substring(0, 800),
        houseRules: [],
        checkInCheckOut: null,
        visibleReviews: visibleReviews.slice(0, 10),
      };
    });

    return {
      url: this.currentUrl,
      name: cleanText(extracted.name),
      price: extracted.price,
      currency: extracted.currency,
      rating: extracted.rating,
      reviewCount: extracted.reviewCount,
      propertyType: extracted.propertyType,
      capacity: extracted.capacity,
      bedrooms: extracted.bedrooms,
      beds: extracted.beds,
      bathrooms: extracted.bathrooms,
      amenities: extracted.amenities,
      approxLocation: cleanText(extracted.approxLocation),
      description: cleanText(extracted.description),
      houseRules: extracted.houseRules,
      checkInCheckOut: extracted.checkInCheckOut,
      visibleReviews: extracted.visibleReviews,
      isErrorPage: extracted.isErrorPage,
      scrapedAt: new Date().toISOString(),
    };
  }

  public normalize(raw: RawAirbnbData): NormalizedCompetitorData {
    const fullText = (raw.description || '') + ' ' + raw.visibleReviews.map((r) => r.text || '').join(' ');
    const phone = extractPhone(fullText);
    const email = extractEmail(fullText);

    return {
      source: 'airbnb',
      url: raw.url,
      name: raw.name,
      username: null,
      price: raw.price,
      currency: raw.currency,
      rating: raw.rating,
      reviews: raw.reviewCount,
      followers: null,
      location: raw.approxLocation,
      phone: phone,
      email: email,
      website: null,
      description: raw.description,
      amenities: raw.amenities,
      hashtags: [],
      posts: [],
      comments: raw.visibleReviews,
      images: [],
      scrapedAt: raw.scrapedAt,
    };
  }
}
