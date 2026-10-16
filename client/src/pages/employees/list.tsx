import { useMemo, useState } from 'react';
import { List, useTable, useSelect, EditButton, ShowButton, CreateButton } from '@refinedev/antd';
import { useGetIdentity, useList, useUpdate, useNotification, useInvalidate } from '@refinedev/core';
import { Table, Space, Input, Select, Avatar, Typography, Card, Row, Col, Statistic, DatePicker, Modal, Form, Button, Tooltip } from 'antd';
import { UserOutlined, SearchOutlined, StopOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Employee, Department, Position, Identity } from '../../types';
import { EmployeeStatusTag } from '../../components/StatusTags';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { categorical } from '../../theme/palette';
import { resolvePhotoUrl, axiosInstance, API_URL } from '../../providers/axios';

export const EmployeeList: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';
  const invalidate = useInvalidate();
  const { open: notify } = useNotification();

  const { tableProps, setFilters } = useTable<Employee>({
    resource: 'employees',
    syncWithLocation: true,
    sorters: { initial: [{ field: 'employeeCode', order: 'asc' }] },
    pagination: { pageSize: 10 },
  });

  // Search box + the dropdowns + the new-hire month picker all feed the same
  // filter list — each control rebuilds the full set (keeping whatever the
  // others are set to) rather than replacing it outright, so combining them
  // (e.g. search text within one department) works as expected.
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<string>();
  const [newHireMonth, setNewHireMonth] = useState<Dayjs | null>(null);

  // Header stats — independent of whatever filters are currently applied to
  // the table below, so they stay meaningful (total headcount ever, and how
  // many have left) even while the table itself is filtered down.
  const { data: totalData } = useList<Employee>({ resource: 'employees', pagination: { pageSize: 1, mode: 'server' } });
  const { data: resignedData } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'resigned' }],
    pagination: { pageSize: 1, mode: 'server' },
  });
  const totalCount = totalData?.total ?? 0;
  const resignedCount = resignedData?.total ?? 0;
  const filteredCount = typeof tableProps.pagination === 'object' ? tableProps.pagination?.total : undefined;

  const { selectProps: departmentSelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const { selectProps: positionSelect, query: positionQuery } = useSelect<Position>({
    resource: 'positions',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const allPositions = positionQuery?.data?.data ?? [];

  // Narrows the position dropdown to whatever's linked to the chosen
  // department — but (unlike the create/edit form) doesn't disable it when no
  // department is picked, since filtering by position alone is still useful here.
  const positionOptionsForDepartment = useMemo(() => {
    if (!departmentFilter) return undefined;
    return allPositions
      .filter((p) => (p.departments ?? []).some((d) => (typeof d === 'object' ? d._id : d) === departmentFilter))
      .map((p) => ({ label: p.name, value: p._id }));
  }, [allPositions, departmentFilter]);

  const applyFilters = (
    overrides: { search?: string; department?: string; position?: string; status?: string; newHireMonth?: Dayjs | null } = {}
  ) => {
    const s = overrides.search ?? search;
    const d = 'department' in overrides ? overrides.department : departmentFilter;
    const p = 'position' in overrides ? overrides.position : positionFilter;
    const st = 'status' in overrides ? overrides.status : statusFilter;
    const m = 'newHireMonth' in overrides ? overrides.newHireMonth : newHireMonth;
    const filters: any[] = [];
    if (s) filters.push({ field: 'q', operator: 'eq', value: s });
    if (d) filters.push({ field: 'department', operator: 'eq', value: d });
    if (p) filters.push({ field: 'position', operator: 'eq', value: p });
    if (st) filters.push({ field: 'status', operator: 'eq', value: st });
    if (m) {
      filters.push({ field: 'hireDate_gte', operator: 'eq', value: m.startOf('month').toISOString() });
      filters.push({ field: 'hireDate_lte', operator: 'eq', value: m.endOf('month').toISOString() });
    }
    setFilters(filters, 'replace');
  };

  // Quick "terminate" action — captures the last working day and why.
  const [terminating, setTerminating] = useState<Employee | null>(null);
  const [terminateForm] = Form.useForm();
  const { mutate: updateEmployee, isLoading: savingTermination } = useUpdate();

  const openTerminate = (emp: Employee) => {
    setTerminating(emp);
    terminateForm.resetFields();
    terminateForm.setFieldsValue({ terminationDate: dayjs() });
  };

  const submitTerminate = async () => {
    if (!terminating) return;
    const values = await terminateForm.validateFields();
    updateEmployee(
      {
        resource: 'employees',
        id: terminating._id,
        values: {
          status: 'resigned',
          terminationDate: (values.terminationDate as Dayjs).format('YYYY-MM-DD'),
          terminationReason: values.terminationReason,
        },
      },
      {
        onSuccess: () => {
          notify?.({ type: 'success', message: 'ບັນທຶກສຳເລັດ' });
          setTerminating(null);
          invalidate({ resource: 'employees', invalidates: ['list'] });
        },
      }
    );
  };

  // Delete is only offered for an 'inactive' employee (server enforces this
  // too — see routes/employees.js) — by the time someone reaches that status
  // their pay/history has already been settled, so it's safe to let an admin
  // choose between purging them from our data outright, or just freeing up
  // their scanner PIN while keeping the history. Either path queues a
  // "DATA DELETE USERINFO" command to every known terminal (see
  // utils/deviceCommands.js) — not yet verified against a real device.
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [deleteAction, setDeleteAction] = useState<'full' | 'deviceOnly' | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const closeDeleteModal = () => {
    setDeleting(null);
    setDeleteAction(null);
  };

  const confirmDelete = async () => {
    if (!deleting || !deleteAction) return;
    setDeletingBusy(true);
    try {
      if (deleteAction === 'full') {
        await axiosInstance.delete(`${API_URL}/employees/${deleting._id}`);
        notify?.({ type: 'success', message: 'ລຶບພະນັກງານ ແລະ ຕັ້ງຄິວລຶບອອກຈາກເຄື່ອງສະແກນແລ້ວ' });
      } else {
        await axiosInstance.post(`${API_URL}/employees/${deleting._id}/clear-device`);
        notify?.({ type: 'success', message: 'ຕັ້ງຄິວລຶບອອກຈາກເຄື່ອງສະແກນແລ້ວ — ຂໍ້ມູນພະນັກງານຍັງຄົງຢູ່' });
      }
      closeDeleteModal();
      invalidate({ resource: 'employees', invalidates: ['list'] });
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ດໍາເນີນການບໍ່ສຳເລັດ' });
    } finally {
      setDeletingBusy(false);
    }
  };

  const colorFor = (seed: string) => (seed ? categorical[seed.charCodeAt(seed.length - 1) % categorical.length] : categorical[0]);
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List
      title="ລາຍຊື່ພະນັກງານ"
      headerButtons={isAdmin ? <CreateButton>ເພີ່ມພະນັກງານ</CreateButton> : <></>}
      breadcrumb={false}
    >
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="ພະນັກງານທັງໝົດ" value={totalCount} suffix="ຄົນ" />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small">
            <Statistic title="ຕາມຕົວກອງປັດຈຸບັນ" value={filteredCount ?? 0} suffix="ຄົນ" />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card
            size="small"
            hoverable
            onClick={() => {
              setStatusFilter('resigned');
              applyFilters({ status: 'resigned' });
            }}
          >
            <Statistic
              title="ພະນັກງານທີ່ອອກ (ກົດເພື່ອເບິ່ງລາຍຊື່)"
              value={resignedCount}
              suffix="ຄົນ"
              valueStyle={resignedCount > 0 ? { color: '#cf1322' } : undefined}
            />
          </Card>
        </Col>
      </Row>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap>
          <Input.Search
            placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່ພະນັກງານ"
            allowClear
            style={{ width: 260 }}
            prefix={<SearchOutlined />}
            onSearch={(value) => {
              setSearch(value);
              applyFilters({ search: value });
            }}
          />
          <Select
            {...departmentSelect}
            placeholder="ກອງຕາມພະແນກ"
            allowClear
            style={{ width: 180 }}
            value={departmentFilter}
            onChange={(v: any) => {
              setDepartmentFilter(v);
              // Drop the position filter if it doesn't belong to the newly picked department.
              const stillValid =
                !v || !positionFilter || allPositions.find((p) => p._id === positionFilter)?.departments?.some(
                  (d) => (typeof d === 'object' ? d._id : d) === v
                );
              const nextPosition = stillValid ? positionFilter : undefined;
              if (!stillValid) setPositionFilter(undefined);
              applyFilters({ department: v, position: nextPosition });
            }}
          />
          <Select
            {...positionSelect}
            options={positionOptionsForDepartment}
            placeholder="ກອງຕາມຕຳແໜ່ງ"
            allowClear
            style={{ width: 180 }}
            value={positionFilter}
            onChange={(v: any) => {
              setPositionFilter(v);
              applyFilters({ position: v });
            }}
          />
          <Select
            placeholder="ກອງຕາມສະຖານະ"
            allowClear
            style={{ width: 160 }}
            value={statusFilter}
            options={[
              { label: 'ຮ່າງ', value: 'draft' },
              { label: 'ກຳລັງເຮັດວຽກ', value: 'active' },
              { label: 'ບໍ່ໃຊ້ງານ', value: 'inactive' },
              { label: 'ລາອອກ', value: 'resigned' },
              { label: 'ພັກວຽກ', value: 'suspended' },
            ]}
            onChange={(v: any) => {
              setStatusFilter(v);
              applyFilters({ status: v });
            }}
          />
          <DatePicker
            picker="month"
            placeholder="ພະນັກງານເຂົ້າໃໝ່ ຕາມເດືອນ"
            allowClear
            style={{ width: 200 }}
            value={newHireMonth}
            onChange={(v) => {
              setNewHireMonth(v);
              applyFilters({ newHireMonth: v });
            }}
          />
        </Space>
      </div>
      <Table {...tableProps} rowKey="_id" scroll={{ x: 'max-content' }} sticky={{ offsetHeader }}>
        <Table.Column
          title="ພະນັກງານ"
          dataIndex="firstName"
          width={220}
          render={(_, record: Employee) => (
            <Space>
              <Avatar
                src={resolvePhotoUrl(record.photoUrl)}
                style={{ backgroundColor: colorFor(record.employeeCode || record._id) }}
                icon={<UserOutlined />}
              />
              <div>
                <div style={{ fontWeight: 500 }}>
                  {record.firstName} {record.lastName}
                </div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {record.employeeCode}
                </Typography.Text>
              </div>
            </Space>
          )}
        />
        <Table.Column
          title="ພະແນກ"
          dataIndex={['department', 'name']}
          width={130}
          render={(_, record: Employee) => (typeof record.department === 'object' ? record.department?.name : '-')}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          dataIndex={['position', 'name']}
          width={130}
          render={(_, record: Employee) => (typeof record.position === 'object' ? record.position?.name : '-')}
        />
        <Table.Column
          title="ປະເພດການຈ້າງ"
          dataIndex={['employmentType', 'name']}
          width={120}
          render={(_, record: Employee) => (typeof record.employmentType === 'object' ? record.employmentType?.name : '-')}
        />
        <Table.Column title="ເບີໂທ" dataIndex="phone" width={120} />
        <Table.Column
          title="ວັນທີເລີ່ມວຽກ"
          dataIndex="hireDate"
          width={120}
          render={(value) => (value ? dayjs(value).format('DD/MM/YYYY') : '-')}
        />
        <Table.Column title="ສະຖານະ" dataIndex="status" width={110} render={(value) => <EmployeeStatusTag status={value} />} />
        <Table.Column
          title="ຈັດການ"
          fixed="right"
          width={isAdmin ? 180 : 70}
          render={(_, record: Employee) => (
            <Space>
              <ShowButton hideText size="small" recordItemId={record._id} />
              {isAdmin && (
                <>
                  <EditButton hideText size="small" recordItemId={record._id} />
                  {record.status === 'active' && (
                    <Tooltip title="ຢຸດເຮັດວຽກ">
                      <Button danger size="small" icon={<StopOutlined />} onClick={() => openTerminate(record)} />
                    </Tooltip>
                  )}
                  {record.status === 'inactive' && (
                    <Tooltip title="ລຶບ">
                      <Button danger size="small" icon={<DeleteOutlined />} onClick={() => setDeleting(record)} />
                    </Tooltip>
                  )}
                </>
              )}
            </Space>
          )}
        />
      </Table>

      <Modal
        title={`ຢຸດເຮັດວຽກ: ${terminating?.firstName ?? ''} ${terminating?.lastName ?? ''}`}
        open={!!terminating}
        onOk={submitTerminate}
        onCancel={() => setTerminating(null)}
        confirmLoading={savingTermination}
        okText="ຢືນຢັນ"
        okButtonProps={{ danger: true }}
        cancelText="ຍົກເລີກ"
      >
        <Form form={terminateForm} layout="vertical">
          <Form.Item
            label="ວັນທີ່ອອກ (ວັນເຮັດວຽກສຸດທ້າຍ)"
            name="terminationDate"
            rules={[{ required: true, message: 'ກະລຸນາເລືອກວັນທີ່ອອກ' }]}
          >
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item
            label="ເຫດຜົນທີ່ອອກ"
            name="terminationReason"
            rules={[{ required: true, message: 'ກະລຸນາປ້ອນເຫດຜົນ' }]}
          >
            <Input.TextArea rows={3} placeholder="ຕົວຢ່າງ: ລາອອກເອງ, ໝົດສັນຍາ, ຖືກໃຫ້ອອກ ..." />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`ລຶບພະນັກງານ: ${deleting?.firstName ?? ''} ${deleting?.lastName ?? ''}`}
        open={!!deleting}
        onCancel={closeDeleteModal}
        footer={null}
        destroyOnClose
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text type="secondary">ເລືອກວິທີການລຶບ:</Typography.Text>
          <Button
            block
            danger={deleteAction === 'full'}
            type={deleteAction === 'full' ? 'primary' : 'default'}
            style={{ height: 'auto', padding: '10px 12px', textAlign: 'left' }}
            onClick={() => setDeleteAction('full')}
          >
            <div>
              <div style={{ fontWeight: 600 }}>1. ລຶບອອກຈາກຂໍ້ມູນ ແລະ ເຄື່ອງສະແກນ</div>
              <div style={{ fontSize: 12, whiteSpace: 'normal' }}>
                ລຶບຂໍ້ມູນພະນັກງານອອກຈາກລະບົບແບບຖາວອນ (ປະຫວັດການເຮັດວຽກຈະຫາຍໄປພ້ອມກັນ) ແລະ ຕັ້ງຄິວລຶບອອກຈາກເຄື່ອງສະແກນ
              </div>
            </div>
          </Button>
          <Button
            block
            danger={deleteAction === 'deviceOnly'}
            type={deleteAction === 'deviceOnly' ? 'primary' : 'default'}
            style={{ height: 'auto', padding: '10px 12px', textAlign: 'left' }}
            onClick={() => setDeleteAction('deviceOnly')}
          >
            <div>
              <div style={{ fontWeight: 600 }}>2. ລຶບອອກຈາກເຄື່ອງສະແກນຢ່າງດຽວ</div>
              <div style={{ fontSize: 12, whiteSpace: 'normal' }}>
                ຂໍ້ມູນ ແລະ ປະຫວັດການເຮັດວຽກຍັງຄົງຢູ່ຄືເກົ່າ — ແຕ່ຈະຕັ້ງຄິວລຶບອອກຈາກເຄື່ອງສະແກນ ແລະ ລ້າງລະຫັດເຄື່ອງສະແກນ ເພື່ອໃຫ້ນຳໄປໃຊ້ກັບຄົນອື່ນໄດ້
              </div>
            </div>
          </Button>
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            ໝາຍເຫດ: ການລຶບອອກຈາກເຄື່ອງສະແກນຍັງບໍ່ທັນໄດ້ທົດສອບກັບເຄື່ອງຈິງ — ກະລຸນາກວດສອບທີ່ເຄື່ອງອີກຄັ້ງຫຼັງຈາກນີ້
          </Typography.Text>
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={closeDeleteModal}>ຍົກເລີກ</Button>
              <Button danger type="primary" disabled={!deleteAction} loading={deletingBusy} onClick={confirmDelete}>
                ຢືນຢັນ
              </Button>
            </Space>
          </div>
        </Space>
      </Modal>
    </List>
  );
};
