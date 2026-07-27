import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  public async initSession(options: {
    headless?: boolean;
    storageStatePath?: string;
  } = {}): Promise<BrowserSession> {
    const headless = options.headless ?? (process.env.HEADLESS !== 'false');
    const storageStatePath = options.storageStatePath || process.env.STORAGE_STATE_PATH || './auth/storage-state.json';

    logger.info(`Launching Chromium (Headless: ${headless})...`);

    this.browser = await chromium.launch({
      headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--window-size=1280,800',
      ],
    });

    const contextOptions: any = {
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'es-ES',
      timezoneId: 'America/Bogota',
    };

    const resolvedStatePath = path.resolve(process.cwd(), storageStatePath);
    if (fs.existsSync(resolvedStatePath)) {
      logger.info(`Loading saved storage state session from: ${resolvedStatePath}`);
      contextOptions.storageState = resolvedStatePath;
    } else {
      logger.warn(`Storage state file not found at ${resolvedStatePath}. Proceeding with fresh guest session.`);
    }

    this.context = await this.browser.newContext(contextOptions);

    // Apply basic anti-detection script
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const page = await this.context.newPage();
    return { browser: this.browser, context: this.context, page };
  }

  public async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    logger.info('Browser session closed.');
  }
}
