import { useEffect, useState } from 'react';
import { List, useTable, useModalForm, DeleteButton } from '@refinedev/antd';
import { useGetIdentity, useInvalidate, useNotification, useList } from '@refinedev/core';
import { Table, Button, Modal, Form, Input, InputNumber, TimePicker, Space, ColorPicker, Typography } from 'antd';
import { PlusOutlined, EditOutlined, ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ShiftCategory, Identity } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { axiosInstance, API_URL } from '../../providers/axios';
import { palette } from '../../theme/palette';

const { RangePicker: TimeRangePicker } = TimePicker;

// Shared between the create and edit modals — only the Form/formProps wrapping differs.
const CategoryFormItems: React.FC = () => (
  <>
    <Form.Item label="ຊື່ໝວດໝູ່ (ບໍ່ບັງຄັບ)" name="name">
      <Input placeholder="ຕົວຢ່າງ: ກະທ່ຽງ" />
    </Form.Item>
    <Form.Item label="ຊ່ວງເວລາ" name="time" rules={[{ required: true, message: 'ກະລຸນາເລືອກຊ່ວງເວລາ' }]}>
      <TimeRangePicker style={{ width: '100%' }} format="HH:mm" minuteStep={15} />
    </Form.Item>
    <Form.Item label="ສີ (ບໍ່ບັງຄັບ)" name="color">
      <ColorPicker format="hex" />
    </Form.Item>
    <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
      ນະໂຍບາຍມາຊ້າ (ຊ້າທຳມະດາ / ຮ້າຍແຮງ / ຂາດວຽກ) ຖືກລັອກໄວ້ໃຫ້ຄ່າດຽວກັນທຸກໝວດໝູ່ — ແກ້ໄດ້ສະເພາະປຸ່ມ
      "ຕັ້ງນະໂຍບາຍມາຊ້າໃຫ້ທຸກໝວດໝູ່" ຢູ່ດ້ານເທິງ ບໍ່ສາມາດແກ້ໄຂແຍກຕໍ່ໝວດໝູ່ຢູ່ບ່ອນນີ້ອີກຕໍ່ໄປ
    </Typography.Paragraph>
  </>
);

const buildCategoryPayload = (values: any) => {
  const [startTime, endTime] = values.time.map((t: any) => t.format('HH:mm'));
  const color = typeof values.color === 'string' ? values.color : values.color?.toHexString?.();
  // Late-policy fields (graceMinutes/autoAbsentMinutes/severeLateMinutes) are
  // deliberately left out — they're no longer editable from this form, only
  // via the "ຕັ້ງນະໂຍບາຍມາຊ້າໃຫ້ທຸກໝວດໝູ່" bulk button, so omitting them here
  // means a create gets the schema's own defaults and an edit leaves an
  // existing category's policy untouched.
  return { name: values.name, startTime, endTime, color };
};

