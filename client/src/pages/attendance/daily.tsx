import { useMemo, useState } from 'react';
import { List } from '@refinedev/antd';
import { useList, useCustom } from '@refinedev/core';
import { Table, Select, Button, Space, Typography, Input, DatePicker, message } from 'antd';
import { LeftOutlined, RightOutlined, SearchOutlined, DownloadOutlined, FileExcelOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { AttendanceDaily, Employee, ShiftCategory } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { lateTier, formatMinutes } from '../../utils/lateSeverity';
import { API_URL } from '../../providers/axios';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';
import { downloadCsv, downloadXlsx, type SheetCell, type SheetSpec } from '../../utils/exportSheet';
import { PrintPickerModal, groupBySection, pickedScope, sectionHeading, type PrintSection } from '../../components/PrintPicker';

const { RangePicker } = DatePicker;
// The most the server's /attendance-daily/range serves per request — about a
// quarter, enough for any report this page is used for.
const MAX_RANGE_DAYS = 93;

function idOf(value: unknown) {
  return value && typeof value === 'object' ? (value as { _id: string })._id : (value as string | undefined);
}

// Same bg/text pairs as the attendance summary grid's CELL_STYLE, so a
// "late"/"incomplete"/"absent" number reads as the same color everywhere.
// "earlyLeave" (ກັບກ່ອນ) reuses the "late" look — same severity, opposite end
// of the shift.
const BADGE_STYLE = {
  late: { bg: '#fff7e6', text: '#d46b08' },
  incomplete: { bg: '#f9f0ff', text: '#722ed1' },
  absent: { bg: '#fff1f0', text: '#cf1322' },
  substituted: { bg: '#e6fffb', text: '#08979c' },
};

function Badge({ value, unit, kind }: { value: number; unit: string; kind: keyof typeof BADGE_STYLE }) {
  if (value <= 0) return <span style={{ color: '#bfbfbf' }}>-</span>;
  const style = BADGE_STYLE[kind];
  return (
    <span style={{ background: style.bg, color: style.text, borderRadius: 4, padding: '2px 8px', fontSize: 12, fontWeight: 500 }}>
      {value} {unit}
    </span>
  );
}

// One row per employee (pulled fresh from the current employee list, not from
// whatever AttendanceDaily rows happen to exist — those can be orphaned if an
// employee was since deleted), aggregated over a chosen date range.
export const AttendanceDailyPage: React.FC = () => {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('month'), dayjs().endOf('month')]);
  const rangeStartKey = range[0].format('YYYY-MM-DD');
  const rangeEndKey = range[1].format('YYYY-MM-DD');
  const goToMonth = (m: Dayjs) => setRange([m.startOf('month'), m.endOf('month')]);

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [positionFilter, setPositionFilter] = useState<string>();
  // One or more people picked by name — for a report (or an export) on just them.
  const [personFilter, setPersonFilter] = useState<string[]>([]);

  const { data: employeesData, isLoading: employeesLoading } = useList<Employee>({
    resource: 'employees',
    filters: [{ field: 'status_in', operator: 'eq', value: 'active,resigned' }],
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE },
    sorters: [{ field: 'employeeCode', order: 'asc' }],
  });
  const allEmployees = employeesData?.data ?? [];

  const departmentOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEmployees) {
      const dept = e.department;
      if (dept && typeof dept === 'object') map.set(dept._id, dept.name);
    }
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [allEmployees]);

  const positionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of allEmployees) {
      const pos = e.position;
      if (pos && typeof pos === 'object') map.set(pos._id, pos.name);
    }
    return Array.from(map, ([value, label]) => ({ value, label }));
  }, [allEmployees]);

  const inDepartmentAndPosition = (e: Employee, department = departmentFilter, position = positionFilter) =>
    (!department || idOf(e.department) === department) && (!position || idOf(e.position) === position);

  // The people picker offers only those in the department/position picked.
  const personOptions = useMemo(
    () =>
      allEmployees
        .filter((e) => inDepartmentAndPosition(e))
        .map((e) => ({ value: e._id, label: `${e.employeeCode ?? ''} ${e.firstName ?? ''} ${e.lastName ?? ''}`.trim() })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allEmployees, departmentFilter, positionFilter]
  );
  // Picking another department/position drops the people picked who aren't in it.
  const narrowPeople = (department: string | undefined, position: string | undefined) =>
    setPersonFilter((picked) => picked.filter((id) => {
      const e = allEmployees.find((x) => x._id === id);
      return !!e && inDepartmentAndPosition(e, department, position);
    }));

  const employees = useMemo(() => {
    const q = search.trim().toLowerCase();
    const picked = new Set(personFilter);
    return allEmployees.filter((e) => {
      if (q) {
        const name = `${e.firstName ?? ''} ${e.lastName ?? ''}`.toLowerCase();
        const code = (e.employeeCode ?? '').toLowerCase();
        if (!name.includes(q) && !code.includes(q)) return false;
      }
      if (!inDepartmentAndPosition(e)) return false;
      if (picked.size && !picked.has(e._id)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allEmployees, search, departmentFilter, positionFilter, personFilter]);

  // Every record in range, bounded by the range rather than a row count —
  // any fixed page size (5000, then 20000 here) silently drops the newest
  // rows once staff × days passes it, which a longer custom range already did.
  const { data: dailyData, isLoading: dailyLoading } = useCustom<AttendanceDaily[]>({
    url: `${API_URL}/attendance-daily/range`,
    method: 'get',
    config: { query: { from: rangeStartKey, to: rangeEndKey } },
  });
  const dailyRows = dailyData?.data ?? [];

  // Late policy is now locked to one shared value across every shift
  // category (see ໝວດໝູ່ກະ — only the "apply to every category" bulk tool can
  // change it), so any one category's numbers are the real, current
  // system-wide grace/severe boundary — used to spell out the actual minute
  // counts in these column headers instead of a generic "X"/"1 ຊົ່ວໂມງ".
  const { data: categoriesData } = useList<ShiftCategory>({
    resource: 'shift-categories',
    pagination: { pageSize: 1 },
  });
  const latePolicy = categoriesData?.data?.[0];
  const graceLabel = latePolicy ? formatMinutes(latePolicy.graceMinutes) : 'X ນາທີ';
  const severeLabel = latePolicy?.severeLateMinutes != null ? formatMinutes(latePolicy.severeLateMinutes) : 'X';

  const summaryByEmployee = useMemo(() => {
    const map: Record<
      string,
      {
        workedHours: number;
        expectedHours: number;
        lateMinutes: number;
        earlyLeaveMinutes: number;
        lateDays: number;
        moderateLateDays: number;
        severeLateDays: number;
        noScanOutDays: number;
        absentDays: number;
        substitutedDays: number;
      }
    > = {};
    for (const d of dailyRows) {
      // A record whose employee was since deleted has nowhere to attribute it to — skip it.
      if (!d.employee) continue;
      const empId = typeof d.employee === 'object' ? d.employee._id : d.employee;
      if (!map[empId])
        map[empId] = {
          workedHours: 0,
          expectedHours: 0,
          lateMinutes: 0,
          earlyLeaveMinutes: 0,
          lateDays: 0,
          moderateLateDays: 0,
          severeLateDays: 0,
          noScanOutDays: 0,
          absentDays: 0,
          substitutedDays: 0,
        };
      map[empId].workedHours += d.workedHours || 0;
      map[empId].expectedHours += d.expectedHours || 0;
      map[empId].lateMinutes += d.lateMinutes || 0;
      map[empId].earlyLeaveMinutes += d.earlyLeaveMinutes || 0;
      if (d.status === 'late') {
        map[empId].lateDays += 1;
        // Sub-tiers of "late", same boundaries (graceMinutes/severeLateMinutes
        // as they stood on this specific day) as ປະຫວັດການສະແກນເຂົ້າ-ອອກວຽກ's labels.
        const tier = lateTier(d.lateMinutes, d.graceMinutes, d.severeLateMinutes);
        if (tier === 'moderate') map[empId].moderateLateDays += 1;
        else if (tier === 'severe') map[empId].severeLateDays += 1;
      }
      // "incomplete" = no scan-out recorded that day (a lone scan-in, or a scan-in with no matching scan-out).
      if (d.status === 'incomplete') map[empId].noScanOutDays += 1;
      if (d.status === 'absent') map[empId].absentDays += 1;
      if (d.status === 'substituted') map[empId].substitutedDays += 1;
    }
    return map;
  }, [dailyRows]);

  // ສົ່ງອອກ: the table as shown — the dates, department, position and people
  // picked — or the departments picked (PrintPicker), each under its own
  // dividing row; as an Excel sheet in the page's colours with a ລວມ row for
  // everyone exported, or as CSV. Numbers stay numbers (a zero shows as "-") so
  // they can be added up in Excel.
  const exportSpec = (scope?: { sections: PrintSection[]; all: boolean }): SheetSpec => {
    const departmentName = departmentOptions.find((d) => d.value === departmentFilter)?.label;
    const positionName = positionOptions.find((p) => p.value === positionFilter)?.label;
    const pickedNames = personFilter
      .map((id) => allEmployees.find((e) => e._id === id))
      .filter(Boolean)
      .map((e) => `${e!.firstName ?? ''} ${e!.lastName ?? ''}`.trim());
    const people = pickedNames.length === 1 ? pickedNames[0] : pickedNames.length ? `${pickedNames.length} ຄົນທີ່ເລືອກ` : undefined;
    const filters = scope
      ? pickedScope(scope.sections, scope.all)
      : [departmentName && `ພະແນກ ${departmentName}`, positionName && `ຕຳແໜ່ງ ${positionName}`, people, search && `ຄົ້ນຫາ "${search}"`]
          .filter(Boolean)
          .join(' · ');
    const groups = scope ? groupBySection(scope.sections, allEmployees, (e) => e._id) : null;
    const exported = groups ? groups.flatMap((g) => g.items) : employees;

    const count = '0;-0;"-"';
    const hours = '0.0';
    const badge = (value: number, kind: keyof typeof BADGE_STYLE): SheetCell =>
      value > 0
        ? { value, numFmt: count, fill: BADGE_STYLE[kind].bg, color: BADGE_STYLE[kind].text, bold: true }
        : { value: 0, numFmt: count, color: '#BFBFBF' };
    const header = (text: string, width: number, kind?: keyof typeof BADGE_STYLE) => ({
      header: text,
      width,
      ...(kind ? { fill: BADGE_STYLE[kind].bg, color: BADGE_STYLE[kind].text } : {}),
    });
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const totals = exported.reduce(
      (sum, emp) => {
        const s = summaryByEmployee[emp._id];
        if (!s) return sum;
        sum.expectedHours += s.expectedHours;
        sum.workedHours += s.workedHours;
        sum.lateMinutes += s.lateMinutes;
        sum.lateDays += s.lateDays;
        sum.moderateLateDays += s.moderateLateDays;
        sum.severeLateDays += s.severeLateDays;
        sum.substitutedDays += s.substitutedDays;
        sum.earlyLeaveMinutes += s.earlyLeaveMinutes;
        sum.noScanOutDays += s.noScanOutDays;
        sum.absentDays += s.absentDays;
        return sum;
      },
      { expectedHours: 0, workedHours: 0, lateMinutes: 0, lateDays: 0, moderateLateDays: 0, severeLateDays: 0, substitutedDays: 0, earlyLeaveMinutes: 0, noScanOutDays: 0, absentDays: 0 }
    );

    return {
      fileName: `scan-report_${rangeStartKey}_${rangeEndKey}`,
      sheetName: 'ລາຍງານການສະແກນ',
      title: `ລາຍງານການສະແກນ ${filters || 'ທັງໝົດ'} ວັນທີ ${range[0].format('DD/MM/YYYY')} - ${range[1].format('DD/MM/YYYY')}`,
      printedAt: dayjs().format('DD/MM/YYYY HH:mm'),
      frozenColumns: 2,
      striped: true,
      columns: [
        header('ລະຫັດ', 9),
        header('ຊື່ພະນັກງານ', 24),
        header('ພະແນກ', 14),
        header('ຕຳແໜ່ງ', 16),
        header('ຊົ່ວໂມງທີ່ຕ້ອງເຮັດ (ຊມ.)', 13),
        header('ຊົ່ວໂມງທີ່ເຮັດແທ້ (ຊມ.)', 13),
        header('ມາຊ້າ (ນາທີ)', 11, 'late'),
        header('ມາຊ້າ (ມື້)', 10, 'late'),
        header(`ຊ້າເກີນ ${graceLabel} (ຄັ້ງ)`, 14, 'late'),
        header(`ຊ້າເກີນ ${severeLabel} (ຄັ້ງ)`, 14, 'late'),
        header('ມາແທນ (ຄັ້ງ)', 11, 'substituted'),
        header('ກັບກ່ອນ (ນາທີ)', 12, 'late'),
        header('ສະແກນຄັ້ງດຽວ (ຄັ້ງ)', 13, 'incomplete'),
        header('ມື້ຂາດວຽກ (ວັນ)', 12, 'absent'),
      ],
      rows: groups
        ? groups.flatMap(({ section, items }) => [{ section: sectionHeading(section, items.length) }, ...items.map(rowCells)])
        : employees.map(rowCells),
      totals: [
        'ລວມ',
        { value: `${exported.length} ຄົນ`, align: 'left' },
        '',
        '',
        { value: round1(totals.expectedHours), numFmt: hours },
        { value: round1(totals.workedHours), numFmt: hours },
        { value: totals.lateMinutes, numFmt: count },
        { value: totals.lateDays, numFmt: count },
        { value: totals.moderateLateDays, numFmt: count },
        { value: totals.severeLateDays, numFmt: count },
        { value: totals.substitutedDays, numFmt: count },
        { value: totals.earlyLeaveMinutes, numFmt: count },
        { value: totals.noScanOutDays, numFmt: count },
        { value: totals.absentDays, numFmt: count },
      ],
    };
    function rowCells(emp: Employee) {
        const s = summaryByEmployee[emp._id];
        return [
          emp.employeeCode ?? '',
          { value: `${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim(), align: 'left' as const },
          { value: (typeof emp.department === 'object' ? emp.department?.name : undefined) || '-', align: 'left' as const },
          { value: (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-', align: 'left' as const },
          { value: round1(s?.expectedHours ?? 0), numFmt: hours },
          { value: round1(s?.workedHours ?? 0), numFmt: hours },
          badge(s?.lateMinutes ?? 0, 'late'),
          badge(s?.lateDays ?? 0, 'late'),
          badge(s?.moderateLateDays ?? 0, 'late'),
          badge(s?.severeLateDays ?? 0, 'late'),
          badge(s?.substitutedDays ?? 0, 'substituted'),
          badge(s?.earlyLeaveMinutes ?? 0, 'late'),
          badge(s?.noScanOutDays ?? 0, 'incomplete'),
          badge(s?.absentDays ?? 0, 'absent'),
        ];
    }
  };
  // ສົ່ງອອກ Excel / CSV ask what to export first (PrintPicker).
  const [exportFormat, setExportFormat] = useState<'excel' | 'csv' | null>(null);
  const [exporting, setExporting] = useState(false);
  const runExport = async (format: 'excel' | 'csv', spec: SheetSpec) => {
    if (format === 'csv') {
      downloadCsv(spec);
      return;
    }
    setExporting(true);
    try {
      await downloadXlsx(spec);
    } catch {
      message.error('ສົ່ງອອກ Excel ບໍ່ສຳເລັດ');
    } finally {
      setExporting(false);
    }
  };
  const exportDisabled = employeesLoading || dailyLoading || !allEmployees.length;
  const pickedPeopleLabel = personFilter.length
    ? personFilter.length === 1
      ? personOptions.find((o) => o.value === personFilter[0])?.label ?? '1 ຄົນ'
      : `${personFilter.length} ຄົນທີ່ເລືອກ`
    : search
      ? `ຄົ້ນຫາ "${search}" (${employees.length} ຄົນ)`
      : undefined;

  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  return (
    <List title="ລາຍງານການສະແກນ" breadcrumb={false}>
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <Space wrap>
            <Button icon={<LeftOutlined />} onClick={() => goToMonth(range[0].subtract(1, 'month'))} />
            <Button onClick={() => goToMonth(dayjs())}>ເດືອນນີ້</Button>
            <Button icon={<RightOutlined />} onClick={() => goToMonth(range[0].add(1, 'month'))} />
            <Typography.Text type="secondary">ຫຼືເລືອກຊ່ວງເອງ:</Typography.Text>
            <RangePicker
              value={range}
              onChange={(v) => {
                if (!v || !v[0] || !v[1]) return;
                let [start, end] = v;
                const spanDays = end.startOf('day').diff(start.startOf('day'), 'day') + 1;
                if (spanDays > MAX_RANGE_DAYS) {
                  end = start.add(MAX_RANGE_DAYS - 1, 'day');
                  message.warning(`ເລືອກຊ່ວງວັນທີໄດ້ສູງສຸດ ${MAX_RANGE_DAYS} ວັນ`);
                }
                setRange([start, end]);
              }}
              format="DD/MM/YYYY"
              allowClear={false}
            />
          </Space>
        </div>
        <Space wrap>
          <Input.Search
            placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່ພະນັກງານ"
            allowClear
            style={{ width: 220 }}
            prefix={<SearchOutlined />}
            onSearch={(v) => setSearch(v)}
            onChange={(e) => !e.target.value && setSearch('')}
          />
          <Select
            options={departmentOptions}
            placeholder="ກອງຕາມພະແນກ"
            allowClear
            style={{ width: 180 }}
            value={departmentFilter}
            onChange={(v) => {
              setDepartmentFilter(v);
              narrowPeople(v, positionFilter);
            }}
          />
          <Select
            options={positionOptions}
            placeholder="ກອງຕາມຕຳແໜ່ງ"
            allowClear
            style={{ width: 180 }}
            value={positionFilter}
            onChange={(v) => {
              setPositionFilter(v);
              narrowPeople(departmentFilter, v);
            }}
          />
          <Select
            mode="multiple"
            options={personOptions}
            placeholder="ເລືອກພະນັກງານ (ທຸກຄົນ)"
            allowClear
            showSearch
            optionFilterProp="label"
            maxTagCount="responsive"
            style={{ width: 260 }}
            value={personFilter}
            onChange={(v) => setPersonFilter(v)}
          />
          <Button icon={<FileExcelOutlined />} loading={exporting} disabled={exportDisabled} onClick={() => setExportFormat('excel')}>
            ສົ່ງອອກ Excel
          </Button>
          <Button icon={<DownloadOutlined />} disabled={exportDisabled} onClick={() => setExportFormat('csv')}>
            ສົ່ງອອກ CSV
          </Button>
          <PrintPickerModal
            open={!!exportFormat}
            verb="ສົ່ງອອກ"
            okText={exportFormat === 'csv' ? 'ສົ່ງອອກ CSV' : 'ສົ່ງອອກ Excel'}
            allNote="ມີແຖວແບ່ງແຕ່ລະພະແນກ"
            className="export-picker"
            onCancel={() => setExportFormat(null)}
            employees={allEmployees}
            initialDepartment={departmentFilter}
            initialPosition={positionFilter}
            currentLabel={pickedPeopleLabel}
            onPrintCurrent={() => {
              const format = exportFormat ?? 'excel';
              setExportFormat(null);
              runExport(format, exportSpec());
            }}
            onPrint={(sections, { all }) => {
              const format = exportFormat ?? 'excel';
              setExportFormat(null);
              runExport(format, exportSpec({ sections, all }));
            }}
          />
        </Space>
      </div>

      <Table
        dataSource={employees}
        rowKey="_id"
        loading={employeesLoading || dailyLoading}
        pagination={false}
        scroll={{ x: 'max-content' }}
        sticky={{ offsetHeader }}
      >
        <Table.Column title="ລະຫັດ" fixed="left" width={110} dataIndex="employeeCode" />
        <Table.Column
          title="ຊື່ພະນັກງານ"
          fixed="left"
          width={180}
          render={(_, emp: Employee) => `${emp.firstName ?? ''} ${emp.lastName ?? ''}`}
        />
        <Table.Column
          title="ພະແນກ"
          width={130}
          render={(_, emp: Employee) => (typeof emp.department === 'object' ? emp.department?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຕຳແໜ່ງ"
          width={150}
          render={(_, emp: Employee) => (typeof emp.position === 'object' ? emp.position?.name : undefined) || '-'}
        />
        <Table.Column
          title="ຊົ່ວໂມງທີ່ຕ້ອງເຮັດ"
          width={140}
          render={(_, emp: Employee) => `${(summaryByEmployee[emp._id]?.expectedHours ?? 0).toFixed(1)} ຊມ.`}
        />
        <Table.Column
          title="ຊົ່ວໂມງທີ່ເຮັດແທ້"
          width={130}
          render={(_, emp: Employee) => `${(summaryByEmployee[emp._id]?.workedHours ?? 0).toFixed(1)} ຊມ.`}
        />
        <Table.Column
          title="ມາຊ້າ (ນາທີ)"
          width={120}
          render={(_, emp: Employee) => <Badge value={summaryByEmployee[emp._id]?.lateMinutes ?? 0} unit="ນາທີ" kind="late" />}
        />
        <Table.Column
          title="ມາຊ້າ (ມື້)"
          width={130}
          render={(_, emp: Employee) => <Badge value={summaryByEmployee[emp._id]?.lateDays ?? 0} unit="ມື້" kind="late" />}
        />
        <Table.Column
          title={`ຊ້າເກີນ ${graceLabel}`}
          width={160}
          render={(_, emp: Employee) => <Badge value={summaryByEmployee[emp._id]?.moderateLateDays ?? 0} unit="ຄັ້ງ" kind="late" />}
        />
        <Table.Column
          title={`ຊ້າເກີນ ${severeLabel}`}
          width={170}
          render={(_, emp: Employee) => <Badge value={summaryByEmployee[emp._id]?.severeLateDays ?? 0} unit="ຄັ້ງ" kind="late" />}
        />
        <Table.Column
          title="ມາແທນ(ຄັ້ງ)"
          width={140}
          render={(_, emp: Employee) => <Badge value={summaryByEmployee[emp._id]?.substitutedDays ?? 0} unit="ຄັ້ງ" kind="substituted" />}
        />
        <Table.Column
          title="ກັບກ່ອນ(ນາທີ)"
          width={130}
          render={(_, emp: Employee) => <Badge value={summaryByEmployee[emp._id]?.earlyLeaveMinutes ?? 0} unit="ນາທີ" kind="late" />}
        />
        <Table.Column
          title="ສະແກນຄັ້ງດຽວ"
          width={150}
          render={(_, emp: Employee) => <Badge value={summaryByEmployee[emp._id]?.noScanOutDays ?? 0} unit="ຄັ້ງ" kind="incomplete" />}
        />
        <Table.Column
          title="ມື້ຂາດວຽກ"
          width={110}
          render={(_, emp: Employee) => <Badge value={summaryByEmployee[emp._id]?.absentDays ?? 0} unit="ວັນ" kind="absent" />}
        />
      </Table>
    </List>
  );
};
