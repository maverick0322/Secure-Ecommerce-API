'use strict';

jest.mock('../../models', () => require('../support/image-phase2-fixture').makeModels());
const { PassThrough } = require('node:stream');
const https = require('node:https');
const sdk = require('cloudinary').v2;
const cloud = require('../../services/cloudinary.service');
const scope = { version:1,id:'11111111-1111-4111-8111-111111111111',binding:'a'.repeat(64) };
beforeEach(() => {
  jest.replaceProperty(process, 'env', { ...process.env, CLOUDINARY_CLOUD_NAME: 'synthetic',
    CLOUDINARY_API_KEY: 'synthetic', CLOUDINARY_API_SECRET: 'synthetic' });
  jest.spyOn(https, 'request').mockImplementation(() => { throw new Error('External network forbidden'); });
});
afterEach(() => jest.restoreAllMocks());

it.each([400, 401, 403, 429, 500, 503])('C11-%i SDK retains safe classification without copying provider payload', async status => {
  jest.spyOn(sdk.uploader, 'upload_stream').mockImplementation((options, callback) => {
    const stream = new PassThrough(); stream.resume();
    stream.on('finish', () => callback({ message: 'SYNTHETIC_PROVIDER_DIAGNOSTIC', http_code: status })); return stream;
  });
  const outcome = await cloud.upload(Buffer.from('synthetic'), 'synthetic-id', 701, scope).catch(error => error);
  expect(outcome).toBeInstanceOf(Error); expect(outcome.message).toBe('Image upload failed.');
  expect(outcome.http_code).toBeUndefined(); expect(https.request).not.toHaveBeenCalled();
  expect(outcome.imageFailure).toBe(status < 429 ? 'definitive' : status === 429 ? 'transient' : 'uncertain');
});
it('C12 inspect understands nested provider 404', async () => {
  jest.spyOn(sdk.api, 'resource').mockRejectedValueOnce({ error: { http_code: 404, message: 'SYNTHETIC' } });
  await expect(cloud.inspect('synthetic-id')).resolves.toBeNull();
});
it('C13 deletion requires explicit ok/not-found confirmation', async () => {
  jest.spyOn(sdk.uploader, 'destroy').mockResolvedValueOnce({ result: 'unexpected', message: 'SYNTHETIC' });
  await expect(cloud.destroy('synthetic-id')).rejects.toThrow('Image deletion was not confirmed');
});
it('C14 missing configuration prevents any SDK upload', () => {
  process.env.CLOUDINARY_API_SECRET = '';
  const upload = jest.spyOn(sdk.uploader, 'upload_stream');
  expect(() => cloud.upload(Buffer.from('synthetic'), 'synthetic-id', 701)).toThrow('no está configurado');
  expect(upload).not.toHaveBeenCalled();
});
it('C16 bounds an SDK upload without callback and retains uncertain outcome',async () => {
  jest.useFakeTimers();let stream;
  jest.spyOn(sdk.uploader,'upload_stream').mockImplementation(()=>{stream=new PassThrough();stream.resume();return stream;});
  const result=cloud.upload(Buffer.from('synthetic'),'synthetic-id',701,scope).catch(error=>error);
  await jest.advanceTimersByTimeAsync(35000);
  expect(await result).toMatchObject({message:'Image upload failed.',imageFailure:'uncertain'});
  expect(stream.destroyed).toBe(true);jest.useRealTimers();
});
it.each([null,{}, {public_id:'requested',resource_type:'video',type:'upload'}])('C17 rejects malformed inspection %j without exposing provider fields',async result=>{
  jest.spyOn(sdk.api,'resource').mockResolvedValue(result);
  await expect(cloud.inspect('requested')).rejects.toMatchObject({message:'Image inspection failed.',imageFailure:'uncertain'});
});
it('C18 retains definitive inspection/deletion category without provider diagnostics',async()=>{
  jest.spyOn(sdk.api,'resource').mockRejectedValue({http_code:403,message:'SYNTHETIC_PRIVATE'});
  await expect(cloud.inspect('requested')).rejects.toMatchObject({message:'Image inspection failed.',imageFailure:'definitive'});
  jest.spyOn(sdk.uploader,'destroy').mockRejectedValue({http_code:401,message:'SYNTHETIC_PRIVATE'});
  await expect(cloud.destroy('requested')).rejects.toMatchObject({message:'Image deletion failed.',imageFailure:'definitive'});
});
it('C19 null deletion result is controlled rather than TypeError',async()=>{
  jest.spyOn(sdk.uploader,'destroy').mockResolvedValue(null);
  await expect(cloud.destroy('requested')).rejects.toThrow('Image deletion was not confirmed');
});
