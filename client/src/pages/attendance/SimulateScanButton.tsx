import { useState } from 'react';
import { useCustomMutation, useInvalidate, useNotification } from '@refinedev/core';
import { useSelect } from '@refinedev/antd';
import { Button, Modal, Form, Select, DatePicker } from 'antd';
import { ScanOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { API_URL } from '../../providers/axios';
import type { Employee } from '../../types';

export const SimulateScanButton: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const { mutate, isLoading } = useCustomMutation();
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const { selectProps } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName} (${item.employeeCode})`,
    optionValue: '_id',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: 200, mode: 'server' },
  });

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      mutate(
        {
          url: `${API_URL}/attendance/simulate`,
          method: 'post',
          values: {
            employeeId: values.employeeId,
            timestamp: values.timestamp ? dayjs(values.timestamp).toISOString() : undefined,
          },
        },
        {
          onSuccess: () => {
            notify?.({ type: 'success', message: 'ບັນທຶກການສະແກນສໍາເລັດ' });
            invalidate({ resource: 'attendance-logs', invalidates: ['list'] });
            invalidate({ resource: 'attendance-daily', invalidates: ['list'] });
            invalidate({ resource: 'dashboard', invalidates: ['all'] });
            setOpen(false);
            form.resetFields();
          },
          onError: () => notify?.({ type: 'error', message: 'ບັນທຶກການສະແກນບໍ່ສໍາເລັດ' }),
        }
      );
    }, () => undefined);
  };

  return (
    <>
      <Button type="primary" icon={<ScanOutlined />} onClick={() => setOpen(true)}>
        ຈໍາລອງການສະແກນນິ້ວ
      </Button>
      <Modal
        title="ຈໍາລອງການສະແກນນິ້ວ (Simulate Scan)"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleSubmit}
        confirmLoading={isLoading}
        okText="ບັນທຶກ"
        cancelText="ຍົກເລີກ"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="ພະນັກງານ" name="employeeId" rules={[{ required: true, message: 'ກະລຸນາເລືອກພະນັກງານ' }]}>
            <Select
              {...selectProps}
              onSearch={undefined}
              filterOption={(input, option) =>
                ((option?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())
              }
              placeholder="ເລືອກພະນັກງານ"
              showSearch
            />
          </Form.Item>
          <Form.Item label="ເວລາ (ຄ່າເລີ່ມຕົ້ນ: ດຽວນີ້)" name="timestamp">
            <DatePicker showTime style={{ width: '100%' }} format="DD/MM/YYYY HH:mm:ss" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};
