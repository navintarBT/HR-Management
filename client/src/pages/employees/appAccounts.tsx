import { useMemo, useState } from 'react';
import { List } from '@refinedev/antd';
import { useCustom, useGetIdentity } from '@refinedev/core';
import { Link } from 'react-router-dom';
import { Table, Input, Select, Space, Tag, Button, Typography, Checkbox, Alert, Card, Row, Col, Statistic } from 'antd';
import { EditOutlined, SearchOutlined, PlusOutlined, ClearOutlined, HistoryOutlined } from '@ant-design/icons';
import { AppDayHistory } from '../../components/AppDayHistory';
import type { Identity } from '../../types';
import { API_URL } from '../../providers/axios';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import {
  APP_ACCOUNT_STATUS,
  AppAccountEditModal,
  AppPassword,
  RegisteredId,
  formatAccountTime,
  idMismatch,
  type AppAccount,
  type AccountOwner,
} from '../../components/EmployeeAppAccount';

interface Row extends AppAccount {
  employee: {
    _id: string;
    employeeCode: string | null;
    firstName: string;
    lastName: string;
    status: string;
    position: string | null;
    positionId: string | null;
    department: string | null;
    departmentId: string | null;
  };
}

const nameOf = (r: Row) => `${r.employee.firstName} ${r.employee.lastName}`.trim();

// The department / position filters' "none set" choice.
const NONE = '__none';
type PasswordFilter = 'all' | 'known' | 'unknown';

