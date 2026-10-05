const Position = require('../models/Position');

// Only blocks deliberately *choosing* a day off (recurring default rest day,
// or a one-off planned rest day) for a position that can't spare people on
// that day of week — sick leave and company-wide holiday closures go through
// entirely separate code paths and are never subject to this.
async function ensureRestDayAllowed(positionId, dayOfWeek) {
  if (!positionId || dayOfWeek == null) return;
  const position = await Position.findById(positionId);
  if (!position || !position.restrictedRestDays?.length) return;
  if (position.restrictedRestDays.includes(dayOfWeek)) {
    const err = new Error('ຕຳແໜ່ງນີ້ບໍ່ອະນຸຍາດໃຫ້ຕັ້ງວັນພັກໃນວັນນີ້');
    err.status = 400;
    throw err;
  }
}

module.exports = { ensureRestDayAllowed };
