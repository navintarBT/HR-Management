import { useEffect, useRef, useState } from 'react';
import { Edit, useForm, useSelect } from '@refinedev/antd';
import { useCustom, useNavigation, useNotification, useInvalidate } from '@refinedev/core';
import { Link } from 'react-router-dom';
import { Form, Input, InputNumber, Select, DatePicker, TimePicker, Row, Col, Divider, Button, Modal, Typography, Alert, Space, Tag, Popconfirm } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Department, EmploymentType, Employee, ShiftCategory, ScheduledShiftChange } from '../../types';
import { API_URL } from '../../providers/axios';
import { ShiftChangeFields, scheduleShiftChange, cancelScheduledShiftChange, shiftCategoryLabel } from '../../components/ShiftChangeAhead';
import { EmployeePhotoUpload } from '../../components/EmployeePhotoUpload';
import { ShiftCategoryQuickPicker } from '../../components/ShiftCategoryQuickPicker';
import { usePositionsByDepartment } from '../../hooks/usePositionsByDepartment';
import { ALL_EMPLOYEES_PAGE_SIZE } from '../../utils/listLimits';
import { NAME_EN_MAX, NAME_EN_RULES } from '../../utils/nameEn';
import { useAbsenceSeverityPrompt } from '../../components/AbsenceSeverityPrompt';

