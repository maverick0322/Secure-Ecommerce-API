const cloudinary = require('cloudinary').v2;
const { AccountError } = require('./accounts.service');

function credentials() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new AccountError(503, 'El servicio de imágenes no está configurado.');
  }
  return { cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true };
}

function upload(buffer, publicId, productId) {
  const options = credentials();
  return new Promise((resolve, reject) => {
    function fail(error) {
      reject(error instanceof Error ? error : new Error('Image upload failed.'));
    }
    try {
    const stream = cloudinary.uploader.upload_stream({ ...options, public_id: publicId, resource_type: 'image', type: 'upload',
      overwrite: false, allowed_formats: ['jpg', 'png', 'webp'], timeout: 30000,
      context: { catalog_owner: 'secure-ecommerce-api', product_id: String(productId) } },
    (error, result) => error ? fail(error) : resolve(result));
    stream.on('error', fail);
    stream.end(buffer);
    } catch (error) { fail(error); }
  });
}

async function inspect(publicId) {
  try {
    return await cloudinary.api.resource(publicId, { ...credentials(), resource_type: 'image', type: 'upload', context: true, timeout: 30000 });
  } catch (error) {
    if (error.http_code === 404 || error.error?.http_code === 404) return null;
    throw error;
  }
}

async function destroy(publicId) {
  const result = await cloudinary.uploader.destroy(publicId, { ...credentials(), resource_type: 'image', type: 'upload', invalidate: true, timeout: 30000 });
  if (!['ok', 'not found'].includes(result.result)) throw new Error('Image deletion was not confirmed');
}

function deliveryUrl(publicId) {
  if (!publicId || !process.env.CLOUDINARY_CLOUD_NAME) return null;
  return cloudinary.url(publicId, { cloud_name: process.env.CLOUDINARY_CLOUD_NAME, secure: true, resource_type: 'image', type: 'upload' });
}

module.exports = { credentials, upload, inspect, destroy, deliveryUrl };
