#!/usr/bin/env node
'use strict';

require('../src/cli/index.js')
  .main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
