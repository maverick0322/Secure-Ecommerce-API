'use strict';
const {completeSpecification}=require('../../services/swagger-contract.service');
const {build}=require('../../postman/scripts/build-collection');
it('documents profile ownership, isolated OTP contracts and the new real password limits',()=>{
  const spec=completeSpecification({paths:{},definitions:{}});
  for(const [path,method,auth]of [['/api/users/me','get',true],['/api/users/me','put',true],['/api/users/me/password','put',true],['/api/auth/password/forgot','post',false],['/api/auth/password/reset','post',false]]){
    const operation=spec.paths[path][method];expect(operation.security.length>0).toBe(auth);expect(operation.responses[500]).toBeDefined();
  }
  const registration=spec.paths['/api/auth/register'].post.parameters[0].schema;
  expect(registration.required).toEqual(expect.arrayContaining(['profile','name','email','password']));
  expect(registration.properties.password).toMatchObject({minLength:8,maxLength:128,'x-max-utf8-bytes':512});
  expect(registration.properties.password.description).toContain('una letra, un número');
  expect(spec.paths['/api/auth/register'].post.responses[409]).toBeDefined();
  const creation=spec.paths['/api/products'].post.parameters[0].schema;
  expect(creation.properties.categoryId).toMatchObject({type:'integer',minimum:1,maximum:2147483647});
  expect(creation.required).not.toContain('categoryId');
  expect(spec.paths['/api/products/{id}'].put.parameters.find(p=>p.in==='body').schema.properties).not.toHaveProperty('categoryId');
  expect(spec.paths['/api/auth/register/verify'].post.parameters[0].schema.required).toEqual(['email','code']);
});
it('keeps Postman aligned without removing its isolation guard',()=>{
  const collection=build(),requests=collection.item.flatMap(folder=>folder.item);
  for(const path of ['/api/users/me','/api/users/me/password','/api/auth/password/forgot','/api/auth/password/reset'])expect(requests.some(item=>JSON.stringify(item.request.url).includes(path))).toBe(true);
  expect(collection.event[0].script.exec.join('\n')).toContain('isolation');
  const registration=requests.find(item=>item.name==='Solicitar verificacion simulada');
  expect(JSON.parse(registration.request.body.raw)).toMatchObject({profile:'BUYER',password:'{{registrationPassword}}'});
});
