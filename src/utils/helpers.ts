/**
 * Extracts visible inner text from a DOM element, explicitly excluding
 * <script>, <style>, <noscript>, and SVG tags to prevent extracting JavaScript configs.
 */
export function getVisibleText(root: Element | Document = document): string {
  const clone = root.cloneNode(true) as Element;
  const unwantedNodes = clone.querySelectorAll('script, style, noscript, svg, template, iframe');
  unwantedNodes.forEach((node) => node.remove());
  return clone.textContent || '';
}

/**
 * Cleans string content by stripping excessive whitespaces, tabs, and linebreaks.
 */
export function cleanText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts phone numbers from arbitrary text content.
 */
export function extractPhone(text: string | null | undefined): string | null {
  if (!text) return null;
  const phoneRegex = /(\+?\d{1,4}[\s-]?)?(\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}/g;
  const matches = text.match(phoneRegex);
  return matches && matches.length > 0 ? matches[0].trim() : null;
}

/**
 * Extracts email addresses from text.
 */
export function extractEmail(text: string | null | undefined): string | null {
  if (!text) return null;
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex);
  return matches && matches.length > 0 ? matches[0].toLowerCase().trim() : null;
}

/**
 * Extracts WhatsApp numbers or links from text.
 */
export function extractWhatsApp(text: string | null | undefined): string | null {
  if (!text) return null;
  const waRegex = /(?:wa\.me\/|whatsapp\.com\/send\?phone=|\bwa\b[\s:]*)(\+?\d{8,15})/i;
  const match = text.match(waRegex);
  if (match) return match[1];
  
  if (/whatsapp/i.test(text)) {
    return extractPhone(text);
  }
  return null;
}

/**
 * Extracts hashtags (#tag) from text content.
 */
export function extractHashtags(text: string | null | undefined): string[] {
  if (!text) return [];
  const hashtagRegex = /#[\w\u00C0-\u024F]+/g;
  const matches = text.match(hashtagRegex);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Parses numeric strings like "1.2K", "3.4M", "1,250" into integers.
 */
export function parseNumber(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return input;
  
  const cleaned = input.toString().replace(/,/g, '').trim().toUpperCase();
  
  if (cleaned.endsWith('K')) {
    const num = parseFloat(cleaned.replace('K', ''));
    return isNaN(num) ? null : Math.round(num * 1000);
  }
  if (cleaned.endsWith('M')) {
    const num = parseFloat(cleaned.replace('M', ''));
    return isNaN(num) ? null : Math.round(num * 1000000);
  }
  
  const parsed = parseInt(cleaned.replace(/[^\d]/g, ''), 10);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Determines platform type from URL string.
 */
export function detectPlatform(url: string): 'facebook' | 'instagram' | 'tiktok' | 'airbnb' | 'unknown' {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.com')) return 'facebook';
  if (lowerUrl.includes('instagram.com')) return 'instagram';
  if (lowerUrl.includes('tiktok.com')) return 'tiktok';
  if (lowerUrl.includes('airbnb.com')) return 'airbnb';
  return 'unknown';
}
