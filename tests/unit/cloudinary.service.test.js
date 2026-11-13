const { PassThrough } = require('node:stream');
const sdk = require('cloudinary').v2;
const cloud = require('../../services/cloudinary.service');

afterEach(() => jest.restoreAllMocks());

it('uses the official signed stream upload with server-owned options', async () => {
  jest.replaceProperty(process, 'env', { ...process.env, CLOUDINARY_CLOUD_NAME: 'synthetic-cloud', CLOUDINARY_API_KEY: 'synthetic-key', CLOUDINARY_API_SECRET: 'synthetic-secret' });
  const upload = jest.spyOn(sdk.uploader, 'upload_stream').mockImplementation((options, callback) => {
    const stream = new PassThrough();
    stream.on('data', () => {});
    stream.on('end', () => callback(null, { public_id: options.public_id, format: 'png' }));
    return stream;
  });
  await expect(cloud.upload(Buffer.from('fixture'), 'server-owned-id', 7)).resolves.toEqual({ public_id: 'server-owned-id', format: 'png' });
  expect(upload.mock.calls[0][0]).toMatchObject({ public_id: 'server-owned-id', overwrite: false, resource_type: 'image',
    allowed_formats: ['jpg', 'png', 'webp'], context: { catalog_owner: 'secure-ecommerce-api', product_id: '7' } });
});

it('requires explicit credentials and builds delivery URLs without private keys', () => {
  jest.replaceProperty(process, 'env', { ...process.env, CLOUDINARY_CLOUD_NAME: 'synthetic-cloud', CLOUDINARY_API_KEY: '', CLOUDINARY_API_SECRET: '' });
  expect(() => cloud.credentials()).toThrow('no está configurado');
  const url = cloud.deliveryUrl('products/example');
  expect(url).toMatch(/^https:\/\/res\.cloudinary\.com\/synthetic-cloud\/image\/upload\//);
  expect(url).not.toContain('api_key');
});
