const express = require('express');
const request = require('supertest');
const { upload, validateImage, uploadErrorHandler, MAX_IMAGE_BYTES } = require('../../middlewares/upload.middleware');

const app = express().put('/image', upload.single('image'), uploadErrorHandler, validateImage, (req, res) => res.json({ size: req.file.buffer.length }));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');

it('accepts an in-memory PNG', async () => {
  expect((await request(app).put('/image').attach('image', png, 'fixture.png')).body).toEqual({ size: png.length });
});
it('rejects spoofed MIME content, unsupported formats and missing files', async () => {
  expect((await request(app).put('/image').attach('image', Buffer.from('not an image'), 'fixture.png')).status).toBe(400);
  expect((await request(app).put('/image').attach('image', Buffer.from('<svg/>'), 'fixture.svg')).status).toBe(400);
  expect((await request(app).put('/image')).status).toBe(400);
});
it('rejects oversized or multiple files and unexpected fields', async () => {
  expect((await request(app).put('/image').attach('image', Buffer.alloc(MAX_IMAGE_BYTES + 1), 'fixture.png')).status).toBe(413);
  expect((await request(app).put('/image').attach('image', png, 'a.png').attach('image', png, 'b.png')).status).toBe(400);
  expect((await request(app).put('/image').field('sellerId', 'injected').attach('image', png, 'a.png')).status).toBe(400);
});