// Every employee's account for the ROMEO app (/me) in one table: the username,
// the password (admins only, hidden until clicked — known from the
// registration, a password set here, or the next sign-in), where it stands,
// when the password was set and last sign-in. Admins edit it here too
// (AppAccountEditModal): username, a new password, or the code it belongs to.
export const EmployeeAppAccountsPage: React.FC = () => {
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  const { data, isLoading, refetch } = useCustom<Row[]>({ url: `${API_URL}/employee-accounts`, method: 'get' });
  const rows = data?.data ?? [];

  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState<string>();
  const [position, setPosition] = useState<string>();
  const [status, setStatus] = useState<AppAccount['status'] | 'all'>('all');
  const [passwordFilter, setPasswordFilter] = useState<PasswordFilter>('all');
  const [onlyIdMismatch, setOnlyIdMismatch] = useState(false);
  const [showLeft, setShowLeft] = useState(false);
  const [revealAll, setRevealAll] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [historyOf, setHistoryOf] = useState<Row | null>(null);

  const listed = useMemo(() => rows.filter((r) => showLeft || r.employee.status === 'active' || r.status !== 'none'), [rows, showLeft]);
  const inDepartment = (r: Row, id = department) => !id || (id === NONE ? !r.employee.departmentId : r.employee.departmentId === id);
  const inPosition = (r: Row, id = position) => !id || (id === NONE ? !r.employee.positionId : r.employee.positionId === id);

  // Choices taken from the people listed, each with how many there are;
  // positions narrow to the department picked (named with theirs otherwise).
  const departmentOptions = useMemo(() => {
    const seen = new Map<string, { label: string; count: number }>();
    for (const r of listed) {
      const id = r.employee.departmentId ?? NONE;
      const entry = seen.get(id) ?? { label: r.employee.department ?? 'ບໍ່ມີພະແນກ', count: 0 };
      entry.count += 1;
      seen.set(id, entry);
    }
    return [...seen.entries()]
      .sort(([a, x], [b, y]) => (a === NONE ? 1 : b === NONE ? -1 : x.label.localeCompare(y.label)))
      .map(([value, { label, count }]) => ({ value, label: `${label} (${count})` }));
  }, [listed]);
  const positionOptions = useMemo(() => {
    const seen = new Map<string, { label: string; count: number }>();
    for (const r of listed) {
      if (!inDepartment(r)) continue;
      const id = r.employee.positionId ?? NONE;
      const name = r.employee.position ?? 'ບໍ່ມີຕຳແໜ່ງ';
      const entry = seen.get(id) ?? { label: !department && id !== NONE && r.employee.department ? `${name} · ${r.employee.department}` : name, count: 0 };
      entry.count += 1;
      seen.set(id, entry);
    }
    return [...seen.entries()]
      .sort(([a, x], [b, y]) => (a === NONE ? 1 : b === NONE ? -1 : x.label.localeCompare(y.label)))
      .map(([value, { label, count }]) => ({ value, label: `${label} (${count})` }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listed, department]);

  // The cards count the department / position picked.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scoped = useMemo(() => listed.filter((r) => inDepartment(r) && inPosition(r)), [listed, department, position]);
  const working = scoped.filter((r) => r.employee.status === 'active');
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped
      .filter((r) => status === 'all' || r.status === status)
      .filter((r) => passwordFilter === 'all' || (passwordFilter === 'known' ? !!r.password : r.status === 'active' && !r.password))
      .filter((r) => !onlyIdMismatch || idMismatch(r, r.employee.employeeCode))
      .filter(
        (r) =>
          !q ||
          (r.employee.employeeCode ?? '').includes(q) ||
          nameOf(r).toLowerCase().includes(q) ||
          (r.username ?? '').includes(q)
      )
      .sort((a, b) => (a.employee.employeeCode ?? '').localeCompare(b.employee.employeeCode ?? ''));
  }, [scoped, search, status, passwordFilter, onlyIdMismatch]);
  const mismatchCount = scoped.filter((r) => idMismatch(r, r.employee.employeeCode)).length;
  const filtered = !!search.trim() || !!department || !!position || status !== 'all' || passwordFilter !== 'all' || onlyIdMismatch;
  const clearFilters = () => {
    setSearch('');
    setDepartment(undefined);
    setPosition(undefined);
    setStatus('all');
    setPasswordFilter('all');
    setOnlyIdMismatch(false);
  };

  const owner: AccountOwner | null = editing
    ? { _id: editing.employee._id, employeeCode: editing.employee.employeeCode, name: nameOf(editing) }
    : null;

  return (
    <List title="ບັນຊີແອັບພະນັກງານ" breadcrumb={false} headerButtons={<Link to="/employees">ກັບໄປລາຍຊື່ພະນັກງານ</Link>}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="ພະນັກງານທີ່ເຮັດວຽກ" value={working.length} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="ລົງທະບຽນແລ້ວ" value={working.filter((r) => r.status === 'active').length} valueStyle={{ color: '#389e0d' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="ຍັງບໍ່ໄດ້ລົງທະບຽນ" value={working.filter((r) => r.status === 'none').length} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title="ຣີເຊັດແລ້ວ ລໍຖ້າລົງທະບຽນໃໝ່" value={working.filter((r) => r.status === 'reset').length} valueStyle={{ color: '#d46b08' }} />
          </Card>
        </Col>
      </Row>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        className="app-accounts-note"
        message={
          isAdmin
            ? 'ລະຫັດຜ່ານເຫັນສະເພາະແອດມິນ — ກົດຮູບຕາເພື່ອເບິ່ງ. ບັນຊີທີ່ລົງທະບຽນກ່ອນ 22/11/2026 ຈະເຫັນລະຫັດເມື່ອພະນັກງານເຂົ້າລະບົບຄັ້ງຕໍ່ໄປ ຫຼື ເມື່ອກົດ ແກ້ໄຂ ຕັ້ງລະຫັດໃໝ່ໃຫ້'
            : 'ລະຫັດຜ່ານເຫັນສະເພາະແອດມິນ'
        }
      />
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap className="app-accounts-filters">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="ຄົ້ນຫາ ລະຫັດ, ຊື່ ຫຼື ຊື່ຜູ້ໃຊ້"
            style={{ width: 260 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            className="filter-department"
            style={{ width: 220 }}
            placeholder="ກອງຕາມພະແນກ"
            allowClear
            showSearch
            optionFilterProp="label"
            value={department}
            onChange={(v?: string) => {
              setDepartment(v);
              // A position from another department no longer applies.
              if (v && position && !listed.some((r) => inDepartment(r, v) && inPosition(r))) setPosition(undefined);
            }}
            options={departmentOptions}
          />
          <Select
            className="filter-position"
            style={{ width: 260 }}
            placeholder="ກອງຕາມຕຳແໜ່ງ"
            allowClear
            showSearch
            optionFilterProp="label"
            value={position}
            onChange={(v?: string) => setPosition(v)}
            options={positionOptions}
          />
          <Select
            className="filter-status"
            style={{ width: 200 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'ທຸກສະຖານະ' },
              { value: 'active', label: APP_ACCOUNT_STATUS.active.label },
              { value: 'none', label: APP_ACCOUNT_STATUS.none.label },
              { value: 'reset', label: 'ຣີເຊັດແລ້ວ' },
            ]}
          />
          {isAdmin && (
            <Select
              className="filter-password"
              style={{ width: 210 }}
              value={passwordFilter}
              onChange={setPasswordFilter}
              options={[
                { value: 'all', label: 'ລະຫັດຜ່ານ: ທັງໝົດ' },
                { value: 'known', label: 'ລະຫັດຜ່ານ: ເຫັນແລ້ວ' },
                { value: 'unknown', label: 'ລະຫັດຜ່ານ: ຍັງບໍ່ຮູ້' },
              ]}
            />
          )}
        </Space>
        <Space wrap style={{ marginTop: 8 }}>
          <Checkbox checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)}>
            ສະແດງຄົນທີ່ບໍ່ໄດ້ເຮັດວຽກແລ້ວ
          </Checkbox>
          {isAdmin && (
            <Checkbox checked={revealAll} onChange={(e) => setRevealAll(e.target.checked)} className="reveal-all-passwords">
              ສະແດງລະຫັດຜ່ານທັງໝົດ
            </Checkbox>
          )}
          <Checkbox checked={onlyIdMismatch} onChange={(e) => setOnlyIdMismatch(e.target.checked)} className="only-id-mismatch">
            <Typography.Text type={mismatchCount ? 'danger' : undefined}>ສະເພາະ ID ບໍ່ກົງກັບລະບົບ ({mismatchCount})</Typography.Text>
          </Checkbox>
          <Typography.Text type="secondary" className="shown-count">
            {shown.length} ຄົນ
          </Typography.Text>
          {filtered && (
            <Button size="small" icon={<ClearOutlined />} onClick={clearFilters}>
              ລ້າງຕົວກອງ
            </Button>
          )}
        </Space>
      </div>
      <Table<Row>
        rowKey={(r) => r.employee._id}
        loading={isLoading}
        dataSource={shown}
        size="middle"
        sticky={{ offsetHeader }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true, pageSizeOptions: [20, 50, 100, 200] }}
        // Wider than most screens: scrolls sideways rather than squeezing the
        // Lao text into broken lines.
        scroll={{ x: isAdmin ? 1680 : 1420 }}
        className="app-accounts-table"
        columns={[
          { title: 'ລະຫັດ', width: 80, render: (_, r) => r.employee.employeeCode ?? '-' },
          {
            title: 'ຊື່ ນາມສະກຸນ',
            width: 170,
            render: (_, r) => (
              <Space size={4} wrap>
                <Link to={`/employees/show/${r.employee._id}`}>{nameOf(r) || '-'}</Link>
                {r.employee.status !== 'active' && <Tag>ບໍ່ໄດ້ເຮັດວຽກແລ້ວ</Tag>}
              </Space>
            ),
          },
          {
            title: 'ພະແນກ',
            width: 120,
            sorter: (a, b) => (a.employee.department ?? '').localeCompare(b.employee.department ?? ''),
            render: (_, r) => r.employee.department ?? '-',
          },
          {
            title: 'ຕຳແໜ່ງ',
            width: 150,
            sorter: (a, b) => (a.employee.position ?? '').localeCompare(b.employee.position ?? ''),
            render: (_, r) => r.employee.position ?? '-',
          },
          {
            title: 'ຊື່ຜູ້ໃຊ້',
            width: 140,
            render: (_, r) => (r.username ? <Typography.Text strong copyable>{r.username}</Typography.Text> : <Typography.Text type="secondary">-</Typography.Text>),
          },
          // The ID typed at registration — beside the username and password,
          // so all three sign-in details read in one place; red when it isn't
          // the code the account belongs to now (an admin moved it).
          {
            title: 'ID ທີ່ລົງທະບຽນ',
            width: 140,
            render: (_, r) => <RegisteredId account={r} ownCode={r.employee.employeeCode} />,
          },
          ...(isAdmin ? [{ title: 'ລະຫັດຜ່ານ', width: 150, render: (_: unknown, r: Row) => <AppPassword account={r} reveal={revealAll} /> }] : []),
          {
            title: 'ສະຖານະ',
            width: 160,
            render: (_, r) => (
              <Space size={4} wrap>
                <Tag color={APP_ACCOUNT_STATUS[r.status].color}>{r.status === 'reset' ? 'ຣີເຊັດແລ້ວ' : APP_ACCOUNT_STATUS[r.status].label}</Tag>
                {r.isActive === false && <Tag color="red">ປິດແລ້ວ</Tag>}
              </Space>
            ),
          },
          { title: 'ຕັ້ງລະຫັດຜ່ານເມື່ອ', width: 140, render: (_, r) => formatAccountTime(r.passwordSetAt) },
          { title: 'ເຂົ້າລະບົບຫຼ້າສຸດ', width: 140, render: (_, r) => formatAccountTime(r.lastLoginAt) },
          { title: 'ຮູບຫຼັກຖານ', width: 90, align: 'right', render: (_, r) => r.evidenceCount || '-' },
          {
            title: '',
            width: isAdmin ? 200 : 100,
            fixed: 'right' as const,
            render: (_: unknown, r: Row) => (
              <Space size={4}>
                <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistoryOf(r)} className="open-history">
                  ປະຫວັດ
                </Button>
                {isAdmin && !(r.status === 'none' && r.employee.status !== 'active') && (
                  <Button size="small" icon={r.status === 'none' ? <PlusOutlined /> : <EditOutlined />} onClick={() => setEditing(r)}>
                    {r.status === 'none' ? 'ສ້າງບັນຊີ' : 'ແກ້ໄຂ'}
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <AppAccountEditModal owner={owner} account={editing} onClose={() => setEditing(null)} onSaved={() => refetch()} />
      <AppDayHistory
        person={historyOf ? { _id: historyOf.employee._id, employeeCode: historyOf.employee.employeeCode, name: nameOf(historyOf) } : null}
        onClose={() => setHistoryOf(null)}
      />
    </List>
  );
};
