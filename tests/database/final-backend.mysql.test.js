'use strict';
const isolated=process.env.RUN_STAGE5_MYSQL==='1' ? describe : describe.skip;
isolated('Final backend HTTP with isolated MySQL and application SQL grants',()=>{
  jest.setTimeout(180000);
  it('verifies addresses, cart, audit, checkout, replay, stock races, rollback and history',async()=>{
    await require('../../scripts/database/stage5-addresses-test').main();
  });
});
