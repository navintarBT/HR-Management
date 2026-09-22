const mongoose = require('mongoose');

const medicineExpenseSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    date: { type: Date, required: true }, // work date this claim relates to (used to look up ໂມງເຂົ້າວຽກ)
    billDate: { type: Date }, // date printed on the medicine receipt (ວ.ດ.ປ /ບິນຢາ)
    items: { type: String, trim: true }, // ລາຍການ
    billAmount: { type: Number, default: 0 }, // ຍອດບີນຢາ
    shopPayAmount: { type: Number, default: 0 }, // ຮ້ານຕ້ອງຈ່າຍ — may be less than billAmount
    note: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('MedicineExpense', medicineExpenseSchema);
