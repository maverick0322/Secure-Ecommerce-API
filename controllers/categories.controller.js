const { Category } = require('../models');
const { AccountError } = require('../services/accounts.service');
const catalog = require('../services/catalog.service');

const serialize = category => ({ categoryId: category.id, name: category.name, protected: category.protected });

async function getAll(req, res) {
  try { return res.json((await Category.findAll({ order: [['name', 'ASC']] })).map(serialize)); }
  catch (error) { return catalog.catalogError(res, error); }
}

async function get(req, res) {
  try {
    const category = await Category.findByPk(catalog.positiveId(req.params.id));
    if (!category) throw new AccountError(404, 'Categoría no encontrada.');
    return res.json(serialize(category));
  } catch (error) { return catalog.catalogError(res, error); }
}

async function create(req, res) {
  try {
    const category = await catalog.mutateCategory(req.account, null, catalog.categoryInput(req.body), false, {ipAddress:req.ip});
    return res.status(201).json(serialize(category));
  } catch (error) { return catalog.catalogError(res, error); }
}

async function update(req, res) {
  try {
    const id = catalog.positiveId(req.params.id);
    await catalog.mutateCategory(req.account, id, catalog.categoryInput(req.body));
    return res.status(204).end();
  } catch (error) { return catalog.catalogError(res, error); }
}

async function remove(req, res) {
  try {
    const id = catalog.positiveId(req.params.id);
    await catalog.mutateCategory(req.account, id, undefined, true, {ipAddress:req.ip});
    return res.status(204).end();
  } catch (error) { return catalog.catalogError(res, error); }
}

module.exports = { getAll, get, create, update, remove };
