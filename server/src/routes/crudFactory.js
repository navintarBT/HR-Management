const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');

// Normalizes raw Mongoose/MongoDB errors (duplicate key, schema validation)
// into clean, user-facing responses instead of a bare 500 with driver internals.
function handleWriteError(err, res, next) {
  if (err && err.code === 11000) {
    return res.status(409).json({ message: 'ຂໍ້ມູນນີ້ມີຢູ່ໃນລະບົບແລ້ວ (ຄ່າຊ້ຳກັບຂໍ້ມູນເກົ່າ)' });
  }
  if (err && err.name === 'ValidationError') {
    const firstError = Object.values(err.errors)[0];
    return res.status(400).json({ message: firstError?.message || 'ຂໍ້ມູນບໍ່ຖືກຕ້ອງ' });
  }
  next(err);
}

// Builds a REST router compatible with @refinedev/simple-rest's data provider
// contract: _start/_end/_sort/_order pagination + X-Total-Count header.
function crudRouter(Model, options = {}) {
  const {
    populate = '',
    writeRoles = ['admin'],
    readRoles = ['admin', 'manager', 'employee'],
    searchFields = [],
    scopeQuery,
    beforeCreate,
    beforeUpdate,
    beforeDelete,
    afterUpdate,
  } = options;

  const router = express.Router();

  router.get('/', authenticate, requireRole(...readRoles), async (req, res, next) => {
    try {
      const { _start = 0, _end = 10, _sort = '_id', _order = 'asc', q, ...filters } = req.query;
      const query = {};

      for (const [key, value] of Object.entries(filters)) {
        if (value === undefined || value === '') continue;
        if (key.endsWith('_gte') || key.endsWith('_lte')) {
          const field = key.replace(/_(gte|lte)$/, '');
          const op = key.endsWith('_gte') ? '$gte' : '$lte';
          query[field] = { ...query[field], [op]: value };
        } else if (key.endsWith('_like')) {
          // @refinedev/simple-rest sends `<field>_like` for the "contains" filter
          // operator (e.g. what useSelect's search box generates by default).
          const field = key.replace(/_like$/, '');
          query[field] = { $regex: value, $options: 'i' };
        } else {
          query[key] = value;
        }
      }

      if (q && searchFields.length) {
        query.$or = searchFields.map((field) => ({ [field]: { $regex: q, $options: 'i' } }));
      }
      if (scopeQuery) scopeQuery(req, query);

      const start = Number(_start) || 0;
      const end = Number(_end) || start + 10;

      const [items, total] = await Promise.all([
        Model.find(query)
          .populate(populate)
          .sort({ [_sort]: _order === 'asc' ? 1 : -1 })
          .skip(start)
          .limit(end - start),
        Model.countDocuments(query),
      ]);

      res.set('X-Total-Count', String(total));
      res.json(items);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', authenticate, requireRole(...readRoles), async (req, res, next) => {
    try {
      const query = { _id: req.params.id };
      if (scopeQuery) scopeQuery(req, query);
      const item = await Model.findOne(query).populate(populate);
      if (!item) return res.status(404).json({ message: 'Not found' });
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', authenticate, requireRole(...writeRoles), async (req, res, next) => {
    try {
      if (beforeCreate) {
        const blockMessage = await beforeCreate(req.body);
        if (blockMessage) return res.status(409).json({ message: blockMessage });
      }
      const item = await Model.create(req.body);
      res.status(201).json(item);
    } catch (err) {
      handleWriteError(err, res, next);
    }
  });

  router.patch('/:id', authenticate, requireRole(...writeRoles), async (req, res, next) => {
    try {
      if (beforeUpdate) {
        const blockMessage = await beforeUpdate(req.params.id, req.body);
        if (blockMessage) return res.status(409).json({ message: blockMessage });
      }
      const item = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
      if (!item) return res.status(404).json({ message: 'Not found' });
      if (afterUpdate) await afterUpdate(item, req.body);
      res.json(item);
    } catch (err) {
      handleWriteError(err, res, next);
    }
  });

  router.delete('/:id', authenticate, requireRole(...writeRoles), async (req, res, next) => {
    try {
      if (beforeDelete) {
        const blockMessage = await beforeDelete(req.params.id);
        if (blockMessage) return res.status(409).json({ message: blockMessage });
      }
      const item = await Model.findByIdAndDelete(req.params.id);
      if (!item) return res.status(404).json({ message: 'Not found' });
      res.json({ id: req.params.id });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = crudRouter;
