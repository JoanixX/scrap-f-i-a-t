import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { BrowserManager } from './core/browser';
import { logger } from './core/logger';
import { NormalizedCompetitorData } from './core/interfaces';
import { detectPlatform } from './utils/helpers';
import { DataExporter } from './utils/exporter';
import { FacebookCrawler } from './facebook/facebook.crawler';
import { InstagramCrawler } from './instagram/instagram.crawler';
import { TikTokCrawler } from './tiktok/tiktok.crawler';
import { AirbnbCrawler } from './airbnb/airbnb.crawler';

dotenv.config();

async function loadUrls(): Promise<string[]> {
  // Check CLI arguments first
  const cliUrls = process.argv.slice(2).filter((arg) => arg.startsWith('http'));
  if (cliUrls.length > 0) {
    logger.info(`Received ${cliUrls.length} URL(s) from command line parameters.`);
    return cliUrls;
  }

  // Fallback to urls.json
  const urlsPath = path.resolve(process.cwd(), 'urls.json');
  if (fs.existsSync(urlsPath)) {
    try {
      const fileContent = fs.readFileSync(urlsPath, 'utf-8');
      const parsed = JSON.parse(fileContent);
      if (Array.isArray(parsed) && parsed.length > 0) {
        logger.info(`Loaded ${parsed.length} URL(s) from urls.json.`);
        return parsed;
      }
    } catch (err: any) {
      logger.error(`Error reading urls.json: ${err.message}`);
    }
  }

  logger.warn('No input URLs found in command line or urls.json. Using fallback default Airbnb sample URL.');
  return ['https://www.airbnb.com/rooms/12345678'];
}

async function main() {
  logger.info('===============================================================');
  logger.info('  ACCOMMODATION COMPETITOR MARKET RESEARCH CRAWLER INITIALIZED ');
  logger.info('===============================================================');

  const urls = await loadUrls();
  const maxPosts = parseInt(process.env.MAX_POSTS_PER_PROFILE || '12', 10);
  const results: NormalizedCompetitorData[] = [];

  const browserManager = new BrowserManager();
  let session;

  try {
    session = await browserManager.initSession();

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const platform = detectPlatform(url);

      logger.info(`[Processing ${i + 1}/${urls.length}] Platform detected: ${platform.toUpperCase()} | URL: ${url}`);

      try {
        let normalizedData: NormalizedCompetitorData;

        switch (platform) {
          case 'facebook': {
            const crawler = new FacebookCrawler(session.page);
            normalizedData = await crawler.crawl(url);
            break;
          }
          case 'instagram': {
            const crawler = new InstagramCrawler(session.page, maxPosts);
            normalizedData = await crawler.crawl(url);
            break;
          }
          case 'tiktok': {
            const crawler = new TikTokCrawler(session.page, maxPosts);
            normalizedData = await crawler.crawl(url);
            break;
          }
          case 'airbnb': {
            const crawler = new AirbnbCrawler(session.page);
            normalizedData = await crawler.crawl(url);
            break;
          }
          default:
            logger.warn(`Unsupported platform or unknown URL format: ${url}. Skipping.`);
            continue;
        }

        results.push(normalizedData);
      } catch (error: any) {
        logger.error(`Failed to crawl URL (${url}): ${error.message}`);
      }
    }

    if (results.length > 0) {
      const jsonPath = process.env.OUTPUT_JSON_PATH || './competitors.json';
      const csvPath = process.env.OUTPUT_CSV_PATH || './competitors.csv';

      logger.info(`Exporting ${results.length} normalized competitor result(s)...`);
      await DataExporter.exportAll(results, jsonPath, csvPath);
      logger.info('Market research crawling process finished successfully!');
    } else {
      logger.warn('No competitor data was successfully extracted.');
    }
  } catch (globalError: any) {
    logger.error(`Fatal error in crawler execution flow: ${globalError.message}`, globalError);
  } finally {
    await browserManager.close();
  }
}

main().catch((err) => {
  console.error('Unhandled execution error:', err);
  process.exit(1);
});
