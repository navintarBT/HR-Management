const crudRouter = require('./crudFactory');
const EmploymentType = require('../models/EmploymentType');
const Employee = require('../models/Employee');

module.exports = crudRouter(EmploymentType, {
  writeRoles: ['admin'],
  readRoles: ['admin', 'manager', 'employee'],
  searchFields: ['name'],
  beforeDelete: async (id) => {
    const inUse = await Employee.exists({ employmentType: id });
    if (inUse) return 'ປະເພດການຈ້າງນີ້ຖືກນໍາໃຊ້ໂດຍພະນັກງານຢູ່ແລ້ວ ບໍ່ສາມາດລຶບໄດ້';
    return null;
  },
});
