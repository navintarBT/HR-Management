import { useState } from 'react';
import { useList, useCreate, useInvalidate } from '@refinedev/core';
import { Select, Button, Modal, Form, Input, TimePicker, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { ShiftCategory } from '../types';

const { RangePicker: TimeRangePicker } = TimePicker;

// A category dropdown (ໝວດໝູ່ກະ) with an inline "add new" shortcut. Unlike the
// category picker on a Shift form (a one-time prefill only), this one is a
// controlled value/onChange pair meant to sit in a Form.Item bound to a live
// reference field (Employee.defaultShiftCategory) — the id itself is stored,
// so editing the category's time later is reflected everywhere it's used.
// `onSelect` additionally hands back the resolved category object (or
// undefined on clear) for a caller that wants to preview/derive its time.
// Creating a new one here saves it to the same shift-categories collection
// the ໝວດໝູ່ກະ management page manages, so it's available everywhere else too.
export const ShiftCategoryQuickPicker: React.FC<{
  value?: string;
  onChange?: (id?: string) => void;
  onSelect?: (category?: ShiftCategory) => void;
  placeholder?: string;
}> = ({ value, onChange, onSelect, placeholder = 'ເລືອກໝວດໝູ່ກະ' }) => {
  const { data, isLoading } = useList<ShiftCategory>({
    resource: 'shift-categories',
    pagination: { pageSize: 200 },
    sorters: [{ field: 'startTime', order: 'asc' }],
  });
  const categories = data?.data ?? [];
  const invalidate = useInvalidate();
  const { mutate: createCategory, isLoading: creating } = useCreate();

  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const handleChange = (id?: string) => {
    onChange?.(id);
    onSelect?.(id ? categories.find((c) => c._id === id) : undefined);
  };

  const handleCreate = async () => {
    const values = await form.validateFields();
    const [startTime, endTime] = values.time.map((t: any) => t.format('HH:mm'));
    createCategory(
      { resource: 'shift-categories', values: { name: values.name, startTime, endTime } },
      {
        onSuccess: (res) => {
          setModalOpen(false);
          form.resetFields();
          invalidate({ resource: 'shift-categories', invalidates: ['list'] });
          const created = res.data as unknown as ShiftCategory;
          onChange?.(created._id);
          onSelect?.(created);
        },
      }
    );
  };

  return (
    <>
      <Space.Compact style={{ width: '100%' }}>
        <Select
          value={value}
          onChange={handleChange}
          allowClear
          loading={isLoading}
          placeholder={placeholder}
          style={{ width: '100%' }}
          showSearch
          options={categories.map((c) => ({
            label: c.name ? `${c.name} (${c.startTime}-${c.endTime})` : `${c.startTime}-${c.endTime}`,
            value: c._id,
          }))}
          filterOption={(input, option) => ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())}
        />
        <Button icon={<PlusOutlined />} onClick={() => setModalOpen(true)} title="ເພີ່ມໝວດໝູ່ກະໃໝ່" />
      </Space.Compact>

      <Modal
        title="ເພີ່ມໝວດໝູ່ກະໃໝ່"
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => setModalOpen(false)}
        confirmLoading={creating}
        okText="ເພີ່ມ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="ຊື່ໝວດໝູ່ (ບໍ່ບັງຄັບ)" name="name">
            <Input placeholder="ຕົວຢ່າງ: ກະເຊົ້າ" />
          </Form.Item>
          <Form.Item label="ຊ່ວງເວລາ" name="time" rules={[{ required: true, message: 'ກະລຸນາເລືອກຊ່ວງເວລາ' }]}>
            <TimeRangePicker style={{ width: '100%' }} format="HH:mm" minuteStep={15} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
