import { useMemo, useRef, useState } from 'react';
import { List, useSelect } from '@refinedev/antd';
import { useCustom, useGetIdentity, useList, useNotification } from '@refinedev/core';
import { Alert, Button, Checkbox, Dropdown, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { DownOutlined, SearchOutlined } from '@ant-design/icons';
import type { Department, Employee, Identity, ScannerDevice } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { API_URL, axiosInstance } from '../../providers/axios';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';

const departmentName = (e: Employee) => (typeof e.department === 'object' ? e.department?.name : undefined);
const rowChanged = (row: Employee, previous: Employee) => row !== previous;

// ສິດໃຊ້ເຄື່ອງສະແກນ: which scanners each person may scan on. "ທຸກເຄື່ອງ" (no
// list) also covers scanners added later; otherwise only the ticked ones. A new
// person starts with it off, on the scanners there were then (routes/employees.js). Saved
// on each click — sync-enabled scanners get the person (with their face/finger)
// or lose them right away; a scanner with sync off follows once it's switched
// on (server: routes/deviceUsers.js, utils/scannerAccess.js). Also here: who is
// an admin of the scanners, which is about the scanners' own menu and nothing on
// this website (that's the account's role).
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

  const [savedAdmin, setSavedAdmin] = useState<Record<string, boolean>>({});
  const isScannerAdmin = (e: Employee) => (e._id in savedAdmin ? savedAdmin[e._id] : !!e.scannerAdmin);

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [onlyAdmins, setOnlyAdmins] = useState(false);
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
      if (onlyAdmins && !isScannerAdmin(e)) return false;
      if (!q) return true;
      return [e.employeeCode, e.deviceUserId, e.firstName, e.lastName, e.nameEn].some((v) => v?.toLowerCase().includes(q));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeesData?.data, search, departmentFilter, onlyAdmins, savedAdmin]);
  const adminCount = (employeesData?.data ?? []).filter(isScannerAdmin).length;

  const [busyId, setBusyId] = useState<string | null>(null);
  // With everyone showing the table is thousands of cells, and a click here would
  // draw them all. Cells draw again only when their row changes (rowChanged), so a
  // person keeps the same row object until something about them does.
  const rowCache = useRef(new Map<string, { row: Employee; deps: unknown[] }>());
  const devicesKey = devices.map((d) => `${d.serialNumber}:${!!d.syncEnabled}`).join();
  const tableRows = rows.map((e) => {
    const deps = [e, accessOf(e), isScannerAdmin(e), busyId === e._id, devicesKey, isAdmin];
    const cached = rowCache.current.get(e._id);
    if (cached && cached.deps.every((value, i) => value === deps[i])) return cached.row;
    const row = { ...e };
    rowCache.current.set(e._id, { row, deps });
    return row;
  });

  const fail = (err: any) => notify?.({ type: 'error', message: err?.response?.data?.message || 'ບັນທຶກບໍ່ສຳເລັດ' });
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

  const saveScannerAdmin = async (employee: Employee, admin: boolean) => {
    setBusyId(employee._id);
    try {
      const res = await axiosInstance.put(`${API_URL}/device-users/employee/${employee._id}/scanner-admin`, { admin });
      setSavedAdmin((prev) => ({ ...prev, [employee._id]: res.data.scannerAdmin }));
      const sentTo: string[] = res.data.sentTo;
      notify?.({
        type: 'success',
        message: `${employee.nameEn || employee.firstName || ''}: ${admin ? 'ເປັນແອດມິນເຄື່ອງ' : 'ເປັນຜູ້ໃຊ້ທົ່ວໄປ'}${
          sentTo.length ? ` · ສົ່ງໄປເຄື່ອງ ${sentTo.join(', ')}` : ' · ຍັງບໍ່ມີເຄື່ອງທີ່ເປີດຊິງ ຈະມີຜົນເມື່ອເປີດຊິງ'
        }`,
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusyId(null);
    }
  };

  // Once a scanner has an admin, its menu asks for one before it opens, so it asks
  // first, and warns about anyone who couldn't prove who they are on that scanner:
  // as its only admin, they'd leave nobody able to open it.
  const changeScannerAdmin = async (employee: Employee, admin: boolean) => {
    const name = [employee.firstName, employee.lastName].filter(Boolean).join(' ');
    if (!admin) {
      modal.confirm({
        title: `ປ່ຽນ ${name} ເປັນຜູ້ໃຊ້ທົ່ວໄປ?`,
        content: 'ຄົນນີ້ຈະເຂົ້າເມນູເຄື່ອງສະແກນບໍ່ໄດ້ອີກ. ຖ້າເຄື່ອງບໍ່ເຫຼືອແອດມິນຄົນອື່ນ ໃຜກໍເຂົ້າເມນູເຄື່ອງນັ້ນໄດ້',
        okText: 'ປ່ຽນ',
        cancelText: 'ຍົກເລີກ',
        onOk: () => saveScannerAdmin(employee, false),
      });
      return;
    }
    setBusyId(employee._id);
    let cannotVerify: string[] = [];
    try {
      const { data } = await axiosInstance.get<{ devices: { serialNumber: string; allowed: boolean; canVerify: boolean }[] }>(
        `${API_URL}/device-users/employee/${employee._id}`
      );
      const approved = devices.map((d) => d.serialNumber);
      cannotVerify = data.devices.filter((d) => d.allowed && !d.canVerify && approved.includes(d.serialNumber)).map((d) => d.serialNumber);
    } catch (err) {
      fail(err);
      return;
    } finally {
      setBusyId(null);
    }
    modal.confirm({
      title: `ຕັ້ງ ${name} ເປັນແອດມິນເຄື່ອງ?`,
      width: 520,
      content: (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text>
            ຄົນນີ້ຈະເຂົ້າເມນູຕັ້ງຄ່າຢູ່ເຄື່ອງສະແກນທີ່ມີສິດໄດ້. ເມື່ອເຄື່ອງມີແອດມິນແລ້ວ ຄົນອື່ນຈະເຂົ້າເມນູບໍ່ໄດ້ ຈົນກວ່າແອດມິນຈະສະແກນຢືນຢັນ. ບໍ່ກ່ຽວກັບສິດໃນເວັບນີ້
          </Typography.Text>
          {cannotVerify.length > 0 && (
            <Alert
              type="warning"
              showIcon
              message={`ຍັງບໍ່ມີໃບໜ້າ/ນິ້ວມືຂອງຄົນນີ້ທີ່ໃຊ້ໄດ້ຢູ່ເຄື່ອງ ${cannotVerify.join(', ')}`}
              description="ຖ້າເປັນແອດມິນຄົນດຽວຂອງເຄື່ອງ ຈະບໍ່ມີໃຜເຂົ້າເມນູເຄື່ອງນັ້ນໄດ້. ແນະນຳໃຫ້ລົງໃບໜ້າ/ນິ້ວມືກ່ອນ ຫຼື ກັບມາປ່ຽນເປັນຜູ້ໃຊ້ທົ່ວໄປຢູ່ໜ້ານີ້"
            />
          )}
        </Space>
      ),
      okText: cannotVerify.length ? 'ຕັ້ງຢູ່ດີ' : 'ຕັ້ງເປັນແອດມິນ',
      okButtonProps: cannotVerify.length ? { danger: true } : undefined,
      cancelText: 'ຍົກເລີກ',
      onOk: () => saveScannerAdmin(employee, true),
    });
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
            '"ທຸກເຄື່ອງ" ລວມເຖິງເຄື່ອງທີ່ເພີ່ມໃນພາຍຫຼັງ. ພະນັກງານໃໝ່ເລີ່ມຕົ້ນດ້ວຍ "ທຸກເຄື່ອງ" ປິດ — ໄດ້ສິດສະເພາະເຄື່ອງທີ່ມີຢູ່ຕອນເພີ່ມ, ເຄື່ອງທີ່ເພີ່ມພາຍຫຼັງຕ້ອງຕິກໃຫ້ເອງ. ' +
            'ຢາກປ່ຽນທີລະກຸ່ມ ໃຫ້ກັ່ນຕອງລາຍຊື່ກ່ອນ ແລ້ວໃຊ້ເມນູ ▾ ຢູ່ຫົວຖັນຂອງເຄື່ອງ'
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
          <Checkbox checked={onlyAdmins} onChange={(e) => setOnlyAdmins(e.target.checked)}>
            ສະເພາະແອດມິນເຄື່ອງ ({adminCount})
          </Checkbox>
          <Typography.Text type="secondary">{rows.length} ຄົນ</Typography.Text>
        </Space>
      </div>

      <Table
        dataSource={tableRows}
        rowKey="_id"
        loading={employeesLoading || devicesLoading}
        pagination={false}
        sticky={{ offsetHeader }}
        scroll={{ x: 'max-content' }}
        size="small"
      >
        <Table.Column title="ລະຫັດ" dataIndex="employeeCode" fixed="left" width={80} shouldCellUpdate={rowChanged} />
        <Table.Column
          title="ພະນັກງານ"
          fixed="left"
          shouldCellUpdate={rowChanged}
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
        <Table.Column title="ພະແນກ" shouldCellUpdate={rowChanged} render={(_, e: Employee) => departmentName(e) ?? '-'} />
        <Table.Column
          title="ສິດບົນເຄື່ອງ"
          shouldCellUpdate={rowChanged}
          render={(_, e: Employee) => (
            <Select
              className="scanner-role"
              size="small"
              style={{ width: 130 }}
              status={isScannerAdmin(e) ? 'warning' : undefined}
              disabled={!isAdmin || !e.deviceUserId || busyId === e._id}
              value={isScannerAdmin(e) ? 'admin' : 'user'}
              options={[
                { value: 'user', label: 'ຜູ້ໃຊ້ທົ່ວໄປ' },
                { value: 'admin', label: 'ແອດມິນເຄື່ອງ' },
              ]}
              onChange={(v: string) => changeScannerAdmin(e, v === 'admin')}
            />
          )}
        />
        <Table.Column
          title="ທຸກເຄື່ອງ"
          align="center"
          shouldCellUpdate={rowChanged}
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
            shouldCellUpdate={rowChanged}
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
          shouldCellUpdate={rowChanged}
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
