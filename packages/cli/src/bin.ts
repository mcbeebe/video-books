#!/usr/bin/env node
import { run } from './main.js';

const code = await run({ argv: process.argv, logger: console });
process.exit(code);
