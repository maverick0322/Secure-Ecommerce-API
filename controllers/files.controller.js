const {
  File: fileModel
} = require('../models');
const fs = require('fs');
const path = require('path');
const self = {};
const uploadsDir = path.resolve(__dirname, '../uploads');

// GET: api/files
self.getAll = async function (req, res, next) {
  try {
    const data = await fileModel.findAll({
      attributes: [['id', "fileId"], 'mime', "storedInDatabase", "name", 'size']
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

// GET: api/files/:id/details
self.getDetails = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await fileModel.findByPk(id, {
      attributes: [['id', "fileId"], 'mime', "storedInDatabase", "name", 'size']
    });
    if (data) {
      return res.status(200).json(data);
    }
    return res.status(404).json({
      message: 'Archivo no encontrado.'
    });
  } catch (error) {
    next(error);
  }
};

// GET: api/files/:id
self.get = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await fileModel.findByPk(id);
    if (!data) {
      return res.status(404).json({
        message: 'Archivo no encontrado.'
      });
    }
    let binaryContent = data.data;

    // Si no está almacenado en base de datos, leer del sistema de archivos
    if (!data.storedInDatabase) {
      const filePath = path.join(uploadsDir, data.name);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          message: 'El archivo físico no existe en el almacenamiento.'
        });
      }
      binaryContent = fs.readFileSync(filePath);
    }
    return res.status(200).contentType(data.mime).send(binaryContent);
  } catch (error) {
    next(error);
  }
};

// POST: api/files
self.create = async function (req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: 'El archivo es obligatorio en el campo file.'
      });
    }
    let binaryData = null;
    let storedInDatabase = false;
    const filePath = path.join(uploadsDir, req.file.filename);
    if (process.env.FILES_IN_DB === 'true') {
      if (fs.existsSync(filePath)) {
        binaryData = fs.readFileSync(filePath);
        fs.unlinkSync(filePath); // Eliminar archivo físico una vez transferido a BLOB
        storedInDatabase = true;
      }
    }
    const data = await fileModel.create({
      mime: req.file.mimetype,
      storedInDatabase,
      name: req.file.filename,
      size: req.file.size,
      data: binaryData
    });
    if (req.logAudit) {
      await req.logAudit('archivos.crear', data.id);
    }
    return res.status(201).json({
      id: data.id,
      mime: req.file.mimetype,
      storedInDatabase,
      name: req.file.filename
    });
  } catch (error) {
    next(error);
  }
};

// PUT: api/files/:id
self.update = async function (req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: 'El archivo es obligatorio en el campo file.'
      });
    }
    const id = req.params.id;
    const previousFile = await fileModel.findByPk(id);
    if (!previousFile) {
      // Eliminar el archivo recién subido si el registro a actualizar no existe
      const newPath = path.join(uploadsDir, req.file.filename);
      if (fs.existsSync(newPath)) fs.unlinkSync(newPath);
      return res.status(404).json({
        message: 'Archivo no encontrado.'
      });
    }
    let binaryData = null;
    let storedInDatabase = false;
    const newFilePath = path.join(uploadsDir, req.file.filename);
    if (process.env.FILES_IN_DB === 'true') {
      if (fs.existsSync(newFilePath)) {
        binaryData = fs.readFileSync(newFilePath);
        fs.unlinkSync(newFilePath);
        storedInDatabase = true;
      }
    }
    await fileModel.update({
      mime: req.file.mimetype,
      storedInDatabase,
      name: req.file.filename,
      size: req.file.size,
      data: binaryData
    }, {
      where: {
        id: id
      }
    });

    // Limpiar el archivo anterior en disco si no estaba en BD
    if (!previousFile.storedInDatabase) {
      const previousPath = path.join(uploadsDir, previousFile.name);
      if (fs.existsSync(previousPath)) {
        fs.unlinkSync(previousPath);
      }
    }
    if (req.logAudit) {
      await req.logAudit('archivos.editar', id);
    }
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// DELETE: api/files/:id
self.delete = async function (req, res, next) {
  try {
    const id = req.params.id;
    const existingFile = await fileModel.findByPk(id);
    if (!existingFile) {
      return res.status(404).json({
        message: 'Archivo no encontrado.'
      });
    }
    const rowsDeleted = await fileModel.destroy({
      where: {
        id: id
      }
    });
    if (rowsDeleted === 1) {
      // Eliminar el archivo del sistema de ficheros si no estaba en la BD
      if (!existingFile.storedInDatabase) {
        const filePath = path.join(uploadsDir, existingFile.name);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
      if (req.logAudit) {
        await req.logAudit('archivos.eliminar', id);
      }
      return res.status(204).send();
    }
    return res.status(404).json({
      message: 'Archivo no encontrado.'
    });
  } catch (error) {
    next(error);
  }
};
module.exports = self;
