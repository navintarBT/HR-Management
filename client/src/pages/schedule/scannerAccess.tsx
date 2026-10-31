import { useMemo, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useCustom, useGetIdentity, useList, useNotification } from '@refinedev/core';
import { Alert, Button, Checkbox, Dropdown, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { DownOutlined, SearchOutlined } from '@ant-design/icons';
import type { Department, Employee, Identity, ScannerDevice } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { API_URL, axiosInstance } from '../../providers/axios';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';

const departmentName = (e: Employee) => (typeof e.department === 'object' ? e.department?.name : undefined);

// ສິດໃຊ້ເຄື່ອງສະແກນ: which scanners each person may scan on. "ທຸກເຄື່ອງ" (no
// list) also covers scanners added later; otherwise only the ticked ones. Saved
// on each click — sync-enabled scanners get the person (with their face/finger)
// or lose them right away; a scanner with sync off follows once it's switched
// on (server: routes/deviceUsers.js, utils/scannerAccess.js).
export const ScannerAccessPage: React.FC = () => {
  const { open: notify } = useNotification();
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();
  const [modal, modalContext] = Modal.useModal();

  const { data: devicesData, isLoading: devicesLoading } = useCustom<ScannerDevice[]>({
    url: `${API_URL}/device-users/devices`,
    method: 'get',
  });
  const devices = (devicesData?.data ?? []).filter((d) => d.approved);

  const { data: employeesData, isLoading: employeesLoading, refetch } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  // What's been saved here since the list loaded, by employee.
  const [saved, setSaved] = useState<Record<string, string[] | null>>({});
  const accessOf = (e: Employee) => (e._id in saved ? saved[e._id] : e.allowedScanners ?? null);
  const allows = (e: Employee, serial: string) => {
    const list = accessOf(e);
    return !list || list.includes(serial);
  };

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const { selectProps: departmentSelect } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (employeesData?.data ?? []).filter((e) => {
      const departmentId = typeof e.department === 'object' ? e.department?._id : e.department;
      if (departmentFilter && departmentId !== departmentFilter) return false;
      if (!q) return true;
      return [e.employeeCode, e.deviceUserId, e.firstName, e.lastName, e.nameEn].some((v) => v?.toLowerCase().includes(q));
    });
  }, [employeesData?.data, search, departmentFilter]);

  const fail = (err: any) => notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const save = async (employee: Employee, next: string[] | null) => {
    setBusyId(employee._id);
    try {
      const res = await axiosInstance.put(`${API_URL}/device-users/employee/${employee._id}/scanners`, { allowedScanners: next });
      setSaved((prev) => ({ ...prev, [employee._id]: res.data.allowedScanners }));
      const parts = [
        res.data.added.length ? `ສົ່ງໄປເຄື່ອງ ${res.data.added.join(', ')}` : '',
        res.data.removed.length ? `ລຶບອອກຈາກເຄື່ອງ ${res.data.removed.join(', ')}` : '',
      ].filter(Boolean);
      notify?.({ type: 'success', message: `${employee.nameEn || employee.firstName || ''}: ${parts.join(' · ') || 'ບັນທຶກແລ້ວ'}` });
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  const toggle = (employee: Employee, serial: string, checked: boolean) => {
    // From "every scanner", unticking one leaves all the others ticked.
    const current = accessOf(employee) ?? devices.map((d) => d.serialNumber);
    save(employee, checked ? [...new Set([...current, serial])] : current.filter((s) => s !== serial));
  };

  const [bulkSerial, setBulkSerial] = useState<string | null>(null);
  const bulk = (device: ScannerDevice, allowed: boolean) => {
    const targets = rows.filter((e) => allows(e, device.serialNumber) !== allowed);
    if (!targets.length) {
      notify?.({ type: 'success', message: allowed ? 'ທຸກຄົນໃນລາຍການນີ້ມີສິດຢູ່ແລ້ວ' : 'ບໍ່ມີໃຜໃນລາຍການນີ້ມີສິດຢູ່ແລ້ວ' });
      return;
    }
    modal.confirm({
      title: allowed
        ? `ໃຫ້ສິດໃຊ້ເຄື່ອງ ${device.serialNumber} ແກ່ ${targets.length} ຄົນ?`
        : `ຖອນສິດໃຊ້ເຄື່ອງ ${device.serialNumber} ຂອງ ${targets.length} ຄົນ?`,
      content: device.syncEnabled
        ? allowed
          ? 'ລະບົບຈະສົ່ງຊື່ ແລະ ໃບໜ້າ/ນິ້ວມື (ທີ່ໃຊ້ໄດ້) ຂອງເຂົາເຈົ້າໄປເຄື່ອງນີ້'
          : 'ລະບົບຈະລຶບເຂົາເຈົ້າ (ພ້ອມໃບໜ້າ/ນິ້ວມື) ອອກຈາກເຄື່ອງນີ້ — ຈະສະແກນຢູ່ເຄື່ອງນີ້ບໍ່ໄດ້ອີກ'
        : 'ເຄື່ອງນີ້ປິດຊິງຢູ່ — ບັນທຶກໄວ້ກ່ອນ ຈະມີຜົນເມື່ອເປີດຊິງ',
      okText: allowed ? 'ໃຫ້ສິດ' : 'ຖອນສິດ',
      okButtonProps: allowed ? undefined : { danger: true },
      cancelText: 'ຍົກເລີກ',
      onOk: async () => {
        setBulkSerial(device.serialNumber);
        try {
          const res = await axiosInstance.post(`${API_URL}/device-users/devices/${device.serialNumber}/access`, {
            employeeIds: targets.map((e) => e._id),
            allowed,
          });
          setSaved({});
          await refetch();
          notify?.({ type: 'success', message: `ປ່ຽນສິດແລ້ວ ${res.data.changed} ຄົນ` });
        } catch (err) {
          fail(err);
        } finally {
          setBulkSerial(null);
        }
      },
    });
  };

  return (
    <List title="ສິດໃຊ້ເຄື່ອງສະແກນ" breadcrumb={false}>
      {modalContext}
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="ເລືອກວ່າພະນັກງານແຕ່ລະຄົນສະແກນໄດ້ຢູ່ເຄື່ອງໃດ"
          description={
            'ລະບົບສົ່ງຊື່ ແລະ ໃບໜ້າ/ນິ້ວມື ໄປສະເພາະເຄື່ອງທີ່ມີສິດ ແລະ ລຶບອອກຈາກເຄື່ອງທີ່ຖອນສິດທັນທີ (ເຄື່ອງທີ່ເປີດຊິງ). ' +
            '"ທຸກເຄື່ອງ" ລວມເຖິງເຄື່ອງທີ່ເພີ່ມໃນພາຍຫຼັງ. ຢາກປ່ຽນທີລະກຸ່ມ ໃຫ້ກັ່ນຕອງລາຍຊື່ກ່ອນ ແລ້ວໃຊ້ເມນູ ▾ ຢູ່ຫົວຖັນຂອງເຄື່ອງ'
          }
        />
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="ຄົ້ນຫາ ລະຫັດ / ຊື່"
            style={{ width: 240 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            {...departmentSelect}
            allowClear
            placeholder="ທຸກພະແນກ"
            style={{ width: 200 }}
            value={departmentFilter}
            onChange={(v: any) => setDepartmentFilter(v)}
          />
          <Typography.Text type="secondary">{rows.length} ຄົນ</Typography.Text>
        </Space>
      </div>

      <Table
        dataSource={rows}
        rowKey="_id"
        loading={employeesLoading || devicesLoading}
        pagination={false}
        sticky={{ offsetHeader }}
        scroll={{ x: 'max-content' }}
        size="small"
      >
        <Table.Column title="ລະຫັດ" dataIndex="employeeCode" fixed="left" width={80} />
        <Table.Column
          title="ພະນັກງານ"
          fixed="left"
          render={(_, e: Employee) => (
            <Space direction="vertical" size={0}>
              <Typography.Text>{[e.firstName, e.lastName].filter(Boolean).join(' ')}</Typography.Text>
              {e.nameEn && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {e.nameEn}
                </Typography.Text>
              )}
              {!e.deviceUserId && <Tag color="orange">ບໍ່ມີລະຫັດເຄື່ອງສະແກນ</Tag>}
            </Space>
          )}
        />
        <Table.Column title="ພະແນກ" render={(_, e: Employee) => departmentName(e) ?? '-'} />
        <Table.Column
          title="ທຸກເຄື່ອງ"
          align="center"
          render={(_, e: Employee) => (
            <Switch
              size="small"
              checked={!accessOf(e)}
              disabled={!isAdmin}
              loading={busyId === e._id}
              // Off: start from every scanner ticked, then untick the ones they can't use.
              onChange={(on) => save(e, on ? null : devices.map((d) => d.serialNumber))}
            />
          )}
        />
        {devices.map((d) => (
          <Table.Column
            key={d.serialNumber}
            align="center"
            title={
              <Space direction="vertical" size={2} style={{ alignItems: 'center' }}>
                <Typography.Text strong style={{ fontSize: 12 }}>
                  {d.serialNumber}
                </Typography.Text>
                {d.info?.deviceName && (
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {d.info.deviceName}
                  </Typography.Text>
                )}
                {d.syncEnabled ? (
                  <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                    ຊິງ
                  </Tag>
                ) : (
                  <Tooltip title="ເຄື່ອງນີ້ປິດຊິງຢູ່ — ສິດຈະມີຜົນເມື່ອເປີດຊິງ">
                    <Tag style={{ marginInlineEnd: 0 }}>ປິດຊິງ</Tag>
                  </Tooltip>
                )}
                {isAdmin && (
                  <Dropdown
                    trigger={['click']}
                    menu={{
                      items: [
                        { key: 'allow', label: `ໃຫ້ສິດທຸກຄົນທີ່ສະແດງ (${rows.length})` },
                        { key: 'revoke', label: `ຖອນສິດທຸກຄົນທີ່ສະແດງ (${rows.length})`, danger: true },
                      ],
                      onClick: ({ key }) => bulk(d, key === 'allow'),
                    }}
                  >
                    <Button size="small" type="text" loading={bulkSerial === d.serialNumber}>
                      ທັງໝົດ <DownOutlined />
                    </Button>
                  </Dropdown>
                )}
              </Space>
            }
            render={(_, e: Employee) => (
              <Checkbox
                checked={allows(e, d.serialNumber)}
                disabled={!isAdmin || busyId === e._id}
                onChange={(ev) => toggle(e, d.serialNumber, ev.target.checked)}
              />
            )}
          />
        ))}
        <Table.Column
          title="ສະແກນໄດ້"
          render={(_, e: Employee) => {
            if (!accessOf(e)) return <Tag color="green">ທຸກເຄື່ອງ ({devices.length})</Tag>;
            const n = devices.filter((d) => allows(e, d.serialNumber)).length;
            return <Tag color={n ? 'blue' : 'red'}>{n ? `${n} ເຄື່ອງ` : 'ບໍ່ມີເຄື່ອງໃດ'}</Tag>;
          }}
        />
      </Table>
    </List>
  );
};
