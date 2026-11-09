import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, Modal, Radio, Space, Typography } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import type { Employee } from '../types';

// ພິມ / ສົ່ງອອກ on the pages with a staff table (ສະຫຼຸບເງິນເດືອນ, ການເຮັດແທນ,
// ປະຫວັດການສະແກນ, ລາຍງານການສະແກນ): pick what to print or export instead of
// filtering the page one department at a time — ທັງໝົດ (every department, one
// after the other: each on its own pages when printed, under a dividing row
// when exported) or chosen departments, and within each the positions to
// include (all ticked to start with). Laid out as before otherwise.

export type PrintSection = {
  key: string;
  departmentName: string;
  // The positions printed, by name — null when it's all of them.
  positionNames: string[] | null;
  employeeIds: Set<string>;
};

const NONE = '__none__';
const NO_DEPARTMENT = 'ບໍ່ມີພະແນກ';
const NO_POSITION = 'ບໍ່ມີຕຳແໜ່ງ';

type Ref = Employee['department'] | Employee['position'];
const keyOf = (v: Ref) => (v && typeof v === 'object' ? v._id : (v as string | undefined)) || NONE;
const nameOf = (v: Ref, fallback: string) => (v && typeof v === 'object' && v.name ? v.name : fallback);

type TreePosition = { key: string; name: string; employeeIds: string[] };
type TreeDepartment = { key: string; name: string; count: number; positions: TreePosition[] };

// Departments and their positions as the people actually are — so nobody is
// left out, whatever the position ↔ department links say.
function buildTree(employees: Employee[]): TreeDepartment[] {
  const departments = new Map<string, { name: string; positions: Map<string, TreePosition> }>();
  for (const e of employees) {
    const dKey = keyOf(e.department);
    if (!departments.has(dKey)) departments.set(dKey, { name: dKey === NONE ? NO_DEPARTMENT : nameOf(e.department, NO_DEPARTMENT), positions: new Map() });
    const positions = departments.get(dKey)!.positions;
    const pKey = keyOf(e.position);
    if (!positions.has(pKey)) positions.set(pKey, { key: pKey, name: pKey === NONE ? NO_POSITION : nameOf(e.position, NO_POSITION), employeeIds: [] });
    positions.get(pKey)!.employeeIds.push(e._id);
  }
  const byName = <T extends { key: string; name: string }>(a: T, b: T) =>
    a.key === NONE ? 1 : b.key === NONE ? -1 : a.name.localeCompare(b.name);
  return [...departments.entries()]
    .map(([key, d]) => {
      const positions = [...d.positions.values()].sort(byName);
      return { key, name: d.name, positions, count: positions.reduce((n, p) => n + p.employeeIds.length, 0) };
    })
    .sort(byName);
}

function sectionsFor(tree: TreeDepartment[], picked: Map<string, Set<string>>): PrintSection[] {
  return tree
    .filter((d) => picked.get(d.key)?.size)
    .map((d) => {
      const chosen = d.positions.filter((p) => picked.get(d.key)!.has(p.key));
      return {
        key: d.key,
        departmentName: d.name,
        positionNames: chosen.length === d.positions.length ? null : chosen.map((p) => p.name),
        employeeIds: new Set(chosen.flatMap((p) => p.employeeIds)),
      };
    })
    .filter((s) => s.employeeIds.size);
}

// The "(ເສີບ, ປ້ອງກັນ)" after a department's name when only some positions print.
export const positionsNote = (section: PrintSection) => (section.positionNames ? ` (${section.positionNames.join(', ')})` : '');

// What was picked, for a title: '' for every department (the page says ທັງໝົດ),
// otherwise the departments (and positions) by name.
export const pickedScope = (sections: PrintSection[], all: boolean) =>
  all ? '' : sections.map((s) => `${s.departmentName}${positionsNote(s)}`).join(', ');

// The dividing row above a department in an export.
export const sectionHeading = (section: PrintSection, count: number) =>
  `${section.departmentName === NO_DEPARTMENT ? '' : 'ພະແນກ '}${section.departmentName}${positionsNote(section)} · ${count} ຄົນ`;

// Items in the sections' order, each group under its section — `idOf` gives an
// item's employee id. Empty groups are left out.
export function groupBySection<T>(sections: PrintSection[], items: T[], idOf: (item: T) => string) {
  return sections
    .map((section) => ({ section, items: items.filter((item) => section.employeeIds.has(idOf(item))) }))
    .filter((g) => g.items.length);
}

type Mode = 'all' | 'pick' | 'current';

