const catalog = require('../services/catalog.service');
const images = require('../services/product-images.service');
const cloud = require('../services/cloudinary.service');
const { AccountError } = require('../services/accounts.service');

function serialize(product) {
  return { productId: product.id, sellerId: product.sellerId, title: product.title, description: product.description ?? null,
    price: String(product.price), stock: product.stock, imagePublicId: product.imagePublicId ?? null,
    imageUrl: cloud.deliveryUrl(product.imagePublicId), categories: (product.categories || []).map(category =>
      ({ categoryId: category.id, name: category.name, protected: category.protected })) };
}

async function getAll(req, res) {
  try { return res.json((await catalog.listProducts(req.query.s)).map(serialize)); } catch (error) { return catalog.catalogError(res, error); }
}

async function get(req, res) {
  try { return res.json(serialize(await catalog.getProduct(catalog.positiveId(req.params.id)))); } catch (error) { return catalog.catalogError(res, error); }
}

async function create(req, res) {
  try {
    const product = await catalog.createProduct(req.account, catalog.productInput(req.body, true), {ipAddress:req.ip});
    return res.status(201).json(serialize(product));
  } catch (error) { return catalog.catalogError(res, error); }
}

async function update(req, res) {
  try {
    const id = catalog.positiveId(req.params.id);
    await catalog.updateProduct(req.account, id, catalog.productInput(req.body), {ipAddress:req.ip});
    return res.status(204).end();
  } catch (error) { return catalog.catalogError(res, error); }
}

async function remove(req, res) {
  try {
    const id = catalog.positiveId(req.params.id);
    await catalog.removeProduct(req.account, id, {ipAddress:req.ip});
    return res.status(204).end();
  } catch (error) { return catalog.catalogError(res, error); }
}

async function assignCategory(req, res) {
  try {
    if (!req.body || Object.keys(req.body).length !== 1) throw new AccountError(400, 'Indique únicamente categoryId.');
    await catalog.changeCategory(req.account, catalog.positiveId(req.params.id), catalog.positiveId(req.body.categoryId), false, {ipAddress:req.ip});
    return res.status(204).end();
  } catch (error) { return catalog.catalogError(res, error); }
}

async function removeCategory(req, res) {
  try {
    await catalog.changeCategory(req.account, catalog.positiveId(req.params.id), catalog.positiveId(req.params.categoryId), true, {ipAddress:req.ip});
    return res.status(204).end();
  } catch (error) { return catalog.catalogError(res, error); }
}

async function checkImageOwner(req, res, next) {
  try {
    await catalog.ownedProduct(catalog.positiveId(req.params.id), req.account.id);
    return next();
  } catch (error) { return catalog.catalogError(res, error); }
}

async function replaceImage(req, res) {
  try {
    if (!req.file || Object.keys(req.body || {}).length) throw new AccountError(400, 'Envíe únicamente una imagen en el campo image.');
    const id = catalog.positiveId(req.params.id);
    const imagePublicId = await images.replace(req.account, id, req.file.buffer, {ipAddress:req.ip});
    return res.json({ productId: id, imagePublicId, imageUrl: cloud.deliveryUrl(imagePublicId) });
  } catch (error) { return catalog.catalogError(res, error); }
}

async function removeImage(req, res) {
  try {
    const id = catalog.positiveId(req.params.id);
    await images.remove(req.account, id, {ipAddress:req.ip});
    return res.status(204).end();
  } catch (error) { return catalog.catalogError(res, error); }
}

module.exports = { getAll, get, create, update, remove, assignCategory, removeCategory, checkImageOwner, replaceImage, removeImage };
