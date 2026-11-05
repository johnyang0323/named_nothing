/** Shared settings for the browser tests. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.E2E_OUT || path.join(__dirname, '.output', 'shots');
fs.mkdirSync(OUT, { recursive: true });

/** PW_CHROMIUM lets a machine point at its own Chromium build. */
const launch = (options = {}) =>
  chromium.launch({ ...options, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });

module.exports = { ROOT, OUT, launch };
