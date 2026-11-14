'use strict';
const {createLogger,context}=require('../../services/structured-logger.service');
const id='00000000-0000-4000-8000-000000000001';
it('serializes only allowlisted metadata and uses a trusted correlation context',()=>{
  const lines=[],logger=createLogger({sink:line=>lines.push(JSON.parse(line))});
  context.run({requestId:id},()=>logger.log('audit.write.failed',{action:'order.create',transactional:true,critical:true,
    password:'synthetic',error:new Error('synthetic secret'),requestId:'spoofed',details:{token:'synthetic'}}));
  expect(lines).toEqual([{timestamp:expect.any(String),level:'error',event:'audit.write.failed',requestId:id,
    action:'order.create',transactional:true,critical:true}]);
});
it.each([200,401,403,429,500])('logs status %d with safe severity, anonymous identity and JSON encoding',statusCode=>{
  const sink=jest.fn(),logger=createLogger({sink});
  logger.log('http.request',{requestId:id,method:'GET',route:'/api/users/:email',statusCode,durationMs:1.23456,completed:true,
    userId:'spoofed',ipAddress:'203.0.113.4',body:{password:'synthetic'},url:'/?token=synthetic',headers:{cookie:'synthetic'}});
  const record=JSON.parse(sink.mock.calls[0][0]);
  expect(record).toMatchObject({requestId:id,userId:null,ipAddress:'203.0.113.4',durationMs:1.235,statusCode,
    level:statusCode>=500?'error':statusCode>=400?'warn':'info'});
  expect(sink.mock.calls[0][0]).not.toContain('synthetic');
});
it('rejects untrusted or malformed technical fields without serializing them',()=>{
  const sink=jest.fn(),logger=createLogger({sink});
  logger.log('http.request',{requestId:'secret',method:'BAD\nsecret',route:'/secret?token=secret',statusCode:Infinity,durationMs:NaN,ipAddress:'secret'});
  expect(JSON.parse(sink.mock.calls[0][0])).toMatchObject({requestId:null,method:'OTHER',route:'unmatched',statusCode:null,durationMs:null,ipAddress:null,completed:false});
  logger.log('unknown.event',{secret:'secret'});expect(sink).toHaveBeenCalledTimes(1);
});
it.each(['throw','reject','fallback-throw'])('logging failure stays bounded and never propagates: %s',async kind=>{
  const error=new Error('synthetic secret'),fallback=jest.fn(()=>{if(kind==='fallback-throw')throw error;});
  const sink=()=>{if(kind==='reject')return Promise.reject(error);throw error;};
  const logger=createLogger({sink,fallback});
  expect(()=>logger.log('api.started')).not.toThrow();await Promise.resolve();
  expect(logger.failureCount()).toBeGreaterThan(0);expect(fallback).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fallback.mock.calls[0][0]).event).toBe('logging.failed');
  expect(fallback.mock.calls[0][0]).not.toContain('synthetic');
});
