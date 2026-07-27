import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';
import { NormalizedCompetitorData } from '../core/interfaces';
import { logger } from '../core/logger';

export class DataExporter {
  /**
   * Saves normalized competitor data to JSON file.
   */
  public static async exportToJson(
    data: NormalizedCompetitorData[],
    filePath: string = './competitors.json'
  ): Promise<void> {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    try {
      const jsonContent = JSON.stringify(data, null, 2);
      await fs.promises.writeFile(resolvedPath, jsonContent, 'utf-8');
      logger.info(`Successfully exported ${data.length} records to JSON: ${resolvedPath}`);
    } catch (error: any) {
      logger.error(`Failed to export JSON file to ${resolvedPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Saves normalized competitor data to CSV file using csv-writer.
   */
  public static async exportToCsv(
    data: NormalizedCompetitorData[],
    filePath: string = './competitors.csv'
  ): Promise<void> {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    try {
      const csvWriter = createObjectCsvWriter({
        path: resolvedPath,
        header: [
          { id: 'source', title: 'SOURCE' },
          { id: 'url', title: 'URL' },
          { id: 'name', title: 'NAME' },
          { id: 'username', title: 'USERNAME' },
          { id: 'price', title: 'PRICE' },
          { id: 'currency', title: 'CURRENCY' },
          { id: 'rating', title: 'RATING' },
          { id: 'reviews', title: 'REVIEWS' },
          { id: 'followers', title: 'FOLLOWERS' },
          { id: 'location', title: 'LOCATION' },
          { id: 'phone', title: 'PHONE' },
          { id: 'email', title: 'EMAIL' },
          { id: 'website', title: 'WEBSITE' },
          { id: 'description', title: 'DESCRIPTION' },
          { id: 'amenities', title: 'AMENITIES' },
          { id: 'hashtags', title: 'HASHTAGS' },
          { id: 'postsCount', title: 'POSTS_COUNT' },
          { id: 'commentsCount', title: 'COMMENTS_COUNT' },
          { id: 'imagesCount', title: 'IMAGES_COUNT' },
          { id: 'scrapedAt', title: 'SCRAPED_AT' },
        ],
      });

      const records = data.map((item) => ({
        source: item.source || '',
        url: item.url || '',
        name: item.name || '',
        username: item.username || '',
        price: item.price || '',
        currency: item.currency || '',
        rating: item.rating !== null ? item.rating : '',
        reviews: item.reviews !== null ? item.reviews : '',
        followers: item.followers !== null ? item.followers : '',
        location: item.location || '',
        phone: item.phone || '',
        email: item.email || '',
        website: item.website || '',
        description: item.description || '',
        amenities: Array.isArray(item.amenities) ? item.amenities.join(' | ') : '',
        hashtags: Array.isArray(item.hashtags) ? item.hashtags.join(' | ') : '',
        postsCount: Array.isArray(item.posts) ? item.posts.length : 0,
        commentsCount: Array.isArray(item.comments) ? item.comments.length : 0,
        imagesCount: Array.isArray(item.images) ? item.images.length : 0,
        scrapedAt: item.scrapedAt || '',
      }));

      await csvWriter.writeRecords(records);
      logger.info(`Successfully exported ${data.length} records to CSV: ${resolvedPath}`);
    } catch (error: any) {
      logger.error(`Failed to export CSV file to ${resolvedPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Helper method to export both JSON and CSV files simultaneously.
   */
  public static async exportAll(
    data: NormalizedCompetitorData[],
    jsonPath: string = './competitors.json',
    csvPath: string = './competitors.csv'
  ): Promise<void> {
    await this.exportToJson(data, jsonPath);
    await this.exportToCsv(data, csvPath);
  }
}
