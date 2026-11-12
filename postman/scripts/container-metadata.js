'use strict';

// Docker mount and port-binding lists have no semantic ordering. Retain every
// value and duplicate; normalize only those lists and JSON object key order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function ordered(values) {
  return values.map(canonical).sort((a, b) => {
    const left = JSON.stringify(a), right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function normalize(snapshot) {
  if (!snapshot) return snapshot;
  const result = canonical(snapshot);
  if (Array.isArray(result.mounts)) result.mounts = ordered(result.mounts);
  if (result.ports && typeof result.ports === 'object') {
    for (const key of Object.keys(result.ports)) {
      if (Array.isArray(result.ports[key])) result.ports[key] = ordered(result.ports[key]);
    }
  }
  return result;
}

function compare(before, after) {
  const initial = normalize(before), final = normalize(after);
  const differences = [];
  if (!initial || !final) {
    if (initial !== final) differences.push('containerPresence');
  } else {
    for (const key of new Set([...Object.keys(initial), ...Object.keys(final)])) {
      if (JSON.stringify(initial[key]) !== JSON.stringify(final[key])) differences.push(key);
    }
  }
  return { unchanged: differences.length === 0, differences, before, after };
}

module.exports = { compare };
