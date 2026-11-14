'use strict';
// Run the existing assert-based safety cases under Jest as well as node:test.
// This instruments the actual comparator without duplicating its fixtures.
jest.mock('node:test',()=>({test:(name,work)=>{global.test(name,work);return Promise.resolve();}}));
require('../../postman/scripts/container-metadata.check.cjs');
