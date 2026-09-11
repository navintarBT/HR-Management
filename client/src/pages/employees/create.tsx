import { Create, useForm, useSelect } from '@refinedev/antd';
import { Form, Input, Select, DatePicker, Row, Col } from 'antd';
import dayjs from 'dayjs';
import type { Department, Position } from '../../types';

export const EmployeeCreate: React.FC = () => {
  const { formProps, saveButtonProps } = useForm({ resource: 'employees' });

  const { selectProps: departmentSelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
  });

  const { selectProps: positionSelect } = useSelect<Position>({
    resource: 'positions',
    optionLabel: 'name',
    optionValue: '_id',
  });

  return (
    <Create saveButtonProps={saveButtonProps} title="ເພີ່ມພະນັກງານໃໝ່">
      <Form
        {...formProps}
        layout="vertical"
        onFinish={(values: any) =>
          formProps.onFinish?.({
            ...values,
            hireDate: values.hireDate ? dayjs(values.hireDate).toISOString() : undefined,
          })
        }
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="ລະຫັດພະນັກງານ" name="employeeCode" rules={[{ required: true }]}>
              <Input placeholder="EMP019" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="ລະຫັດອຸປະກອນສະແກນ (deviceUserId)" name="deviceUserId">
              <Input placeholder="19" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="ຊື່" name="firstName" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="ນາມສະກຸນ" name="lastName" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="ພະແນກ" name="department" rules={[{ required: true }]}>
              <Select {...departmentSelect} placeholder="ເລືອກພະແນກ" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="ຕໍາແໜ່ງ" name="position" rules={[{ required: true }]}>
              <Select {...positionSelect} placeholder="ເລືອກຕໍາແໜ່ງ" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="ວັນທີເລີ່ມງານ" name="hireDate" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="ສະຖານະ" name="status" initialValue="active" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: 'ກໍາລັງເຮັດວຽກ', value: 'active' },
                  { label: 'ພົ້ນສະພາບ', value: 'inactive' },
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="ອີເມວ" name="email">
              <Input />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="ເບີໂທ" name="phone">
              <Input />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Create>
  );
};
