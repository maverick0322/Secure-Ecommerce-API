'use strict';
const isolated = process.env.RUN_STAGE2_REDIS === '1' ? describe : describe.skip;
isolated('Stage 2 sessions with real disposable Redis', () => {
  jest.setTimeout(120000);
  it('checks rotation, reuse, concurrency, deadlines, revocation and fenced recovery', async () => {
    const result = await require('../../scripts/database/stage2-redis-test').main();
    expect(result.success).toBe(true); expect(result.cleanup).toBe(true);
  });
});
