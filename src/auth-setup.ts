import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import readline from 'readline';

dotenv.config();

async function runAuthSetup() {
  const storagePath = process.env.STORAGE_STATE_PATH || './auth/storage-state.json';
  const resolvedPath = path.resolve(process.cwd(), storagePath);

  const authDir = path.dirname(resolvedPath);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  console.log('=======================================================');
  console.log('  AUTHENTICATION SETUP SESSION - Playwright StorageState ');
  console.log('=======================================================');
  console.log('Launching interactive Chromium window...');
  console.log('Please log into Facebook, Instagram, and/or TikTok in the open browser.');
  console.log('Once you have finished logging in, return here and press ENTER.\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--window-size=1280,800'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'es-ES',
  });

  const page = await context.newPage();

  // Open initial page
  await page.goto('https://www.facebook.com');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise<void>((resolve) => {
    rl.question('Press ENTER when you have completed manual login in the browser window: ', () => {
      rl.close();
      resolve();
    });
  });

  console.log(`\nSaving authenticated storage state session to: ${resolvedPath}...`);
  await context.storageState({ path: resolvedPath });
  console.log('Storage state successfully saved!');

  await browser.close();
  console.log('Auth setup complete. You can now run the market research crawler with session reuse.');
}

runAuthSetup().catch((err) => {
  console.error('Error during authentication setup:', err);
  process.exit(1);
});
