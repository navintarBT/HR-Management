import { useEffect } from 'react';
import { List, useTable, useModalForm, DeleteButton } from '@refinedev/antd';
import { useGetIdentity } from '@refinedev/core';
import { Table, Button, Modal, Form, Input, InputNumber, TimePicker, Space, ColorPicker, Typography } from 'antd';
import { PlusOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ShiftCategory, Identity } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';

const { RangePicker: TimeRangePicker } = TimePicker;

// Shared between the create and edit modals — only the Form/formProps wrapping differs.
const CategoryFormItems: React.FC = () => (
  <>
    <Form.Item label="ຊື່ໝວດໝູ່" name="name" rules={[{ required: true, message: 'ກະລຸນາປ້ອນຊື່ໝວດໝູ່' }]}>
      <Input placeholder="ຕົວຢ່າງ: ກະທ່ຽງ" />
    </Form.Item>
    <Form.Item label="ຊ່ວງເວລາ" name="time" rules={[{ required: true, message: 'ກະລຸນາເລືອກຊ່ວງເວລາ' }]}>
      <TimeRangePicker style={{ width: '100%' }} format="HH:mm" minuteStep={15} />
    </Form.Item>
    <Form.Item label="ສີ (ບໍ່ບັງຄັບ)" name="color">
      <ColorPicker format="hex" />
    </Form.Item>
    <Form.Item
      label="ສາຍໄດ້ບໍ່ເກີນ (ນາທີ)"
      name="graceMinutes"
      rules={[{ required: true, message: 'ກະລຸນາປ້ອນຈໍານວນນາທີ' }]}
      tooltip="ຖ້າມາຊ້າບໍ່ເກີນຈໍານວນນີ້ຈະຍັງນັບວ່າມາເຮັດວຽກ (present)"
    >
      <InputNumber min={0} max={240} style={{ width: '100%' }} addonAfter="ນາທີ" />
    </Form.Item>
    <Form.Item
      label="ສາຍເກີນເທົ່າໃດນັບເປັນຂາດງານ (ບໍ່ບັງຄັບ)"
      name="autoAbsentMinutes"
      tooltip="ຖ້າມາຊ້າເກີນຈໍານວນນີ້ຈະຖືກນັບເປັນຂາດງານ (absent) ແທນທີ່ຈະເປັນມາຊ້າ — ປະໄວ້ຫວ່າງຖ້າບໍ່ຕ້ອງການນະໂຍບາຍນີ້"
    >
      <InputNumber min={0} max={480} style={{ width: '100%' }} addonAfter="ນາທີ" placeholder="ບໍ່ນັບ" />
    </Form.Item>
  </>
);

const buildCategoryPayload = (values: any) => {
  const [startTime, endTime] = values.time.map((t: any) => t.format('HH:mm'));
  const color = typeof values.color === 'string' ? values.color : values.color?.toHexString?.();
  return {
    name: values.name,
    startTime,
    endTime,
    color,
    graceMinutes: values.graceMinutes ?? 15,
    autoAbsentMinutes: values.autoAbsentMinutes ?? null,
  };
};

export const ShiftCategoryListPage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const canManage = identity?.role === 'admin' || identity?.role === 'manager';

  const { tableProps } = useTable<ShiftCategory>({
    resource: 'shift-categories',
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'startTime', order: 'asc' }] },
  });

  const {
    modalProps: createModalProps,
    formProps: createFormProps,
    form: createForm,
    show: showCreate,
  } = useModalForm<ShiftCategory>({
    resource: 'shift-categories',
    action: 'create',
  });

  const {
    modalProps: editModalProps,
    formProps: editFormProps,
    form: editForm,
    query: editQuery,
    show: showEdit,
    formLoading: editFormLoading,
  } = useModalForm<ShiftCategory>({
    resource: 'shift-categories',
    action: 'edit',
  });
  const editingRecord = editQuery?.data?.data;

  useEffect(() => {
    if (!editModalProps.open || !editingRecord) return;
    editForm.setFieldsValue({
      name: editingRecord.name,
      time: [dayjs(editingRecord.startTime, 'HH:mm'), dayjs(editingRecord.endTime, 'HH:mm')],
      color: editingRecord.color,
      graceMinutes: editingRecord.graceMinutes,
      autoAbsentMinutes: editingRecord.autoAbsentMinutes,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editModalProps.open, editingRecord]);

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List
      title="ໝວດໝູ່ກະ"
      breadcrumb={false}
      headerButtons={
        canManage ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => showCreate()}>
            ເພີ່ມໝວດໝູ່ກະ
          </Button>
        ) : (
          <></>
        )
      }
    >
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }} />

      <Table {...tableProps} rowKey="_id" sticky={{ offsetHeader }}>
        <Table.Column title="ຊື່ໝວດໝູ່" dataIndex="name" />
        <Table.Column title="ເວລາເລີ່ມ" dataIndex="startTime" />
        <Table.Column title="ເວລາສິ້ນສຸດ" dataIndex="endTime" />
        <Table.Column
          title="ສີ"
          dataIndex="color"
          render={(color?: string) =>
            color ? <div style={{ width: 24, height: 24, borderRadius: 6, background: color, border: '1px solid rgba(0,0,0,0.1)' }} /> : '-'
          }
        />
        <Table.Column
          title="ນະໂຍບາຍມາຊ້າ"
          dataIndex="graceMinutes"
          render={(_, record: ShiftCategory) => (
            <Space direction="vertical" size={0}>
              <Typography.Text>ສາຍໄດ້ບໍ່ເກີນ {record.graceMinutes} ນທ</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {record.autoAbsentMinutes != null ? `ສາຍເກີນ ${record.autoAbsentMinutes} ນທ ນັບເປັນຂາດງານ` : 'ບໍ່ນັບເປັນຂາດງານອັດຕະໂນມັດ'}
              </Typography.Text>
            </Space>
          )}
        />
        {canManage && (
          <Table.Column
            title="ຈັດການ"
            width={120}
            render={(_, record: ShiftCategory) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => showEdit(record._id)} />
                <DeleteButton size="small" hideText resource="shift-categories" recordItemId={record._id} />
              </Space>
            )}
          />
        )}
      </Table>

      <Modal {...createModalProps} title="ເພີ່ມໝວດໝູ່ກະ" destroyOnClose>
        <Form
          {...createFormProps}
          form={createForm}
          layout="vertical"
          initialValues={{ graceMinutes: 15 }}
          onFinish={(values: any) => createFormProps.onFinish?.(buildCategoryPayload(values))}
        >
          <CategoryFormItems />
        </Form>
      </Modal>

      <Modal {...editModalProps} title="ແກ້ໄຂໝວດໝູ່ກະ" confirmLoading={editFormLoading} destroyOnClose>
        <Form
          {...editFormProps}
          form={editForm}
          layout="vertical"
          onFinish={(values: any) => editFormProps.onFinish?.(buildCategoryPayload(values))}
        >
          <CategoryFormItems />
        </Form>
      </Modal>
    </List>
  );
};
