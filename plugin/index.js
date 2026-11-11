'use strict';

const mod = require( '../dist/plugin.cjs' );
module.exports = typeof mod === 'function' ? mod : ( mod.default || mod );
