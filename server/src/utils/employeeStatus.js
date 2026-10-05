const Employee = require('../models/Employee');

// A resignation keeps the employee visible through the month they left so their
// final attendance and pay can still be worked out. From the 1st of the next
// month they're flipped to inactive and drop off the working lists.
async function deactivateEndedResignations(now = new Date()) {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const result = await Employee.updateMany(
    { status: 'resigned', terminationDate: { $lt: startOfMonth } },
    { $set: { status: 'inactive' } }
  );
  return result.modifiedCount;
}

module.exports = { deactivateEndedResignations };
