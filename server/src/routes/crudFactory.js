const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');

// Builds a REST router compatible with @refinedev/simple-rest's data provider
// contract: _start/_end/_sort/_order pagination + X-Total-Count header.
function crudRouter(Model, options = {}) {
  const {
    populate = '',
    writeRoles = ['admin'],
    readRoles = ['admin', 'manager', 'employee'],
    searchFields = [],
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
        } else {
          query[key] = value;
        }
      }

      if (q && searchFields.length) {
        query.$or = searchFields.map((field) => ({ [field]: { $regex: q, $options: 'i' } }));
      }

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
      const item = await Model.findById(req.params.id).populate(populate);
      if (!item) return res.status(404).json({ message: 'Not found' });
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', authenticate, requireRole(...writeRoles), async (req, res, next) => {
    try {
      const item = await Model.create(req.body);
      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id', authenticate, requireRole(...writeRoles), async (req, res, next) => {
    try {
      const item = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!item) return res.status(404).json({ message: 'Not found' });
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', authenticate, requireRole(...writeRoles), async (req, res, next) => {
    try {
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