export const EmployeeEdit: React.FC = () => {
  const { list } = useNavigation();
  // Moving someone to another position keeps the tier their absences were
  // recorded with — ask (only if any absence this month would change) whether
  // to carry the new position's rules over, then go back to the list. Refine's
  // own redirect would unmount the question before it could be answered.
  const { prompt: askAbsenceSeverity, modal: absenceSeverityModal } = useAbsenceSeverityPrompt();
  const recordRef = useRef<Employee | undefined>(undefined);
  const { formProps, saveButtonProps, query, form } = useForm<Employee>({
    resource: 'employees',
    redirect: false,
    onMutationSuccess: (_data, variables) => {
      const before = recordRef.current;
      const previousPosition = before && (typeof before.position === 'object' ? before.position?._id : before.position);
      const nextPosition = (variables as { position?: string }).position;
      if (before && nextPosition && previousPosition !== nextPosition) {
        askAbsenceSeverity(
          { employees: [before._id] },
          {
            applyByDefault: false,
            reason: `"${before.firstName ?? ''} ${before.lastName ?? ''}" ຍ້າຍຕຳແໜ່ງແລ້ວ`,
            onDone: () => list('employees'),
          }
        );
      } else {
        list('employees');
      }
    },
  });
  const record = query?.data?.data;
  recordRef.current = record;
  // ພະແນກ, ຕຳແໜ່ງ and ໂມງເຂົ້າວຽກ are set when someone is added (a draft is
  // still being added). After that they move only on ແກ້ໄຂກະແບບກຸ່ມ, which keeps
  // a history of every round and moves a shift the one proper way (ຍ້າຍກະ) —
  // the server refuses them from here too (routes/employees.js).
  const workFieldsLocked = !!record && record.status !== 'draft';

  // ຍ້າຍກະ: the regular shift moves the one way it moves everywhere (ແກ້ໄຂ
  // ກະແບບກຸ່ມ, ຕັ້ງຄ່າແຜນວຽກ) — a new shift from a start date, the days
  // before keeping the old one, called off any time before that date.
  const { open: notify } = useNotification();
  const invalidate = useInvalidate();
  const { data: waitingData, refetch: refetchWaiting } = useCustom<ScheduledShiftChange[]>({
    url: `${API_URL}/scheduled-shift-changes`,
    method: 'get',
    config: { query: { employee: record?._id, status: 'pending' } },
    queryOptions: { enabled: workFieldsLocked },
    errorNotification: false,
  });
  const waiting = (waitingData?.data ?? []).filter((c) => c.status === 'pending');
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState<Dayjs | null>(null);
  const [moveCategory, setMoveCategory] = useState<string>();
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [moving, setMoving] = useState(false);
  const openMove = () => {
    setMoveDate(dayjs().add(1, 'day'));
    setMoveCategory(undefined);
    setCreatingCategory(false);
    setMoveOpen(true);
  };
  const submitMove = async () => {
    if (!record || !moveCategory || !moveDate) return;
    setMoving(true);
    try {
      await scheduleShiftChange(record._id, moveCategory, moveDate.format('YYYY-MM-DD'), undefined, 'employee');
      notify?.({ type: 'success', message: `ຕັ້ງການຍ້າຍກະແລ້ວ — ມີຜົນວັນທີ ${moveDate.format('DD/MM/YYYY')}` });
      setMoveOpen(false);
      invalidate({ resource: 'shifts', invalidates: ['list'] });
      refetchWaiting();
      query?.refetch();
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ຍ້າຍກະບໍ່ສຳເລັດ' });
    } finally {
      setMoving(false);
    }
  };
  const cancelMove = async (id: string) => {
    try {
      await cancelScheduledShiftChange(id);
      notify?.({ type: 'success', message: 'ຍົກເລີກການຍ້າຍກະແລ້ວ' });
      invalidate({ resource: 'shifts', invalidates: ['list'] });
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ຍົກເລີກບໍ່ສຳເລັດ' });
    }
    refetchWaiting();
  };
  // refine auto-derives formProps.initialValues straight from the fetched
  // record — hireDate/workTime land there as raw strings, not dayjs objects.
  // Spreading that onto the Form would mount DatePicker/RangePicker with a
  // plain string for one render before the effect below fixes it with real
  // dayjs values, and antd's own date-validity check has no fallback for a
  // non-dayjs value — it crashes calling .isValid() on it. Dropping
  // initialValues here and always populating through the effect (already
  // dayjs-wrapped) sidesteps that race entirely.
  const { initialValues: _unusedInitialValues, ...formPropsWithoutInitialValues } = formProps;

  const { selectProps: departmentSelect, query: departmentQuery } = useSelect<Department>({
    resource: 'departments',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });
  const allDepartments = departmentQuery?.data?.data ?? [];

  const departmentId = Form.useWatch('department', form);
  const positionId = Form.useWatch('position', form);
  const defaultShiftCategoryId = Form.useWatch('defaultShiftCategory', form);
  const statusValue = Form.useWatch('status', form);
  const { positionSelect, options: positionOptions, isValidForDepartment, allPositions } =
    usePositionsByDepartment(departmentId);

  // ຫົວໜ້າງານ and ຫົວໜ້າຕໍາແໜ່ງ are fully derived from the department/position's
  // configured head (set on the org management page) — not manually pickable
  // here. Kept in sync (including clearing back to empty) whenever the selected
  // department/position, or the underlying department/position records, change
  // — this also re-derives them on initial load once allDepartments/allPositions
  // arrive, so an employee's saved supervisor/positionHead always reflects the
  // department/position's CURRENT head rather than a possibly-stale stored value.
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
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE, mode: 'server' },
  });

  const { selectProps: positionHeadSelect } = useSelect<Employee>({
    resource: 'employees',
    optionLabel: (item) => `${item.firstName} ${item.lastName}`,
    optionValue: '_id',
    pagination: { pageSize: ALL_EMPLOYEES_PAGE_SIZE, mode: 'server' },
  });

  const { selectProps: employmentTypeSelect } = useSelect<EmploymentType>({
    resource: 'employment-types',
    optionLabel: 'name',
    optionValue: '_id',
    pagination: { pageSize: 200, mode: 'server' },
  });

  // ລະຫັດພະນັກງານ is editable. The scanner number has been the same as the code
  // (unless someone set another one), so it follows the code while they still
  // match: shown in the form before saving, and the server's PIN change takes
  // it off the scanners under the old number and puts it on under the new.
  const lastCodeRef = useRef<string | undefined>(undefined);
  const codeValue: string | undefined = Form.useWatch('employeeCode', form);
  const pinValue: string | undefined = Form.useWatch('deviceUserId', form);
  const codeChanged = !!record && (codeValue ?? '') !== (record.employeeCode ?? '');
  const pinChanged = !!record && (pinValue ?? '') !== (record.deviceUserId ?? '');
  const followCode = (next: string) => {
    if ((form.getFieldValue('deviceUserId') ?? '') === (lastCodeRef.current ?? '')) form.setFieldValue('deviceUserId', next);
    lastCodeRef.current = next;
  };
  const [modal, modalContext] = Modal.useModal();

  useEffect(() => {
    if (!record) return;
    lastCodeRef.current = record.employeeCode;
    form.setFieldsValue({
      employeeCode: record.employeeCode,
      deviceUserId: record.deviceUserId,
      firstName: record.firstName,
      lastName: record.lastName,
      nameEn: record.nameEn,
      phone: record.phone,
      status: record.status,
      photoUrl: record.photoUrl,
      employmentType: typeof record.employmentType === 'object' ? record.employmentType?._id : record.employmentType,
      department: typeof record.department === 'object' ? record.department?._id : record.department,
      position: typeof record.position === 'object' ? record.position?._id : record.position,
      hireDate: record.hireDate ? dayjs(record.hireDate) : undefined,
      // If a category is linked, preview ITS current time (live), not
      // whatever was last saved to defaultShiftStart/End — a category edited
      // since this employee was last saved should show the new time here too.
      defaultShiftCategory: idOf(record.defaultShiftCategory),
      workTime:
        typeof record.defaultShiftCategory === 'object' && record.defaultShiftCategory
          ? [dayjs(record.defaultShiftCategory.startTime, 'HH:mm'), dayjs(record.defaultShiftCategory.endTime, 'HH:mm')]
          : record.defaultShiftStart && record.defaultShiftEnd
            ? [dayjs(record.defaultShiftStart, 'HH:mm'), dayjs(record.defaultShiftEnd, 'HH:mm')]
            : undefined,
      salary: record.salary ?? undefined,
      annualLeaveDays: record.annualLeaveDays ?? undefined,
      terminationReason: record.terminationReason ?? undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  // When a category is picked, it becomes the live source of the default
  // time (see Employee.defaultShiftCategory) — the manual time fields are
  // only meaningful without one, so they're cleared rather than stored stale.
  // A new code is the employee app's login, and maybe the scanner number too —
  // spelled out before it's saved.
  const submitValues = (values: any) => {
    if (!record || (values.employeeCode ?? '') === (record.employeeCode ?? '')) return saveValues(values);
    const oldPin = record.deviceUserId ?? '';
    const newPin = values.deviceUserId ?? '';
    modal.confirm({
      title: `ປ່ຽນລະຫັດພະນັກງານ ${record.employeeCode ?? '-'} → ${values.employeeCode}?`,
      width: 520,
      content: (
        <ul style={{ paddingInlineStart: 18, margin: 0 }}>
          <li>
            ແອັບພະນັກງານ: ຕ້ອງເຂົ້າສູ່ລະບົບດ້ວຍລະຫັດ <b>{values.employeeCode}</b> ແທນ {record.employeeCode ?? '-'}
          </li>
          {oldPin !== newPin ? (
            <li>
              ລະຫັດເຄື່ອງສະແກນ {oldPin || '-'} → <b>{newPin || '-'}</b>: ລະຫັດເກົ່າຈະຖືກລຶບອອກຈາກທຸກເຄື່ອງ. ເຄື່ອງທີ່ເປີດຊິງຈະໄດ້ລະຫັດໃໝ່ພ້ອມໃບໜ້າ/ນິ້ວມືເອງ —
              ເຄື່ອງທີ່ບໍ່ເປີດຊິງ ຕ້ອງລົງທະບຽນໃໝ່ຢູ່ເຄື່ອງ
            </li>
          ) : (
            <li>ລະຫັດເຄື່ອງສະແກນຍັງເປັນ {oldPin || '-'} ຄືເກົ່າ</li>
          )}
          <li>ປະຫວັດການສະແກນ, ການລາ ແລະ ເງິນເດືອນທີ່ຜ່ານມາ ຍັງຢູ່ຄືເກົ່າ</li>
        </ul>
      ),
      okText: 'ປ່ຽນລະຫັດ',
      cancelText: 'ຍົກເລີກ',
      onOk: () => saveValues(values),
    });
  };
  const saveValues = (values: any) => {
    const payload = {
      ...values,
      hireDate: values.hireDate ? dayjs(values.hireDate).toISOString() : undefined,
      defaultShiftCategory: values.defaultShiftCategory ?? null,
      defaultShiftStart: values.defaultShiftCategory ? null : values.workTime?.[0] ? values.workTime[0].format('HH:mm') : null,
      defaultShiftEnd: values.defaultShiftCategory ? null : values.workTime?.[1] ? values.workTime[1].format('HH:mm') : null,
      workTime: undefined,
      salary: values.salary ?? null,
      annualLeaveDays: values.annualLeaveDays ?? null,
    };
    if (workFieldsLocked) {
      for (const field of ['department', 'position', 'defaultShiftCategory', 'defaultShiftStart', 'defaultShiftEnd']) delete payload[field];
    }
    return formProps.onFinish?.(payload);
  };

  const handleSaveDraft = () => {
    const values = form?.getFieldsValue(true) ?? {};
    submitValues({ ...values, status: 'draft' });
  };

  return (
    <Edit
      isLoading={query?.isLoading}
      saveButtonProps={saveButtonProps}
      title="ແກ້ໄຂຂໍ້ມູນພະນັກງານ"
      footerButtons={({ defaultButtons }) => (
        <>
          <Button onClick={handleSaveDraft}>ບັນທຶກເປັນຮ່າງ</Button>
          {defaultButtons}
        </>
      )}
    >
      {/* Rendered only once the record has actually arrived, and without
          formProps.initialValues (see above) — belt-and-suspenders against
          antd's DatePicker/RangePicker ever seeing a raw, non-dayjs value on
          first mount. */}
      {record && (
      <Form {...formPropsWithoutInitialValues} form={form} layout="vertical" onFinish={submitValues}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
          <Form.Item name="photoUrl" style={{ marginBottom: 0 }}>
            <EmployeePhotoUpload />
          </Form.Item>
        </div>

        <Divider orientation="left">ຂໍ້ມູນພະນັກງານ</Divider>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              label="ລະຫັດພະນັກງານ"
              name="employeeCode"
              rules={[
                { required: true, message: 'ກະລຸນາປ້ອນລະຫັດພະນັກງານ' },
                // Only a changed code has to be in the new format; an older one is saved as it is.
                {
                  validator: (_, value) =>
                    !value || value === record.employeeCode || /^\d{1,5}$/.test(value)
                      ? Promise.resolve()
                      : Promise.reject(new Error('ຕ້ອງເປັນຕົວເລກ ແລະ ບໍ່ເກີນ 5 ຕົວ')),
                },
              ]}
              extra={
                codeChanged ? (
                  <Typography.Text type="warning">
                    ແອັບພະນັກງານຈະເຂົ້າສູ່ລະບົບດ້ວຍລະຫັດໃໝ່{pinChanged ? ' · ລະຫັດເຄື່ອງສະແກນປ່ຽນຕາມ' : ''}
                  </Typography.Text>
                ) : undefined
              }
            >
              <Input maxLength={5} placeholder="ຕົວຢ່າງ: 00212" onChange={(e) => followCode(e.target.value)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ລະຫັດເຄື່ອງສະແກນ" name="deviceUserId">
              <Input />
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
            <Form.Item
              label="ຊື່ພາສາອັງກິດ (ສະແດງໃນເຄື່ອງສະແກນ)"
              name="nameEn"
              rules={NAME_EN_RULES}
              extra="ເຄື່ອງສະແກນສະແດງໄດ້ສະເພາະຕົວອັກສອນອັງກິດ — ປ່ຽນແລ້ວຈະສົ່ງໄປເຄື່ອງທີ່ເປີດຊິງເອງ"
            >
              <Input maxLength={NAME_EN_MAX} showCount />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ເບີໂທ" name="phone">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">ຂໍ້ມູນການເຮັດວຽກ</Divider>
        {workFieldsLocked && (
          <Alert
            className="work-fields-locked"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="ພະແນກ ແລະ ຕຳແໜ່ງ ປ່ຽນໄດ້ທີ່ໜ້າ ແກ້ໄຂກະແບບກຸ່ມ — ໂມງເຂົ້າວຽກ ປ່ຽນດ້ວຍປຸ່ມ ຍ້າຍກະ ລຸ່ມນີ້"
            description={
              <>
                ຍ້າຍກະ ແມ່ນແບບດຽວກັບ <Link to="/schedule/bulk">ແກ້ໄຂກະແບບກຸ່ມ</Link> ແລະ ຕັ້ງຄ່າແຜນວຽກ: ກະໃໝ່ເລີ່ມແຕ່ວັນທີ່ເລືອກ, ມື້ກ່ອນນັ້ນຍັງໃຊ້ກະເກົ່າ,
                ຍົກເລີກໄດ້ກ່ອນເຖິງວັນ — ທຸກຄັ້ງເກັບໄວ້ໃນປະຫວັດການແກ້ໄຂ
              </>
            }
          />
        )}
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="ພະແນກ" name="department" rules={workFieldsLocked ? [] : [{ required: true }]}>
              <Select
                {...departmentSelect}
                disabled={workFieldsLocked}
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
            <Form.Item label="ຕຳແໜ່ງ" name="position" rules={workFieldsLocked ? [] : [{ required: true }]}>
              <Select
                {...positionSelect}
                options={positionOptions}
                disabled={workFieldsLocked || !departmentId}
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
            <Form.Item label="ວັນທີເລີ່ມວຽກ" name="hireDate" rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ໝວດໝູ່ກະ (ຜູກເວລາແບບ live)" name="defaultShiftCategory">
              <ShiftCategoryQuickPicker
                disabled={workFieldsLocked}
                onSelect={(category?: ShiftCategory) =>
                  form.setFieldValue(
                    'workTime',
                    category ? [dayjs(category.startTime, 'HH:mm'), dayjs(category.endTime, 'HH:mm')] : undefined
                  )
                }
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="ໂມງເຂົ້າວຽກ"
              name="workTime"
              tooltip={defaultShiftCategoryId ? 'ດຶງມາຈາກໝວດໝູ່ກະທີ່ເລືອກໄວ້ — ລ້າງໝວດໝູ່ກະກ່ອນຖ້າຕ້ອງການຕັ້ງເວລາເອງ' : undefined}
            >
              <TimePicker.RangePicker
                style={{ width: '100%' }}
                format="HH:mm"
                minuteStep={15}
                order={false}
                disabled={workFieldsLocked || !!defaultShiftCategoryId}
              />
            </Form.Item>
          </Col>
          {workFieldsLocked && (
            <Col xs={24} className="employee-shift-move" style={{ marginTop: -8, marginBottom: 16 }}>
              <Space wrap>
                <Button icon={<ClockCircleOutlined />} onClick={openMove}>
                  ຍ້າຍກະ (ປ່ຽນກະປະຈຳ)
                </Button>
                {waiting.map((c) => (
                  <Popconfirm
                    key={c._id}
                    title="ຍົກເລີກການຍ້າຍກະນີ້?"
                    description="ກະເກົ່າຈະໃຊ້ຕໍ່ໄປຄືເກົ່າ"
                    okText="ຍົກເລີກ"
                    cancelText="ບໍ່"
                    onConfirm={() => cancelMove(c._id)}
                  >
                    <Tag color="blue" className="waiting-shift-change" style={{ cursor: 'pointer' }} title="ກົດເພື່ອຍົກເລີກ">
                      ຈາກ {dayjs(c.effectiveDate).format('DD/MM/YYYY')} → {shiftCategoryLabel(c.newShiftCategory)}
                    </Tag>
                  </Popconfirm>
                ))}
              </Space>
            </Col>
          )}
          <Col xs={24} md={12}>
            <Form.Item label="ສະຖານະ" name="status" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: 'ຮ່າງ', value: 'draft' },
                  { label: 'ກຳລັງເຮັດວຽກ', value: 'active' },
                  { label: 'ບໍ່ໃຊ້ງານ', value: 'inactive' },
                  { label: 'ລາອອກ', value: 'resigned' },
                  { label: 'ພັກວຽກ', value: 'suspended' },
                ]}
              />
            </Form.Item>
          </Col>
          {statusValue === 'resigned' && (
            <Col xs={24}>
              <Form.Item label="ເຫດຜົນທີ່ອອກ" name="terminationReason">
                <Input.TextArea rows={2} placeholder="ຕົວຢ່າງ: ລາອອກເອງ, ໝົດສັນຍາ, ຖືກໃຫ້ອອກ ..." />
              </Form.Item>
            </Col>
          )}
        </Row>

        <Divider orientation="left">ຂໍ້ມູນເພີ່ມເຕີມ</Divider>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="ເງິນເດືອນ" name="salary">
              <InputNumber style={{ width: '100%' }} min={0} step={100000} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="ພັກປະຈຳປີ (ມື້)" name="annualLeaveDays">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
      )}
      {absenceSeverityModal}
      <Modal
        title={`ຍ້າຍກະ — ${record?.employeeCode ?? ''} ${record?.firstName ?? ''} ${record?.lastName ?? ''}`}
        open={moveOpen}
        onCancel={() => setMoveOpen(false)}
        onOk={submitMove}
        confirmLoading={moving}
        okText="ຢືນຢັນຍ້າຍກະ"
        okButtonProps={{ disabled: creatingCategory || !moveCategory || !moveDate }}
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">
            ກະໃໝ່ມີຜົນແຕ່ວັນທີ່ເລືອກ — ມື້ກ່ອນນັ້ນຍັງໃຊ້ກະເກົ່າ. ຖ້າວັນນັ້ນເປັນວັນພັກ ຍັງເປັນວັນພັກ ແລະ ເລີ່ມກະໃໝ່ມື້ເຮັດວຽກຖັດໄປ
          </Typography.Text>
          <ShiftChangeFields
            date={moveDate}
            onDateChange={setMoveDate}
            category={moveCategory}
            onCategoryChange={setMoveCategory}
            onCreatingChange={setCreatingCategory}
            disabledDate={(d) => d.isBefore(dayjs(), 'day')}
          />
        </Space>
      </Modal>
      {modalContext}
    </Edit>
  );
};
