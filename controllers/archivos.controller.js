const { archivo } = require('../models');
const fs = require('fs');
const path = require('path');

const self = {};
const uploadsDir = path.resolve(__dirname, '../uploads');

// GET: api/archivos
self.getAll = async function (req, res, next) {
  try {
    const data = await archivo.findAll({
      attributes: [['id', 'archivoId'], 'mime', 'indb', 'nombre', 'size']
    });
    return res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

// GET: api/archivos/:id/detalle
self.getDetalle = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await archivo.findByPk(id, {
      attributes: [['id', 'archivoId'], 'mime', 'indb', 'nombre', 'size']
    });

    if (data) {
      return res.status(200).json(data);
    }
    return res.status(404).json({ mensaje: 'Archivo no encontrado.' });
  } catch (error) {
    next(error);
  }
};

// GET: api/archivos/:id
self.get = async function (req, res, next) {
  try {
    const id = req.params.id;
    const data = await archivo.findByPk(id);

    if (!data) {
      return res.status(404).json({ mensaje: 'Archivo no encontrado.' });
    }

    let contenidoBinario = data.datos;

    // Si no está almacenado en base de datos, leer del sistema de archivos
    if (!data.indb) {
      const filePath = path.join(uploadsDir, data.nombre);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ mensaje: 'El archivo físico no existe en el almacenamiento.' });
      }
      contenidoBinario = fs.readFileSync(filePath);
    }

    return res.status(200).contentType(data.mime).send(contenidoBinario);
  } catch (error) {
    next(error);
  }
};

// POST: api/archivos
self.create = async function (req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ mensaje: 'El archivo es obligatorio en el campo file.' });
    }

    let binario = null;
    let indb = false;
    const filePath = path.join(uploadsDir, req.file.filename);

    if (process.env.FILES_IN_BD === 'true') {
      if (fs.existsSync(filePath)) {
        binario = fs.readFileSync(filePath);
        fs.unlinkSync(filePath); // Eliminar archivo físico una vez transferido a BLOB
        indb = true;
      }
    }

    const data = await archivo.create({
      mime: req.file.mimetype,
      indb: indb,
      nombre: req.file.filename,
      size: req.file.size,
      datos: binario
    });

    if (req.bitacora) {
      await req.bitacora('archivos.crear', data.id);
    }

    return res.status(201).json({
      id: data.id,
      mime: req.file.mimetype,
      indb: indb,
      nombre: req.file.filename
    });
  } catch (error) {
    next(error);
  }
};

// PUT: api/archivos/:id
self.update = async function (req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ mensaje: 'El archivo es obligatorio en el campo file.' });
    }

    const id = req.params.id;
    const archivoPrevio = await archivo.findByPk(id);

    if (!archivoPrevio) {
      // Eliminar el archivo recién subido si el registro a actualizar no existe
      const rutaNuevo = path.join(uploadsDir, req.file.filename);
      if (fs.existsSync(rutaNuevo)) fs.unlinkSync(rutaNuevo);
      return res.status(404).json({ mensaje: 'Archivo no encontrado.' });
    }

    let binario = null;
    let indb = false;
    const nuevoFilePath = path.join(uploadsDir, req.file.filename);

    if (process.env.FILES_IN_BD === 'true') {
      if (fs.existsSync(nuevoFilePath)) {
        binario = fs.readFileSync(nuevoFilePath);
        fs.unlinkSync(nuevoFilePath);
        indb = true;
      }
    }

    await archivo.update(
      {
        mime: req.file.mimetype,
        indb: indb,
        nombre: req.file.filename,
        size: req.file.size,
        datos: binario
      },
      { where: { id: id } }
    );

    // Limpiar el archivo anterior en disco si no estaba en BD
    if (!archivoPrevio.indb) {
      const rutaAnterior = path.join(uploadsDir, archivoPrevio.nombre);
      if (fs.existsSync(rutaAnterior)) {
        fs.unlinkSync(rutaAnterior);
      }
    }

    if (req.bitacora) {
      await req.bitacora('archivos.editar', id);
    }

    return res.status(204).send();
  } catch (error) {
    next(error);
  }
};

// DELETE: api/archivos/:id
self.delete = async function (req, res, next) {
  try {
    const id = req.params.id;
    const archivoExistente = await archivo.findByPk(id);

    if (!archivoExistente) {
      return res.status(404).json({ mensaje: 'Archivo no encontrado.' });
    }

    const rowsDeleted = await archivo.destroy({ where: { id: id } });
    if (rowsDeleted === 1) {
      // Eliminar el archivo del sistema de ficheros si no estaba en la BD
      if (!archivoExistente.indb) {
        const filePath = path.join(uploadsDir, archivoExistente.nombre);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      if (req.bitacora) {
        await req.bitacora('archivos.eliminar', id);
      }

      return res.status(204).send();
    }

    return res.status(404).json({ mensaje: 'Archivo no encontrado.' });
  } catch (error) {
    next(error);
  }
};

module.exports = self;
