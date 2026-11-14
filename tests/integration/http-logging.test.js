'use strict';
const express=require('express'),request=require('supertest');
const logger=require('../../services/structured-logger.service');
const {createHttpLogger}=require('../../middlewares/http-logging.middleware');
const auditMiddleware=require('../../middlewares/audit-logs.middleware');
const audit=require('../../services/audit.service');
const {AuditLog}=require('../../models');
const {isUuid}=require('../../validators/uuid');
const id='00000000-0000-4000-8000-000000000001';
let records,app;
beforeEach(()=>{
  records=[];jest.spyOn(logger,'log').mockImplementation((event,data)=>records.push({event,...data}));
  jest.spyOn(AuditLog,'create').mockResolvedValue({});
  app=express();app.set('trust proxy',false);app.use(createHttpLogger());app.use(auditMiddleware);app.use(express.json());
  const router=express.Router();
  router.get('/:email',(req,res)=>{req.account={id};res.json({ok:true});});app.use('/api/users',router);
  app.get('/ok',(req,res)=>res.json({ok:true}));
  for(const status of [401,403,429,500])app.get('/status/'+status,(req,res)=>res.status(status).json({status}));
  app.get('/explicit-denial',async(req,res)=>{await req.logAudit('auth.login.denied',null,null,'DENIED');res.status(401).end();});
  app.get('/critical',async(req,res,next)=>{try{await audit.business(id,'order.create','order','1',{});res.end();}catch(error){next(error);}});
  app.get('/error',()=>{throw new Error('password=synthetic-private-error');});
  app.use((req,res)=>res.status(404).end());
  app.use(require('../../middlewares/errorhandler.middleware'));
});
afterEach(()=>jest.restoreAllMocks());
it('logs one normalized request with the authenticated actor; ignores proxy and correlation headers',async()=>{
  await request(app).get('/api/users/private@example.invalid?token=synthetic').set('Authorization','Bearer synthetic')
    .set('Cookie','sid=synthetic').set('X-Forwarded-For','203.0.113.5').set('X-Request-ID',id).expect(200);
  const rows=records.filter(r=>r.event==='http.request');expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({userId:id,route:'/api/users/:email',statusCode:200,completed:true});
  expect(isUuid(rows[0].requestId)).toBe(true);expect(rows[0].requestId).not.toBe(id);
  expect(rows[0].ipAddress).not.toBe('203.0.113.5');expect(JSON.stringify(records)).not.toContain('synthetic');
  expect(AuditLog.create).not.toHaveBeenCalled();
});
it.each([401,403,429,500])('logs status %d once and only audits authorization denials',async status=>{
  await request(app).get('/status/'+status).expect(status);
  expect(records.filter(r=>r.event==='http.request')).toHaveLength(1);
  expect(records[0].statusCode).toBe(status);
  if([401,403].includes(status))expect(AuditLog.create).toHaveBeenCalledWith(expect.objectContaining({outcome:'DENIED',actorUserId:null}),{});
  else expect(AuditLog.create).not.toHaveBeenCalled();
});
it('does not duplicate explicit denial events',async()=>{
  await request(app).get('/explicit-denial').expect(401);expect(AuditLog.create).toHaveBeenCalledTimes(1);
});
it('covers parser errors, unknown URLs and thrown errors without bodies, raw URLs or Error content',async()=>{
  await request(app).post('/secret-path?token=synthetic').set('Content-Type','application/json').send('{').expect(400);
  await request(app).get('/private-unknown?otp=synthetic').expect(404);
  await request(app).get('/error').expect(500);
  expect(records.filter(r=>r.event==='http.request')).toHaveLength(3);
  const text=JSON.stringify(records);expect(text).not.toContain('synthetic');expect(text).not.toContain('private-unknown');
});
it('correlates audit failures and preserves critical failure while a denial remains denied',async()=>{
  AuditLog.create.mockRejectedValue(new Error('password=synthetic-private-database'));
  await request(app).get('/critical').expect(500);
  await request(app).get('/status/403').expect(403);
  const failures=records.filter(r=>r.event==='audit.write.failed');
  expect(failures.map(r=>r.critical)).toEqual([true,false]);
  expect(JSON.stringify(records)).not.toContain('synthetic');
});
it('isolates concurrent request contexts and prevents spoofing the actor or audit requestId',async()=>{
  app=express();app.use(createHttpLogger());app.use(express.json());
  app.post('/write',async(req,res)=>{await new Promise(resolve=>setImmediate(resolve));
    await audit.write({action:'test.write',details:{requestId:'spoofed',password:req.body.password}});res.end();});
  await Promise.all([1,2].map(()=>request(app).post('/write').send({userId:id,password:'synthetic'}).expect(200)));
  const rows=records.filter(r=>r.event==='http.request');expect(new Set(rows.map(r=>r.requestId)).size).toBe(2);
  for(const [event]of AuditLog.create.mock.calls){expect(event.actorUserId).toBeNull();
    expect(rows.some(r=>r.requestId===event.details.requestId)).toBe(true);expect(event.details.password).toBeUndefined();}
});
it('does not change the HTTP result if the logging transport throws',async()=>{
  app=express();app.use(createHttpLogger({log:()=>{throw new Error('synthetic');}}));app.get('/',(req,res)=>res.json({ok:true}));
  await request(app).get('/').expect(200,{ok:true});expect(records.some(r=>r.event==='logging.failed')).toBe(true);
});
it('records a disconnected request only once with no invented response status',()=>{
  const {EventEmitter}=require('node:events'),res=new EventEmitter();
  const req={method:'GET',ip:'127.0.0.1',url:'/private?secret=synthetic'};
  createHttpLogger()(req,res,()=>{});res.emit('close');res.emit('finish');
  expect(records).toHaveLength(1);expect(records[0]).toMatchObject({statusCode:null,completed:false,route:'unmatched'});
});
it('logs a real rate limiter rejection without amplifying it into a SQL audit write',async()=>{
  app=express();app.use(createHttpLogger());app.use(auditMiddleware);
  app.post('/limited',require('../../middlewares/auth-rate-limit.middleware')({max:1}),(req,res)=>res.status(204).end());
  await request(app).post('/limited').expect(204);
  await request(app).post('/limited').expect(429);
  expect(records.filter(r=>r.event==='http.request').map(r=>r.statusCode)).toEqual([204,429]);
  expect(AuditLog.create).not.toHaveBeenCalled();
});
