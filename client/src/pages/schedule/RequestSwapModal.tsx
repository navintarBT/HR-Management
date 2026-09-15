import { useState } from 'react';
import { useCustomMutation, useInvalidate, useNotification, useGetIdentity } from '@refinedev/core';
import { useSelect } from '@refinedev/antd';
import { Modal, Form, Select, Input } from 'antd';
import dayjs from 'dayjs';
import { API_URL } from '../../providers/axios';
import type { Employee, Identity, Shift } from '../../types';
import { withLocalTextFilter as withTextFilter } from '../../utils/selectFilters';

interface RequestSwapModalProps {
  open: boolean;
  onClose: () => void;
  // When opened from a specific shift chip, the shift is preset and shown read-only.
  initialShiftId?: string;
  initialShiftLabel?: string;
}

const shiftOptionLabel = (item: Shift) =>
  `${dayjs(item.date).format('DD/MM')} ${item.startTime}-${item.endTime} (${typeof item.position === 'object' ? item.position?.name : ''})`;

export const RequestSwapModal: React.FC<RequestSwapModalProps> = ({ open, onClose, initialShiftId, initialShiftLabel }) => {
  const [form] = Form.useForm();
  const { data: identity } = useGetIdentity<Identity>();
  const myEmployeeId = identity?.employee?._id;
  const { mutate, isLoading } = useCustomMutation();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();
  const [toEmployeeId, setToEmployeeId] = useState<string | undefined>();

  const today = dayjs().format('YYYY-MM-DD');

  const { selectProps: myShiftSelect } = useSelect<Shift>({
    resource: 'shifts',
    optionLabel: shiftOptionLabel,
    optionValue: '_id',
    filters: [
      { field: 'employee', operator: 'eq', value: myEmployeeId },
      { field: 'date', operator: 'gte', value: today },
    ],
    queryOptions: { enabled: !initialShiftId && !!myEmployeeId && open },
    pagination: { pageSize: 100, mode: 'server' },
  });

  const { selectProps: employeeSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 200, mode: 'server' },
  });

  const { selectProps: toShiftSelect } = useSelect<Shift>({
    resource: 'shifts',
    optionLabel: shiftOptionLabel,
    optionValue: '_id',
    filters: [
      { field: 'employee', operator: 'eq', value: toEmployeeId },
      { field: 'date', operator: 'gte', value: today },
    ],
    queryOptions: { enabled: !!toEmployeeId },
    pagination: { pageSize: 100, mode: 'server' },
  });

  const reset = () => {
    form.resetFields();
    setToEmployeeId(undefined);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      mutate(
        {
          url: `${API_URL}/shift-swaps`,
          method: 'post',
          values: {
            fromShift: initialShiftId ?? values.fromShift,
            toEmployee: values.toEmployee,
            toShift: values.toShift || undefined,
            reason: values.reason,
          },
        },
        {
          onSuccess: () => {
            notify?.({ type: 'success', message: 'ສົ່ງຄໍາຂໍສະຫຼັບກະສໍາເລັດ' });
            invalidate({ resource: 'shift-swaps', invalidates: ['list'] });
            handleClose();
          },
          onError: (err: any) =>
            notify?.({ type: 'error', message: err?.response?.data?.message || 'ສົ່ງຄໍາຂໍບໍ່ສໍາເລັດ' }),
        }
      );
    }, () => undefined);
  };

  return (
    <Modal
      title="ຂໍສະຫຼັບກະ"
      open={open}
      onCancel={handleClose}
      onOk={handleSubmit}
      confirmLoading={isLoading}
      okText="ສົ່ງຄໍາຂໍ"
      cancelText="ຍົກເລີກ"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        {initialShiftId ? (
          <Form.Item label="ກະຂອງທ່ານ">
            <Input value={initialShiftLabel} disabled />
          </Form.Item>
        ) : (
          <Form.Item label="ກະຂອງທ່ານທີ່ຈະຂໍສະຫຼັບ" name="fromShift" rules={[{ required: true, message: 'ກະລຸນາເລືອກກະ' }]}>
            <Select {...withTextFilter(myShiftSelect)} placeholder="ເລືອກກະຂອງທ່ານ" />
          </Form.Item>
        )}
        <Form.Item label="ເພື່ອນຮ່ວມງານ" name="toEmployee" rules={[{ required: true, message: 'ກະລຸນາເລືອກເພື່ອນຮ່ວມງານ' }]}>
          <Select
            {...withTextFilter(employeeSelect)}
            placeholder="ເລືອກເພື່ອນຮ່ວມງານ"
            onChange={(value: any) => {
              setToEmployeeId(value);
              form.setFieldValue('toShift', undefined);
            }}
          />
        </Form.Item>
        <Form.Item label="ແລກກັບກະຂອງເພື່ອນຮ່ວມງານ (ຖ້າຕ້ອງການແລກກັນ)" name="toShift">
          <Select
            {...withTextFilter(toShiftSelect)}
            placeholder="ບໍ່ບັງຄັບ — ຖ້າບໍ່ເລືອກ ຈະຖືວ່າມອບກະໃຫ້ໄປເລີຍ"
            allowClear
            disabled={!toEmployeeId}
          />
        </Form.Item>
        <Form.Item label="ເຫດຜົນ" name="reason">
          <Input.TextArea rows={3} placeholder="ລະບຸເຫດຜົນ (ຖ້າມີ)" />
        </Form.Item>
      </Form>
    </Modal>
  );
};
