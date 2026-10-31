const express = require('express');
const mongoose = require('mongoose');
const EvidencePhoto = require('../models/EvidencePhoto');
const { photoTokenAllows } = require('../utils/evidence');

// An evidence image, behind the short-lived signed link every serialized
// evidence carries (utils/evidence.js photoUrl) — no sign-in header, since an
// <img> can't send one. ?s=thumb for the small one.
const router = express.Router();

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id) || !photoTokenAllows(id, req.query.t)) return res.status(403).json({ message: 'Link expired' });
    const thumb = req.query.s === 'thumb';
    const photo = await EvidencePhoto.findById(id, thumb ? 'thumb contentType' : 'data contentType');
    if (!photo) return res.status(404).json({ message: 'Not found' });
    res.set('Content-Type', photo.contentType || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=21600');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(thumb ? photo.thumb : photo.data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
