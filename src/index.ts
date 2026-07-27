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

interface SearchConfig {
  queries?: string[];
  query?: string;
  limitPerPlatform?: number;
  platforms?: string[];
}

function parseCliArgs(): { searchMode: boolean; queries: string[]; limit: number; directUrls: string[] } {
  const args = process.argv.slice(2);
  let searchMode = false;
  const queries: string[] = [];
  let limit = 10;
  const directUrls: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--search' && args[i + 1]) {
      searchMode = true;
      queries.push(args[i + 1]);
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10) || 10;
      i++;
    } else if (args[i].startsWith('http')) {
      directUrls.push(args[i]);
    }
  }

  return { searchMode, queries, limit, directUrls };
}

function loadSearchConfig(): SearchConfig | null {
  const searchJsonPath = path.resolve(process.cwd(), 'search.json');
  if (fs.existsSync(searchJsonPath)) {
    try {
      const content = fs.readFileSync(searchJsonPath, 'utf-8');
      const parsed = JSON.parse(content);
      if ((parsed.queries && Array.isArray(parsed.queries) && parsed.queries.length > 0) || parsed.query) {
        return parsed;
      }
    } catch (err: any) {
      logger.error(`Error reading search.json: ${err.message}`);
    }
  }
  return null;
}

function loadDirectUrls(): string[] {
  const urlsPath = path.resolve(process.cwd(), 'urls.json');
  if (fs.existsSync(urlsPath)) {
    try {
      const fileContent = fs.readFileSync(urlsPath, 'utf-8');
      const parsed = JSON.parse(fileContent);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch (err: any) {
      logger.error(`Error reading urls.json: ${err.message}`);
    }
  }
  return [];
}

async function main() {
  logger.info('===============================================================');
  logger.info('  ACCOMMODATION COMPETITOR MARKET RESEARCH CRAWLER INITIALIZED ');
  logger.info('===============================================================');

  const cli = parseCliArgs();
  const searchFileConfig = loadSearchConfig();

  const isSearchMode = cli.searchMode || Boolean(searchFileConfig?.queries || searchFileConfig?.query);
  
  let searchQueries: string[] = [];
  if (cli.queries.length > 0) {
    searchQueries = cli.queries;
  } else if (searchFileConfig?.queries && Array.isArray(searchFileConfig.queries)) {
    searchQueries = searchFileConfig.queries;
  } else if (searchFileConfig?.query) {
    searchQueries = [searchFileConfig.query];
  } else {
    searchQueries = [
      "casa de campo Santa Rosa de Quives",
      "casa de campo Santa Rosa de Quives Country Club, Carretera Lima – Canta, Quives",
      "casa de campo Santa Rosa de Quives, Departamento de Lima"
    ];
  }

  const maxLimit = cli.limit || searchFileConfig?.limitPerPlatform || 10;
  const targetPlatforms = searchFileConfig?.platforms || ['facebook', 'instagram', 'tiktok', 'airbnb'];

  const maxPosts = parseInt(process.env.MAX_POSTS_PER_PROFILE || '12', 10);
  const results: NormalizedCompetitorData[] = [];

  const browserManager = new BrowserManager();

  try {
    const session = await browserManager.initSession();

    if (isSearchMode) {
      logger.info(`[MODE: AUTOMATED SEARCH DISCOVERY] ${searchQueries.length} Query variation(s) | Target Limit: ${maxLimit} per platform (Cutoff: ${maxLimit})`);
      searchQueries.forEach((q, idx) => logger.info(`  Query [${idx + 1}]: "${q}"`));

      for (const platform of targetPlatforms) {
        logger.info(`---------------------------------------------------------------`);
        logger.info(`Starting Discovery for Platform: ${platform.toUpperCase()}`);

        let discoveredUrls: string[] = [];

        try {
          switch (platform.toLowerCase()) {
            case 'airbnb': {
              const crawler = new AirbnbCrawler(session.page);
              discoveredUrls = await crawler.search(searchQueries, maxLimit);
              break;
            }
            case 'facebook': {
              const crawler = new FacebookCrawler(session.page);
              discoveredUrls = await crawler.search(searchQueries, maxLimit);
              break;
            }
            case 'instagram': {
              const crawler = new InstagramCrawler(session.page, maxPosts);
              discoveredUrls = await crawler.search(searchQueries, maxLimit);
              break;
            }
            case 'tiktok': {
              const crawler = new TikTokCrawler(session.page, maxPosts);
              discoveredUrls = await crawler.search(searchQueries, maxLimit);
              break;
            }
          }
        } catch (searchError: any) {
          logger.error(`Failed discovery for platform ${platform}: ${searchError.message}`);
        }

        logger.info(`Discovered ${discoveredUrls.length} competitor URL(s) on ${platform.toUpperCase()}. Crawling details...`);

        for (let i = 0; i < discoveredUrls.length; i++) {
          const targetUrl = discoveredUrls[i];
          logger.info(`[${platform.toUpperCase()}] [Crawling ${i + 1}/${discoveredUrls.length}] URL: ${targetUrl}`);

          try {
            let data: NormalizedCompetitorData;
            switch (platform.toLowerCase()) {
              case 'airbnb': {
                const crawler = new AirbnbCrawler(session.page);
                data = await crawler.crawl(targetUrl);
                break;
              }
              case 'facebook': {
                const crawler = new FacebookCrawler(session.page);
                data = await crawler.crawl(targetUrl);
                break;
              }
              case 'instagram': {
                const crawler = new InstagramCrawler(session.page, maxPosts);
                data = await crawler.crawl(targetUrl);
                break;
              }
              case 'tiktok': {
                const crawler = new TikTokCrawler(session.page, maxPosts);
                data = await crawler.crawl(targetUrl);
                break;
              }
              default:
                continue;
            }
            results.push(data);
          } catch (err: any) {
            logger.error(`Error crawling ${targetUrl}: ${err.message}`);
          }
        }
      }
    } else {
      // Direct URL Mode
      const urls = cli.directUrls.length > 0 ? cli.directUrls : loadDirectUrls();
      logger.info(`[MODE: DIRECT URL] Loaded ${urls.length} target URL(s).`);

      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const platform = detectPlatform(url);

        logger.info(`[Processing ${i + 1}/${urls.length}] Platform: ${platform.toUpperCase()} | URL: ${url}`);

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
              logger.warn(`Unsupported platform or URL format: ${url}. Skipping.`);
              continue;
          }
          results.push(normalizedData);
        } catch (error: any) {
          logger.error(`Failed to crawl URL (${url}): ${error.message}`);
        }
      }
    }

    if (results.length > 0) {
      const jsonPath = process.env.OUTPUT_JSON_PATH || './competitors.json';
      const csvPath = process.env.OUTPUT_CSV_PATH || './competitors.csv';

      logger.info(`Exporting ${results.length} total normalized competitor record(s)...`);
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
