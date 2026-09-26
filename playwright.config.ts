import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config();

const COCKPIT_URL = process.env.COCKPIT_URL || 'http://localhost:4010';

export default defineConfig({
  testDir: '.',
  testMatch: ['src/**/*.spec.ts', 'tests/**/*.spec.ts'],
  timeout: 90000,
  outputDir: path.resolve(__dirname, 'runs'),
  use: {
    baseURL: COCKPIT_URL,
    // Enable video: 'on' for every test - HARD REQUIREMENT: every scenario needs a video artifact
    video: 'on',
    // Enable trace: 'on' for detailed step and network inspection
    trace: 'on',
  },
  projects: [
    {
      name: 'desktop',
      use: {
        viewport: { width: 1280, height: 800 },
      },
      outputDir: path.resolve(__dirname, 'runs', 'desktop'),
    },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
      },
      outputDir: path.resolve(__dirname, 'runs', 'mobile'),
    },
  ],
});
