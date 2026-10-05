import { useState } from 'react';
import { Show } from '@refinedev/antd';
import { useShow, useList } from '@refinedev/core';
import { Descriptions, Avatar, Typography, Space, Divider, Button, Modal, Tag } from 'antd';
import { UserOutlined, IdcardOutlined, PrinterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Employee, Shift } from '../../types';
import { EmployeeStatusTag } from '../../components/StatusTags';
import { EmployeeBadge, EMPLOYEE_BADGE_WIDTH_MM, EMPLOYEE_BADGE_HEIGHT_MM } from '../../components/EmployeeBadge';
import { palette } from '../../theme/palette';
import { resolvePhotoUrl } from '../../providers/axios';

export const EmployeeShow: React.FC = () => {
  const { query } = useShow<Employee>({ resource: 'employees' });
  const record = query?.data?.data;
  const [badgeOpen, setBadgeOpen] = useState(false);

  // A position swap's own effective date pins the transitioning group to a
  // special one-off schedule (see positionSwap.js) — Employee.position itself
  // already flipped to the new one at that point, so on that one day it would
  // otherwise show a position the person isn't actually working under yet.
  const todayKey = dayjs().format('YYYY-MM-DD');
  const { data: todayShiftData } = useList<Shift>({
    resource: 'shifts',
    filters: [
      { field: 'employee', operator: 'eq', value: record?._id },
      { field: 'date', operator: 'eq', value: todayKey },
    ],
    queryOptions: { enabled: !!record?._id },
  });
  const todayOverride = todayShiftData?.data?.[0];
  const mainPositionId = typeof record?.position === 'object' ? record?.position?._id : record?.position;
  const overridePosition = typeof todayOverride?.position === 'object' ? todayOverride.position : undefined;
  const isSwapDayPin = todayOverride?.status === 'swapped' || (overridePosition && overridePosition._id !== mainPositionId);

  return (
    <Show
      isLoading={query?.isLoading}
      title="ຂໍ້ມູນພະນັກງານ"
      headerButtons={({ defaultButtons }) => (
        <>
          <Button icon={<IdcardOutlined />} onClick={() => setBadgeOpen(true)}>
            ປ້າຍພະນັກງານ
          </Button>
          {defaultButtons}
        </>
      )}
    >
      <Space align="center" size={16} style={{ marginBottom: 8 }}>
        <Avatar size={64} src={resolvePhotoUrl(record?.photoUrl)} icon={<UserOutlined />} style={{ backgroundColor: palette.primary }} />
        <div>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {record?.firstName} {record?.lastName}
          </Typography.Title>
          <Typography.Text type="secondary">{record?.employeeCode}</Typography.Text>
        </div>
      </Space>

      <Divider orientation="left">ຂໍ້ມູນພະນັກງານ</Divider>
      <Descriptions bordered column={2} size="middle">
        <Descriptions.Item label="ລະຫັດພະນັກງານ">{record?.employeeCode || '-'}</Descriptions.Item>
        <Descriptions.Item label="ລະຫັດເຄື່ອງສະແກນ">{record?.deviceUserId || '-'}</Descriptions.Item>
        <Descriptions.Item label="ຊື່">{record?.firstName || '-'}</Descriptions.Item>
        <Descriptions.Item label="ນາມສະກຸນ">{record?.lastName || '-'}</Descriptions.Item>
        <Descriptions.Item label="ເບີໂທ">{record?.phone || '-'}</Descriptions.Item>
      </Descriptions>

      <Divider orientation="left">ຂໍ້ມູນການເຮັດວຽກ</Divider>
      <Descriptions bordered column={2} size="middle">
        <Descriptions.Item label="ພະແນກ">
          {typeof record?.department === 'object' ? record?.department?.name : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ຕຳແໜ່ງ">
          {typeof record?.position === 'object' ? record?.position?.name : '-'}
          {isSwapDayPin && (
            <div style={{ marginTop: 4 }}>
              <Tag color="magenta">
                {todayOverride?.status === 'swapped'
                  ? 'ວັນນີ້ບໍ່ມີກະ (ມື້ສະຫຼັບຕຳແໜ່ງ)'
                  : `ວັນນີ້ຍັງເຮັດວຽກ ${overridePosition?.name} (ມື້ສະຫຼັບຕຳແໜ່ງ)`}
              </Tag>
            </div>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="ຫົວໜ້າງານ">
          {typeof record?.supervisor === 'object' && record.supervisor
            ? `${record.supervisor.firstName} ${record.supervisor.lastName}`
            : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ຫົວໜ້າຕໍາແໜ່ງ">
          {typeof record?.positionHead === 'object' && record.positionHead
            ? `${record.positionHead.firstName} ${record.positionHead.lastName}`
            : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ປະເພດການຈ້າງ">
          {typeof record?.employmentType === 'object' ? record?.employmentType?.name : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ວັນທີເລີ່ມງານ">
          {record?.hireDate ? dayjs(record.hireDate).format('DD MMMM YYYY') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ໂມງເຂົ້າວຽກ">
          {(() => {
            const category = record?.defaultShiftCategory;
            if (category && typeof category === 'object')
              return category.name
                ? `${category.startTime} - ${category.endTime} (${category.name})`
                : `${category.startTime} - ${category.endTime}`;
            if (record?.defaultShiftStart && record?.defaultShiftEnd) return `${record.defaultShiftStart} - ${record.defaultShiftEnd}`;
            return '-';
          })()}
        </Descriptions.Item>
        <Descriptions.Item label="ສະຖານະ">
          {record?.status ? <EmployeeStatusTag status={record.status} /> : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ວັນທີອອກງານ">
          {record?.terminationDate ? dayjs(record.terminationDate).format('DD MMMM YYYY') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="ເຫດຜົນທີ່ອອກ" span={2}>
          {record?.terminationReason || '-'}
        </Descriptions.Item>
      </Descriptions>

      <Divider orientation="left">ຂໍ້ມູນເພີ່ມເຕີມ</Divider>
      <Descriptions bordered column={2} size="middle">
        <Descriptions.Item label="ເງິນເດືອນ">{record?.salary != null ? record.salary.toLocaleString() : '-'}</Descriptions.Item>
        <Descriptions.Item label="ພັກປະຈຳປີ (ມື້)">{record?.annualLeaveDays ?? '-'}</Descriptions.Item>
      </Descriptions>

      <Modal
        title="ປ້າຍພະນັກງານ"
        open={badgeOpen}
        onCancel={() => setBadgeOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setBadgeOpen(false)}>ປິດ</Button>
            <Button type="primary" icon={<PrinterOutlined />} onClick={() => window.print()}>
              ພິມ
            </Button>
          </Space>
        }
        width={380}
      >
        {/* Print isolates #employee-badge-print-area — everything else on the
            page is hidden for the duration of the print, a plain CSS trick
            that needs no extra library. Browsers skip background colors/
            gradients/shadows when printing by default (a paper-saving
            default, not a bug) unless told otherwise — the print-color-adjust
            rules below are what makes the badge's gradient header, avatar
            ring, and footer strip actually show up on the printed page
            instead of coming out plain white. */}
        <style>{`
          @media print {
            /* Locks the printed PAGE itself to the badge's own real size
               (55 x 85mm) with no margin, instead of centering a small
               badge on a full A4/Letter sheet with a huge blank border. */
            @page {
              size: ${EMPLOYEE_BADGE_WIDTH_MM}mm ${EMPLOYEE_BADGE_HEIGHT_MM}mm;
              margin: 0;
            }
            body * { visibility: hidden; }
            #employee-badge-print-area, #employee-badge-print-area * {
              visibility: visible;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              color-adjust: exact;
            }
            #employee-badge-print-area { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 0; }
          }
        `}</style>
        <div id="employee-badge-print-area" style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          {record && <EmployeeBadge employee={record} />}
        </div>
      </Modal>
    </Show>
  );
};
