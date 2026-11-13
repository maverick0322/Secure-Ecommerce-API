'use strict';
const { completeSpecification } = require('../../services/swagger-contract.service');
it('documents all address routes with JWT, ownership and whitelisted input', () => {
  const spec = completeSpecification({ paths:{} });
  for (const [path,method] of [['/api/addresses','get'],['/api/addresses','post'],['/api/addresses/{id}','put'],
    ['/api/addresses/{id}','delete'],['/api/addresses/{id}/default','put']]) {
    const operation = spec.paths[path][method];
    expect(operation.security).toEqual([{bearerAuth:[]}]);
    expect(operation.description).toContain('BUYER');
    for (const status of [401,403,500]) expect(operation.responses[status]).toBeDefined();
  }
  const input = spec.paths['/api/addresses'].post.parameters[0].schema;
  expect(input.additionalProperties).toBe(false);
  expect(input.properties).not.toHaveProperty('buyerId');
  expect(input.required).toContain('recipientName');
  expect(spec.paths['/api/addresses/{id}'].put.parameters[0].type).toBe('string');
  expect(spec.definitions.UserAddress.properties.id.type).toBe('string');
});
