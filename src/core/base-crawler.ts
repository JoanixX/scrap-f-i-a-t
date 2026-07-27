import { Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import { CompetitorCrawler, NormalizedCompetitorData } from './interfaces';
import { logger } from './logger';

export abstract class BaseCrawler implements CompetitorCrawler {
  protected page: Page;
  protected currentUrl: string = '';

  constructor(page: Page) {
    this.page = page;
  }

  public abstract extract(): Promise<any>;
  public abstract normalize(raw: any): NormalizedCompetitorData;

  /**
   * Opens the target URL and handles initial page loading logic.
   */
  public async open(url: string): Promise<void> {
    this.currentUrl = url;
    logger.info(`[${this.getPlatformName()}] Navigating to: ${url}`);
    
    await this.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: parseInt(process.env.TIMEOUT || '30000', 10),
    });

    await this.humanDelay(1500, 3000);
  }

  /**
   * Full execution flow: opens URL, extracts raw data, normalizes, and handles errors.
   */
  public async crawl(url: string): Promise<NormalizedCompetitorData> {
    try {
      await this.open(url);
      const rawData = await this.extract();
      const normalized = this.normalize(rawData);
      logger.info(`[${this.getPlatformName()}] Extraction successfully completed for: ${url}`);
      return normalized;
    } catch (error: any) {
      logger.error(`[${this.getPlatformName()}] Extraction failed for ${url}: ${error.message}`, error);
      await this.takeErrorScreenshot();
      throw error;
    }
  }

  protected abstract getPlatformName(): string;

  /**
   * Simulates realistic human scrolling down the page.
   */
  protected async smoothScroll(steps: number = 3, distancePerStep: number = 400): Promise<void> {
    for (let i = 0; i < steps; i++) {
      await this.page.evaluate((distance) => {
        window.scrollBy({ top: distance, behavior: 'smooth' });
      }, distancePerStep);
      await this.humanDelay(800, 1500);
    }
  }

  /**
   * Introduces a random human-like delay between minMs and maxMs.
   */
  protected async humanDelay(minMs: number = 1000, maxMs: number = 2500): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await this.page.waitForTimeout(delay);
  }

  /**
   * Safely waits for a selector without throwing uncaught exceptions.
   */
  protected async waitForSelectorSafe(selector: string, timeoutMs: number = 5000): Promise<boolean> {
    try {
      await this.page.waitForSelector(selector, { state: 'visible', timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Captures an error screenshot saved to the screenshots folder.
   */
  protected async takeErrorScreenshot(): Promise<string | null> {
    try {
      const screenshotDir = path.join(process.cwd(), 'screenshots');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sanitizedPlatform = this.getPlatformName().toLowerCase();
      const filePath = path.join(screenshotDir, `error-${sanitizedPlatform}-${timestamp}.png`);
      
      await this.page.screenshot({ path: filePath, fullPage: true });
      logger.info(`Saved error screenshot to: ${filePath}`);
      return filePath;
    } catch (err: any) {
      logger.error(`Failed to capture error screenshot: ${err.message}`);
      return null;
    }
  }

  /**
   * Executes an async operation with automated retries.
   */
  protected async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 2,
    delayMs: number = 2000
  ): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        logger.warn(`Attempt ${attempt}/${maxRetries} failed: ${(err as Error).message}. Retrying in ${delayMs}ms...`);
        if (attempt < maxRetries) {
          await this.page.waitForTimeout(delayMs);
        }
      }
    }
    throw lastError;
  }
}
