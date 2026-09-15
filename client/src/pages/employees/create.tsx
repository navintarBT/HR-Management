import { useEffect } from 'react';
import { Create, useForm, useSelect } from '@refinedev/antd';
import { Form, Input, Select, DatePicker, Row, Col, Checkbox, Divider, Button } from 'antd';
import dayjs from 'dayjs';
import type { Department, EmploymentType, Employee } from '../../types';
import { EmployeePhotoUpload } from '../../components/EmployeePhotoUpload';
import { usePositionsByDepartment } from '../../hooks/usePositionsByDepartment';

export const EmployeeCreate: React.FC = () => {
  const { formProps, saveButtonProps, form } = useForm({ resource: 'employees' });
  const createUser = Form.useWatch('createUser', formProps.form);

  const submitValues = (values: any) =>
    formProps.onFinish?.({
      ...values,
      hireDate: values.hireDate ? dayjs(values.hireDate).toISOString() : undefined,
    });

  const handleSaveDraft = () => {
    const values = form?.getFieldsValue(true) ?? {};
    submitValues({ ...values, status: 'draft', createUser: false });
  };

  const { selectProps: departmentSelect, query: departmentQuery } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
  });
  const allDepartments = departmentQuery?.data?.data ?? [];

  const departmentId = Form.useWatch('department', form);
  const positionId = Form.useWatch('position', form);
  const { positionSelect, options: positionOptions, isValidForDepartment, allPositions } =
    usePositionsByDepartment(departmentId);

  // ຫົວໜ້າງານ and ຫົວໜ້າຕໍາແໜ່ງ are fully derived from the department/position's
  // configured head (set on the org management page) — not manually pickable
  // here. Kept in sync (including clearing back to empty) whenever the selected
  // department/position, or the underlying department/position records, change.
  const idOf = (value: unknown) => (value && typeof value === 'object' ? (value as { _id: string })._id : value);

  useEffect(() => {
    const department = allDepartments.find((d) => d._id === departmentId);
    form.setFieldValue('supervisor', idOf(department?.head));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId, allDepartments]);

  useEffect(() => {
    const position = allPositions.find((p) => p._id === positionId);
    form.setFieldValue('positionHead', idOf(position?.head));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionId, allPositions]);

  const { selectProps: supervisorSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    pagination: { pageSize: 500, mode: 'server' },
  });

  const { selectProps: positionHeadSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    pagination: { pageSize: 500, mode: 'server' },
  });

  const { selectProps: employmentTypeSelect } = useSelect<EmploymentType>({
    resource: 'employment-types',
    optionLabel: 'name',
    optionValue: '_id',
  });

  return (
    <Create
      saveButtonProps={saveButtonProps}
      title="ເພີ່ມພະນັກງານ"
      footerButtons={({ defaultButtons }) => (
        <>
          <Button onClick={handleSaveDraft}>ບັນທຶກເປັນຮ່າງ</Button>
          {defaultButtons}
        </>
      )}
    >
      <Form {...formProps} layout="vertical" onFinish={submitValues}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <Form.Item name="photoUrl" style={{ marginBottom: 0 }}>
            <EmployeePhotoUpload />
          </Form.Item>
        </div>

        <Divider orientation="left">ຂໍ້ມູນພະນັກງານ</Divider>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="ລະຫັດພະນັກງານ" name="employeeCode">
              <Input disabled placeholder="ຈະສ້າງໃຫ້ອັດຕະໂນມັດ" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ລະຫັດເຄື່ອງສະແກນ" name="deviceUserId">
              <Input placeholder="19" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ຊື່" name="firstName" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ນາມສະກຸນ" name="lastName" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ອີເມວ" name="email">
              <Input type="email" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ເບີໂທ" name="phone">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">ຂໍ້ມູນການເຮັດວຽກ</Divider>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="ພະແນກ" name="department" rules={[{ required: true }]}>
              <Select
                {...departmentSelect}
                placeholder="ເລືອກພະແນກ"
                onChange={(value: any) => {
                  if (!value || !isValidForDepartment(form.getFieldValue('position'), value)) {
                    form.setFieldValue('position', undefined);
                  }
                }}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ຕຳແໜ່ງ" name="position" rules={[{ required: true }]}>
              <Select
                {...positionSelect}
                options={positionOptions}
                disabled={!departmentId}
                placeholder={
                  !departmentId
                    ? 'ກະລຸນາເລືອກພະແນກກ່ອນ'
                    : positionOptions.length === 0
                      ? 'ພະແນກນີ້ຍັງບໍ່ມີຕຳແໜ່ງຜູກໄວ້'
                      : 'ເລືອກຕຳແໜ່ງ'
                }
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ຫົວໜ້າງານ" name="supervisor">
              <Select {...supervisorSelect} disabled placeholder="ຈະດຶງຈາກຫົວໜ້າພະແນກອັດຕະໂນມັດ" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ຫົວໜ້າຕໍາແໜ່ງ" name="positionHead">
              <Select {...positionHeadSelect} disabled placeholder="ຈະດຶງຈາກຫົວໜ້າຕໍາແໜ່ງອັດຕະໂນມັດ" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ປະເພດການຈ້າງ" name="employmentType" rules={[{ required: true }]}>
              <Select {...employmentTypeSelect} placeholder="ເລືອກປະເພດການຈ້າງ" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ວັນທີເລີ່ມງານ" name="hireDate" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ສະຖານະ" name="status" initialValue="active" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: 'ຮ່າງ', value: 'draft' },
                  { label: 'ກຳລັງເຮັດວຽກ', value: 'active' },
                  { label: 'ບໍ່ໃຊ້ງານ', value: 'inactive' },
                  { label: 'ລາອອກ', value: 'resigned' },
                  { label: 'ພັກງານ', value: 'suspended' },
                ]}
              />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">ບັນຊີເຂົ້າໃຊ້ລະບົບ</Divider>
        <Form.Item name="createUser" valuePropName="checked">
          <Checkbox>ສ້າງບັນຊີ login ໃຫ້ພະນັກງານນີ້</Checkbox>
        </Form.Item>
        {createUser && (
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="ອີເມວເຂົ້າລະບົບ" name="userEmail" rules={[{ required: true }]}>
                <Input type="email" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="ລະຫັດຜ່ານຊົ່ວຄາວ" name="userPassword" rules={[{ required: true, min: 8 }]}>
                <Input.Password />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item label="ສິດຜູ້ໃຊ້" name="userRole" initialValue="employee" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: 'ພະນັກງານ', value: 'employee' },
                    { label: 'ຜູ້ຈັດການ', value: 'manager' },
                    { label: 'ແອດມິນ', value: 'admin' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="mustChangePassword" valuePropName="checked" initialValue>
                <Checkbox>ບັງຄັບໃຫ້ປ່ຽນລະຫັດຜ່ານເມື່ອ login ຄັ້ງທຳອິດ</Checkbox>
              </Form.Item>
            </Col>
          </Row>
        )}
      </Form>
    </Create>
  );
};
