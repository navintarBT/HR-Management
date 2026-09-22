const Employee = require('../models/Employee');
const Position = require('../models/Position');
const ScheduledPositionSwap = require('../models/ScheduledPositionSwap');
const { toDateKey } = require('./attendanceProcessor');

// Whoever currently holds a position all shares one working time (see the
// KTV server positions this was built for) — so swapping isn't a 1-to-1
// person pairing, it's "everyone in A moves to B and takes on B's time, and
// vice versa." The canonical time for a position is read off its first
// current member (sorted by employee code); an empty position has no time to
// hand out, so movers into it end up with no default shift set.
function canonicalTimeOf(list) {
  const ref = list[0];
  return {
    categoryId: ref?.defaultShiftCategory ?? null,
    start: ref && !ref.defaultShiftCategory ? ref.defaultShiftStart ?? null : null,
    end: ref && !ref.defaultShiftCategory ? ref.defaultShiftEnd ?? null : null,
  };
}

// Resolves each position's CURRENT membership at the moment this runs (not
// whatever it was when the swap was scheduled) and swaps them. This is what
// makes "schedule for next month" safe — anyone hired, moved, or resigned
// between now and the effective date is still handled correctly because
// membership is looked up fresh every time this actually executes.
async function applyPositionSwap(positionAId, positionBId) {
  const [positionA, positionB, empListA, empListB] = await Promise.all([
    Position.findById(positionAId),
    Position.findById(positionBId),
    Employee.find({ position: positionAId, status: 'active' }).sort('employeeCode'),
    Employee.find({ position: positionBId, status: 'active' }).sort('employeeCode'),
  ]);

  const canonicalA = canonicalTimeOf(empListA);
  const canonicalB = canonicalTimeOf(empListB);

  await Promise.all([
    ...empListA.map((e) =>
      Employee.updateOne(
        { _id: e._id },
        {
          position: positionBId,
          positionHead: positionB?.head || null,
          defaultShiftCategory: canonicalB.categoryId,
          defaultShiftStart: canonicalB.start,
          defaultShiftEnd: canonicalB.end,
        }
      )
    ),
    ...empListB.map((e) =>
      Employee.updateOne(
        { _id: e._id },
        {
          position: positionAId,
          positionHead: positionA?.head || null,
          defaultShiftCategory: canonicalA.categoryId,
          defaultShiftStart: canonicalA.start,
          defaultShiftEnd: canonicalA.end,
        }
      )
    ),
  ]);

  return { movedFromA: empListA.length, movedFromB: empListB.length };
}

// Applies every pending scheduled swap whose effective date has arrived.
// Called on server startup (catches anything due while the server was down)
// and on a recurring timer — this app has no other background job runner, so
// a plain interval is the simplest thing that reliably fires a swap on a
// future date without needing the browser open.
async function runDueScheduledSwaps() {
  const todayKey = toDateKey(new Date());
  const due = await ScheduledPositionSwap.find({ status: 'pending', effectiveDate: { $lte: todayKey } });
  for (const swap of due) {
    // eslint-disable-next-line no-await-in-loop
    const { movedFromA, movedFromB } = await applyPositionSwap(swap.positionA, swap.positionB);
    swap.status = 'applied';
    swap.appliedAt = new Date();
    swap.movedFromA = movedFromA;
    swap.movedFromB = movedFromB;
    // eslint-disable-next-line no-await-in-loop
    await swap.save();
  }
  return due.length;
}

module.exports = { applyPositionSwap, runDueScheduledSwaps };
