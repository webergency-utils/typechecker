#!/bin/bash -eu

npm install
npm install --save-dev @jazzer.js/core
npm run build:fuzz

compile_javascript_fuzzer typechecker fuzz/typechecker.cjs