export const ShiftCategoryListPage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const canManage = identity?.role === 'admin' || identity?.role === 'manager';

  const { tableProps } = useTable<ShiftCategory>({
    resource: 'shift-categories',
    pagination: { pageSize: 10 },
    sorters: { initial: [{ field: 'startTime', order: 'asc' }] },
  });

  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  // Full id list (independent of the paginated table's 10-per-page window) so
  // "apply to every category" doesn't depend on selecting each one by hand.
  const { data: allCategoriesData } = useList<ShiftCategory>({
    resource: 'shift-categories',
    pagination: { pageSize: 1000 },
  });
  const allCategoryIds = (allCategoriesData?.data ?? []).map((c) => c._id);

  // Bulk-set the late policy (graceMinutes/autoAbsentMinutes) across every
  // category at once — the reason for the bulk tool: changing it one-by-one
  // is slow once there are more than a couple of categories.
  const [bulkPolicyOpen, setBulkPolicyOpen] = useState(false);
  const [bulkPolicyForm] = Form.useForm();
  const [bulkLoading, setBulkLoading] = useState(false);

  const applyBulkPolicy = async () => {
    const values = await bulkPolicyForm.validateFields();
    setBulkLoading(true);
    try {
      await Promise.all(
        allCategoryIds.map((key) =>
          axiosInstance.patch(`${API_URL}/shift-categories/${key}`, {
            graceMinutes: values.graceMinutes,
            autoAbsentMinutes: values.autoAbsentMinutes ?? null,
            severeLateMinutes: values.severeLateMinutes,
          })
        )
      );
      notify?.({ type: 'success', message: `ອັບເດດນະໂຍບາຍມາຊ້າໃຫ້ ${allCategoryIds.length} ໝວດໝູ່ສໍາເລັດແລ້ວ` });
      setBulkPolicyOpen(false);
      invalidate({ resource: 'shift-categories', invalidates: ['list'] });
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ດໍາເນີນການບໍ່ສໍາເລັດ' });
    } finally {
      setBulkLoading(false);
    }
  };

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
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        {canManage && (
          <Space style={{ display: 'flex', justifyContent: 'space-between' }} wrap>
            <Typography.Text type="secondary">ມີທັງໝົດ {allCategoryIds.length} ໝວດໝູ່</Typography.Text>
            <Button
              type="primary"
              icon={<ClockCircleOutlined />}
              style={{ backgroundColor: palette.warning, borderColor: palette.warning }}
              onClick={() => {
                // Pre-fill with whatever's actually saved right now (every
                // category shares the same policy, since this button is the
                // only way to change it) — resetFields() alone would fall
                // back to a hardcoded 15/60 every time, which would silently
                // revert a previously-changed policy back to that default if
                // confirmed without noticing.
                const current = allCategoriesData?.data?.[0];
                bulkPolicyForm.resetFields();
                bulkPolicyForm.setFieldsValue({
                  graceMinutes: current?.graceMinutes ?? 15,
                  autoAbsentMinutes: current?.autoAbsentMinutes ?? undefined,
                  severeLateMinutes: current?.severeLateMinutes ?? 60,
                });
                setBulkPolicyOpen(true);
              }}
            >
              ຕັ້ງນະໂຍບາຍມາຊ້າໃຫ້ທຸກໝວດໝູ່ ({allCategoryIds.length})
            </Button>
          </Space>
        )}
      </div>

      <Table {...tableProps} rowKey="_id" sticky={{ offsetHeader }}>
        <Table.Column
          title="ຊື່ໝວດໝູ່"
          dataIndex="name"
          render={(name: string | undefined, record: ShiftCategory) => name || `${record.startTime}-${record.endTime}`}
        />
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
              <Typography.Text>ຊ້າທຳມະດາບໍ່ເກີນ {record.graceMinutes} ນທ</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ຊ້າຮ້າຍແຮງເກີນ {record.severeLateMinutes ?? 60} ນທ
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {record.autoAbsentMinutes != null ? `ສາຍເກີນ ${record.autoAbsentMinutes} ນທ ນັບເປັນຂາດວຽກ` : 'ບໍ່ນັບເປັນຂາດວຽກອັດຕະໂນມັດ'}
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

      <Modal
        title={`ຕັ້ງນະໂຍບາຍມາຊ້າໃຫ້ທຸກໝວດໝູ່ (${allCategoryIds.length})`}
        open={bulkPolicyOpen}
        onOk={applyBulkPolicy}
        onCancel={() => setBulkPolicyOpen(false)}
        confirmLoading={bulkLoading}
        okText="ຢືນຢັນ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ຄ່າທີ່ຕັ້ງນີ້ຈະໄປແທນທີ່ນະໂຍບາຍມາຊ້າເດີມຂອງທຸກໝວດໝູ່ກະທີ່ມີຢູ່ໃນລະບົບ
        </Typography.Paragraph>
        <Form form={bulkPolicyForm} layout="vertical" initialValues={{ graceMinutes: 15, severeLateMinutes: 60 }}>
          <Form.Item
            label="ຊ້າລະດັບທຳມະດາບໍ່ເກີນ (ນາທີ)"
            name="graceMinutes"
            rules={[{ required: true, message: 'ກະລຸນາປ້ອນຈໍານວນນາທີ' }]}
          >
            <InputNumber min={0} max={240} style={{ width: '100%' }} addonAfter="ນາທີ" />
          </Form.Item>
          <Form.Item
            label="ສາຍເກີນເທົ່າໃດນັບເປັນຂາດວຽກ (ບໍ່ບັງຄັບ)"
            name="autoAbsentMinutes"
          >
            <InputNumber min={0} max={480} style={{ width: '100%' }} addonAfter="ນາທີ" placeholder="ບໍ່ນັບ" />
          </Form.Item>
          <Form.Item
            label="ຊ້າຮ້າຍແຮງເກີນ (ນາທີ)"
            name="severeLateMinutes"
            rules={[{ required: true, message: 'ກະລຸນາປ້ອນຈໍານວນນາທີ' }]}
          >
            <InputNumber min={0} max={1440} style={{ width: '100%' }} addonAfter="ນາທີ" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal {...createModalProps} title="ເພີ່ມໝວດໝູ່ກະ" destroyOnClose>
        <Form
          {...createFormProps}
          form={createForm}
          layout="vertical"
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
