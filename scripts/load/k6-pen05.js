import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://k6-pen05-api:3000';
const BUYER_EMAIL = __ENV.BUYER_EMAIL;
const BUYER_PASSWORD = __ENV.BUYER_PASSWORD;
const PRODUCT_ID = Number(__ENV.PRODUCT_ID || 1);
const ADDRESS_ID = String(__ENV.ADDRESS_ID || '1');
const LOCKOUT_EMAIL = __ENV.LOCKOUT_EMAIL;
const LOCKOUT_PASSWORD = __ENV.LOCKOUT_PASSWORD;

const loginDuration = new Trend('login_duration', true);
const healthDuration = new Trend('health_duration', true);
const catalogReadDuration = new Trend('catalog_read_duration', true);
const catalogSearchDuration = new Trend('catalog_search_duration', true);
const checkoutFlowDuration = new Trend('checkout_flow_duration', true);

const bruteforce401 = new Counter('bruteforce_401');
const bruteforce429 = new Counter('bruteforce_429');
const bruteforceRetryAfter = new Counter('bruteforce_retry_after');
const server5xx = new Counter('server_5xx');

export const options = {
  scenarios: {
    nominal_catalog_and_health: {
      executor: 'constant-vus',
      exec: 'nominalCatalogAndHealth',
      vus: 3,
      duration: '20s',
      startTime: '0s',
      gracefulStop: '5s'
    },
    nominal_checkout: {
      executor: 'per-vu-iterations',
      exec: 'nominalCheckout',
      vus: 1,
      iterations: 5,
      startTime: '22s',
      maxDuration: '30s'
    },
    login_bruteforce_containment: {
      executor: 'per-vu-iterations',
      exec: 'loginBruteforceContainment',
      vus: 1,
      iterations: 12,
      startTime: '35s',
      maxDuration: '30s'
    }
  },
  thresholds: {
    catalog_read_duration: ['p(95)<500'],
    catalog_search_duration: ['p(95)<500'],
    checkout_flow_duration: ['p(95)<1500'],
    login_duration: ['p(95)<1500'],
    bruteforce_429: ['count>=5'],
    bruteforce_retry_after: ['count>=5'],
    server_5xx: ['count==0']
  }
};

function recordServerError(res) {
  if (res.status >= 500 || res.status === 0) {
    server5xx.add(1);
  }
}

export function setup() {
  if (!BUYER_EMAIL || !BUYER_PASSWORD || !LOCKOUT_EMAIL || !LOCKOUT_PASSWORD) {
    throw new Error('Missing required k6 __ENV test account parameters.');
  }

  const tokens = [];
  for (let i = 0; i < 3; i += 1) {
    const res = http.post(
      `${BASE_URL}/api/auth`,
      JSON.stringify({ email: BUYER_EMAIL, password: BUYER_PASSWORD }),
      { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login' } }
    );
    recordServerError(res);
    loginDuration.add(res.timings.duration);

    const ok = check(res, {
      'setup login is 200': r => r.status === 200,
      'setup login returns jwt': r => Boolean(r.json('jwt'))
    });
    if (!ok) {
      throw new Error(`Setup login failed with status ${res.status}`);
    }
    tokens.push(res.json('jwt'));
  }

  return { tokens };
}

export function nominalCatalogAndHealth(data) {
  const token = data.tokens[(__VU - 1) % data.tokens.length];
  const authHeaders = { Authorization: `Bearer ${token}` };

  const healthRes = http.get(`${BASE_URL}/health`, { tags: { endpoint: 'health' } });
  recordServerError(healthRes);
  healthDuration.add(healthRes.timings.duration);
  check(healthRes, { 'health 200': r => r.status === 200 });

  const listRes = http.get(`${BASE_URL}/api/products`, {
    headers: authHeaders,
    tags: { endpoint: 'products_list' }
  });
  recordServerError(listRes);
  catalogReadDuration.add(listRes.timings.duration);
  check(listRes, {
    'catalog list 200': r => r.status === 200,
    'catalog list non-empty': r => Array.isArray(r.json()) && r.json().length > 0
  });

  const searchRes = http.get(`${BASE_URL}/api/products?s=Laptop`, {
    headers: authHeaders,
    tags: { endpoint: 'products_search' }
  });
  recordServerError(searchRes);
  catalogSearchDuration.add(searchRes.timings.duration);
  check(searchRes, { 'catalog search 200': r => r.status === 200 });

  sleep(0.6);
}

export function nominalCheckout(data) {
  const token = data.tokens[0];
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  const started = Date.now();

  const cartRes = http.post(
    `${BASE_URL}/api/cart/items`,
    JSON.stringify({ productId: PRODUCT_ID, quantity: 1 }),
    { headers, tags: { endpoint: 'cart_add' } }
  );
  recordServerError(cartRes);
  check(cartRes, { 'cart add 200/201': r => r.status === 200 || r.status === 201 });

  const quoteRes = http.post(
    `${BASE_URL}/api/checkout/quote`,
    JSON.stringify({ addressId: ADDRESS_ID }),
    { headers, tags: { endpoint: 'checkout_quote' } }
  );
  recordServerError(quoteRes);
  const hasQuote = check(quoteRes, {
    'checkout quote 200': r => r.status === 200,
    'checkout quote token present': r => Boolean(r.json('quote'))
  });

  if (hasQuote) {
    const confirmRes = http.post(
      `${BASE_URL}/api/checkout`,
      JSON.stringify({ quote: quoteRes.json('quote') }),
      { headers, tags: { endpoint: 'checkout_confirm' } }
    );
    recordServerError(confirmRes);
    check(confirmRes, { 'checkout confirm 201': r => r.status === 201 });
  }

  checkoutFlowDuration.add(Date.now() - started);
  sleep(0.3);
}

export function loginBruteforceContainment() {
  const res = http.post(
    `${BASE_URL}/api/auth`,
    JSON.stringify({ email: LOCKOUT_EMAIL, password: LOCKOUT_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login_bruteforce' } }
  );
  recordServerError(res);

  if (res.status === 401) {
    bruteforce401.add(1);
  } else if (res.status === 429) {
    bruteforce429.add(1);
    const retryAfter = res.headers['Retry-After'] || res.headers['retry-after'];
    if (retryAfter) {
      bruteforceRetryAfter.add(1);
    }
  }

  check(res, { 'bruteforce status 401 or 429': r => r.status === 401 || r.status === 429 });
}
