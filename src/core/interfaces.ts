/**
 * Standard normalized data schema for accommodation competitors across all platforms.
 */
export interface NormalizedCompetitorData {
  source: string;
  url: string;
  name: string | null;
  username: string | null;
  price: string | null;
  currency: string | null;
  rating: number | null;
  reviews: number | null;
  followers: number | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  amenities: string[];
  hashtags: string[];
  posts: Array<{
    text?: string;
    hashtags?: string[];
    date?: string;
    likes?: number | string;
    comments?: number | string;
    views?: number | string;
    type?: string;
  }>;
  comments: Array<{
    author?: string;
    text?: string;
    date?: string;
  }>;
  images: string[];
  scrapedAt: string;
}

/**
 * Standard Crawler Interface that every platform crawler must implement.
 */
export interface CompetitorCrawler {
  /**
   * Opens the target URL, waits for load, dynamically loads content, and handles scrolling.
   */
  open(url: string): Promise<void>;

  /**
   * Extracts raw page data into an intermediate structure.
   */
  extract(): Promise<any>;

  /**
   * Normalizes raw extracted data into standard NormalizedCompetitorData format.
   */
  normalize(raw: any): NormalizedCompetitorData;

  /**
   * Automated discovery mode: Searches platform for a given set of queries/keywords
   * and returns an array of up to maxResults competitor URLs.
   */
  search?(queries: string[], maxResults?: number): Promise<string[]>;
}

/**
 * Common configuration options for crawlers.
 */
export interface CrawlerOptions {
  headless?: boolean;
  timeout?: number;
  storageStatePath?: string;
  maxPostsPerProfile?: number;
  queries?: string[];
  limitPerPlatform?: number;
}
