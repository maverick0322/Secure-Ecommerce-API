'use strict';
const limiter=require('../../middlewares/auth-rate-limit.middleware');
function response(){const res={set:jest.fn(),status:jest.fn(),json:jest.fn()};res.status.mockReturnValue(res);return res;}
it('limits attempts, supplies Retry-After and resets after expiration',()=>{
 let now=0;const limit=limiter({max:2,windowMs:1000,now:()=>now});const res=response(),next=jest.fn();
 for(let i=0;i<3;i++)limit({ip:'127.0.0.1'},res,next);
 expect(next).toHaveBeenCalledTimes(2);expect(res.status).toHaveBeenCalledWith(429);expect(res.set).toHaveBeenCalledWith('Retry-After','1');
 now=1001;limit({ip:'127.0.0.1'},res,next);expect(next).toHaveBeenCalledTimes(3);
});
it('bounds memory and reclaims expired keys instead of growing without limit',()=>{
 let now=0;const limit=limiter({maxKeys:1,windowMs:1000,now:()=>now});const res=response(),next=jest.fn();
 limit({ip:'first'},res,next);limit({ip:'second'},res,next);expect(next).toHaveBeenCalledTimes(1);expect(res.status).toHaveBeenCalledWith(429);
 now=1001;limit({ip:'second'},res,next);expect(next).toHaveBeenCalledTimes(2);
});