export function PrintPickerModal({
  open,
  onCancel,
  onPrint,
  onPrintCurrent,
  employees,
  initialDepartment,
  initialPosition,
  currentLabel,
  verb = 'ພິມ',
  okText,
  allNote = 'ແຕ່ລະພະແນກຂຶ້ນໜ້າໃໝ່',
  className = 'print-picker',
}: {
  open: boolean;
  onCancel: () => void;
  onPrint: (sections: PrintSection[], options: { all: boolean }) => void;
  // Print what the page shows now — offered when it's narrowed to one person.
  onPrintCurrent?: () => void;
  employees: Employee[];
  initialDepartment?: string;
  initialPosition?: string;
  currentLabel?: string;
  // ພິມ, or ສົ່ງອອກ for an export — the words around the choice.
  verb?: string;
  okText?: string;
  allNote?: string;
  className?: string;
}) {
  const tree = useMemo(() => buildTree(employees), [employees]);
  const [mode, setMode] = useState<Mode>('all');
  const [picked, setPicked] = useState<Map<string, Set<string>>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Each time it opens: starts from what the page is filtered to.
  useEffect(() => {
    if (!open) return;
    const filtered = !!(initialDepartment || initialPosition);
    setMode(currentLabel && onPrintCurrent ? 'current' : filtered ? 'pick' : 'all');
    // The department filtered to (or every one), with only the position
    // filtered to if there is one — opened so that's visible.
    const start = new Map<string, Set<string>>();
    if (filtered) {
      for (const d of tree) {
        if (initialDepartment && d.key !== initialDepartment) continue;
        const positions = d.positions.filter((p) => !initialPosition || p.key === initialPosition);
        if (positions.length) start.set(d.key, new Set(positions.map((p) => p.key)));
      }
    }
    setExpanded(new Set(initialPosition ? start.keys() : []));
    setPicked(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allPicked = useMemo(() => new Map(tree.map((d) => [d.key, new Set(d.positions.map((p) => p.key))])), [tree]);
  const sections = useMemo(() => sectionsFor(tree, mode === 'all' ? allPicked : picked), [tree, mode, allPicked, picked]);
  const people = sections.reduce((n, s) => n + s.employeeIds.size, 0);

  const setDepartment = (d: TreeDepartment, on: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (on) next.set(d.key, new Set(d.positions.map((p) => p.key)));
      else next.delete(d.key);
      return next;
    });
  const setPosition = (d: TreeDepartment, p: TreePosition, on: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(d.key) ?? []);
      if (on) set.add(p.key);
      else set.delete(p.key);
      if (set.size) next.set(d.key, set);
      else next.delete(d.key);
      return next;
    });
  const toggleOpen = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Modal
      open={open}
      title={okText ?? verb}
      width={560}
      onCancel={onCancel}
      okText={okText ?? verb}
      cancelText="ຍົກເລີກ"
      okButtonProps={{ disabled: mode !== 'current' && !people }}
      onOk={() => (mode === 'current' ? onPrintCurrent?.() : onPrint(sections, { all: mode === 'all' }))}
      destroyOnClose
      className={className}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
          <Space direction="vertical">
            <Radio value="all">
              {verb}ທັງໝົດ — ທຸກພະແນກ ({tree.length} ພະແນກ · {employees.length} ຄົນ), {allNote}
            </Radio>
            <Radio value="pick">ເລືອກພະແນກ ແລະ ຕຳແໜ່ງ</Radio>
            {currentLabel && onPrintCurrent && <Radio value="current">ສະເພາະທີ່ກອງໄວ້ໃນໜ້າ: {currentLabel}</Radio>}
          </Space>
        </Radio.Group>

        {mode === 'pick' && (
          <div className="print-picker-list" style={{ border: '1px solid var(--ant-color-border, #d9d9d9)', borderRadius: 8, maxHeight: 360, overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)' }}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                ກົດ ▸ ເພື່ອເລືອກຕຳແໜ່ງ
              </Typography.Text>
              <Space size={4}>
                <Button size="small" type="link" onClick={() => setPicked(new Map(allPicked))}>
                  ເລືອກທຸກພະແນກ
                </Button>
                <Button size="small" type="link" onClick={() => setPicked(new Map())}>
                  ລ້າງ
                </Button>
              </Space>
            </div>
            {tree.map((d) => {
              const chosen = picked.get(d.key);
              const isOpen = expanded.has(d.key);
              return (
                <div key={d.key} className="print-picker-department" style={{ borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px' }}>
                    <Button
                      size="small"
                      type="text"
                      aria-label={`ຕຳແໜ່ງໃນ ${d.name}`}
                      icon={isOpen ? <DownOutlined /> : <RightOutlined />}
                      onClick={() => toggleOpen(d.key)}
                    />
                    <Checkbox
                      checked={!!chosen && chosen.size === d.positions.length}
                      indeterminate={!!chosen && chosen.size > 0 && chosen.size < d.positions.length}
                      onChange={(e) => setDepartment(d, e.target.checked)}
                    >
                      <Typography.Text strong>{d.name}</Typography.Text>{' '}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        ({d.count} ຄົນ)
                      </Typography.Text>
                    </Checkbox>
                    <Typography.Link style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => toggleOpen(d.key)}>
                      ຕຳແໜ່ງ {chosen ? chosen.size : 0}/{d.positions.length}
                    </Typography.Link>
                  </div>
                  {isOpen && (
                    <div className="print-picker-positions" style={{ padding: '0 10px 8px 46px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {d.positions.map((p) => (
                        <Checkbox key={p.key} checked={!!chosen?.has(p.key)} onChange={(e) => setPosition(d, p, e.target.checked)}>
                          {p.name}{' '}
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            ({p.employeeIds.length} ຄົນ)
                          </Typography.Text>
                        </Checkbox>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {mode !== 'current' && (
          <Typography.Text type={people ? undefined : 'secondary'} className="print-picker-summary">
            {people ? `ຈະ${verb} ${sections.length} ພະແນກ · ${people} ຄົນ` : 'ຍັງບໍ່ໄດ້ເລືອກພະແນກ'}
          </Typography.Text>
        )}
      </Space>
    </Modal>
  );
}

// Prints once the chosen sections are on the page, and puts the page back to
// printing what it shows when the print dialog closes.
export function usePrintJob() {
  const [job, setJob] = useState<PrintSection[] | null>(null);
  useEffect(() => {
    if (!job) return undefined;
    const done = () => setJob(null);
    window.addEventListener('afterprint', done);
    // Long enough for the ພິມ dialog to close and the sections to draw.
    const timer = window.setTimeout(() => window.print(), 300);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', done);
    };
  }, [job]);
  return { job, print: setJob };
}
