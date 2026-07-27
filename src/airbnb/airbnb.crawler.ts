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
  scrapedAt: string;
}

export class AirbnbCrawler extends BaseCrawler {
  constructor(page: Page) {
    super(page);
  }

  protected getPlatformName(): string {
    return 'Airbnb';
  }

  public async extract(): Promise<RawAirbnbData> {
    logger.info(`Extracting Airbnb property listing data from: ${this.currentUrl}`);

    await this.page.waitForLoadState('domcontentloaded');
    await this.humanDelay(2000, 3500);

    // Scroll down to load amenities and reviews sections
    await this.smoothScroll(5, 500);
    await this.humanDelay(1500, 2500);

    const extracted = await this.page.evaluate(() => {
      // Name / Title
      const h1 = document.querySelector('h1');
      const name = h1 ? h1.textContent?.trim() : null;

      // Meta tags fallbacks
      const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
      const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';

      // Price & Currency
      let priceText = null;
      let currencyText = null;
      const priceElem = document.querySelector('span._1y74zjx, span._178d8k, span[aria-hidden="true"]');
      const allText = document.body.textContent || '';

      const priceMatch = allText.match(/(\$|USD|COP|EUR|€)\s?([\d.,]+)\s*(?:noche|night|\/night)/i);
      if (priceMatch) {
        priceText = priceMatch[2];
        currencyText = priceMatch[1];
      }

      // Rating & Reviews count
      // Often looks like: "4.95 · 42 reseñas" or "5.0 (15 reviews)"
      let rating: number | null = null;
      let reviewCount: number | null = null;

      const ratingMatch = allText.match(/([3-5]\.\d{1,2})\s*[·•]\s*([\d]+)\s*(?:reseñas|reviews)/i);
      if (ratingMatch) {
        rating = parseFloat(ratingMatch[1]);
        reviewCount = parseInt(ratingMatch[2], 10);
      } else {
        const altRatingMatch = allText.match(/([3-5]\.\d{1,2})\s*out of 5/i);
        if (altRatingMatch) {
          rating = parseFloat(altRatingMatch[1]);
        }
      }

      // Property specs: capacity, bedrooms, beds, bathrooms
      // Typical text: "6 huéspedes · 3 habitaciones · 4 camas · 2 baños"
      let capacity: string | null = null;
      let bedrooms: string | null = null;
      let beds: string | null = null;
      let bathrooms: string | null = null;

      const specsMatch = allText.match(/([\d]+\s*huéspedes|[\d]+\s*guests)/i);
      if (specsMatch) capacity = specsMatch[0];

      const bedMatch = allText.match(/([\d]+\s*dormitorios|[\d]+\s*habitaciones|[\d]+\s*bedrooms?)/i);
      if (bedMatch) bedrooms = bedMatch[0];

      const bedsMatch = allText.match(/([\d]+\s*camas|[\d]+\s*beds?)/i);
      if (bedsMatch) beds = bedsMatch[0];

      const bathMatch = allText.match(/([\d.,]+\s*baños|[\d.,]+\s*baths?)/i);
      if (bathMatch) bathrooms = bathMatch[0];

      // Location string
      const locationMatch = allText.match(/(?:Ubicación|Location|Dónde estarás|Where you'll be)\s*[:\n]?\s*([^.\n]+)/i);
      const approxLocation = locationMatch ? locationMatch[1].trim() : null;

      // Property Type
      const typeMatch = allText.match(/(Cabaña entera|Casa entera|Apartamento entero|Villa entera|Entire cabin|Entire home|Entire villa)/i);
      const propertyType = typeMatch ? typeMatch[0] : 'Alojamientoturístico';

      // Amenities list extraction
      const amenities: string[] = [];
      const amenityElements = document.querySelectorAll('div[data-plugin-in-point="AMENITIES_DEFAULT"] div, section div[aria-label*="amenity"]');
      amenityElements.forEach((el) => {
        const txt = el.textContent?.trim();
        if (txt && txt.length > 2 && txt.length < 50 && !amenities.includes(txt)) {
          amenities.push(txt);
        }
      });

      // Reviews text
      const visibleReviews: Array<{ text: string }> = [];
      const reviewCards = document.querySelectorAll('div[data-review-id], div[aria-label*="Review"], span[class*="r15z1158"]');
      reviewCards.forEach((card) => {
        const txt = card.textContent?.trim();
        if (txt && txt.length > 20 && txt.length < 600) {
          visibleReviews.push({ text: txt });
        }
      });

      return {
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
        description: metaDesc || allText.substring(0, 800),
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
