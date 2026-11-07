import { useMemo, useState } from 'react';
import { List } from '@refinedev/antd';
import { useCustom, useInvalidate, useNotification } from '@refinedev/core';
import { Table, Button, Space, Typography, Popconfirm, Tag, Select, Modal } from 'antd';
import { ReloadOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { OrphanedDeviceUser, ScannerDevice } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { API_URL, axiosInstance } from '../../providers/axios';

// PINs a scanner reports as enrolled (see routes/adms.js's BIODATA handling)
// that match no Employee.deviceUserId in our system at all — someone long
// gone, a stale test enrollment, etc. "ດຶງ" empties the list for every known
// device, or the one picked (here only, nothing on the device), and asks them to
// re-report their enrolled list (not instant — the device answers whenever it
// next polls, could take a minute or more). "ລຶບ" removes PINs from
// the device each was found on: one, the ticked ones, or every one shown.
export const DeviceUsersPage: React.FC = () => {
  const { open: notify } = useNotification();
  const invalidate = useInvalidate();
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();
  const [modal, modalContext] = Modal.useModal();

  const {
    data: orphanedData,
    isLoading,
    refetch,
  } = useCustom<OrphanedDeviceUser[]>({
    url: `${API_URL}/device-users/orphaned`,
    method: 'get',
  });
  const { data: devicesData } = useCustom<ScannerDevice[]>({
    url: `${API_URL}/device-users/devices`,
    method: 'get',
  });
  const deviceOptions = (devicesData?.data ?? [])
    .filter((d) => d.approved)
    .map((d) => ({ value: d.serialNumber, label: d.info?.deviceName ? `${d.serialNumber} (${d.info.deviceName})` : d.serialNumber }));

  // One scanner, or every one: both what's listed and what "ດຶງ" asks.
  const [serialFilter, setSerialFilter] = useState<string>();
  const orphaned = useMemo(
    () => (orphanedData?.data ?? []).filter((r) => !serialFilter || r.serialNumber === serialFilter),
    [orphanedData?.data, serialFilter]
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Only ticks still on the list count — a row deleted or filtered away drops out.
  const selected = orphaned.filter((r) => selectedIds.includes(r.id));

  const fail = (err: any, fallback: string) => notify?.({ type: 'error', message: err?.response?.data?.message || fallback });

  const [pulling, setPulling] = useState(false);
  const pull = async () => {
    setPulling(true);
    try {
      const res = await axiosInstance.post(`${API_URL}/device-users/pull`, serialFilter ? { serialNumber: serialFilter } : {});
      notify?.({
        type: 'success',
        message: `ລ້າງລາຍການເກົ່າ ${res.data.cleared} ລາຍການ ແລະ ສົ່ງຄຳຂໍໄປ ${
          serialFilter ? `ເຄື່ອງ ${serialFilter}` : `${res.data.queued} ເຄື່ອງ`
        }ແລ້ວ — ລໍຖ້າສັກຄູ່ແລ້ວກົດ "ໂຫຼດຄືນໃໝ່" ເພື່ອເບິ່ງຂໍ້ມູນລ່າສຸດ`,
      });
      setSelectedIds([]);
      refetch();
    } catch (err) {
      fail(err, 'ດໍາເນີນການບໍ່ສຳເລັດ');
    } finally {
      setPulling(false);
    }
  };

  const afterDelete = () => {
    setSelectedIds([]);
    refetch();
    invalidate({ resource: 'device-users', invalidates: ['list'] });
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const removeOne = async (record: OrphanedDeviceUser) => {
    setDeletingId(record.id);
    try {
      await axiosInstance.post(`${API_URL}/device-users/${record.id}/delete`, {});
      notify?.({ type: 'success', message: `ຕັ້ງຄິວລຶບ PIN ${record.pin} ອອກຈາກເຄື່ອງແລ້ວ` });
      afterDelete();
    } catch (err) {
      fail(err, 'ລຶບບໍ່ສຳເລັດ');
    } finally {
      setDeletingId(null);
    }
  };

  // The ticked rows, or every row shown: asks first, saying how many from which
  // scanner, since their face/finger goes with them.
  const [deletingMany, setDeletingMany] = useState(false);
  const removeMany = (records: OrphanedDeviceUser[], everyone: boolean) => {
    const perDevice = new Map<string, number>();
    for (const r of records) perDevice.set(r.serialNumber, (perDevice.get(r.serialNumber) ?? 0) + 1);
    modal.confirm({
      title: everyone ? `ລຶບທັງໝົດ ${records.length} PIN ອອກຈາກເຄື່ອງ?` : `ລຶບ ${records.length} PIN ທີ່ເລືອກອອກຈາກເຄື່ອງ?`,
      width: 520,
      content: (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text>
            PIN ເຫຼົ່ານີ້ບໍ່ກົງກັບພະນັກງານຄົນໃດ. ລຶບແລ້ວ ໃບໜ້າ/ນິ້ວມືຂອງເຂົາເຈົ້າໃນເຄື່ອງຈະຖືກລຶບນຳ ແລະ ຈະສະແກນບໍ່ໄດ້ອີກ. ເຄື່ອງຈະລຶບເມື່ອຕິດຕໍ່ມາຮອບຕໍ່ໄປ
          </Typography.Text>
          <div>
            {[...perDevice].map(([serial, n]) => (
              <div key={serial}>
                <Tag>{serial}</Tag> {n} PIN
              </div>
            ))}
          </div>
        </Space>
      ),
      okText: 'ລຶບ',
      okButtonProps: { danger: true },
      cancelText: 'ບໍ່',
      onOk: async () => {
        setDeletingMany(true);
        try {
          const { data } = await axiosInstance.post(`${API_URL}/device-users/orphaned/delete`, { ids: records.map((r) => r.id) });
          const kept = [
            data.nowAnEmployee ? `${data.nowAnEmployee} PIN ກົງກັບພະນັກງານແລ້ວ ຈຶ່ງບໍ່ລຶບ` : '',
            data.notApproved ? `${data.notApproved} PIN ຢູ່ເຄື່ອງທີ່ຍັງບໍ່ອະນຸມັດ ຈຶ່ງບໍ່ລຶບ` : '',
          ].filter(Boolean);
          notify?.({ type: 'success', message: [`ຕັ້ງຄິວລຶບ ${data.deleted} PIN ແລ້ວ`, ...kept].join(' · ') });
          afterDelete();
        } catch (err) {
          fail(err, 'ລຶບບໍ່ສຳເລັດ');
        } finally {
          setDeletingMany(false);
        }
      },
    });
  };

  return (
    <List title="ໄອດີທີ່ບໍ່ກົງກັບລະບົບ" breadcrumb={false}>
      {modalContext}
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            className="orphans-device"
            allowClear
            placeholder="ທຸກເຄື່ອງ"
            style={{ width: 280 }}
            options={deviceOptions}
            value={serialFilter}
            onChange={(v?: string) => setSerialFilter(v)}
          />
          <Button type="primary" icon={<ReloadOutlined />} loading={pulling} onClick={pull}>
            {serialFilter ? `ດຶງຂໍ້ມູນຈາກເຄື່ອງ ${serialFilter}` : 'ດຶງຂໍ້ມູນຈາກທຸກເຄື່ອງ'}
          </Button>
          <Button onClick={() => refetch()}>ໂຫຼດຄືນໃໝ່</Button>
          <Button danger icon={<DeleteOutlined />} disabled={!selected.length} loading={deletingMany} onClick={() => removeMany(selected, false)}>
            ລຶບທີ່ເລືອກ ({selected.length})
          </Button>
          <Button danger disabled={!orphaned.length} loading={deletingMany} onClick={() => removeMany(orphaned, true)}>
            ລຶບທັງໝົດ ({orphaned.length})
          </Button>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          ລາຍການນີ້ແມ່ນ PIN ທີ່ເຄື່ອງສະແກນລາຍງານວ່າມີລົງທະບຽນໄວ້ ແຕ່ບໍ່ກົງກັບພະນັກງານຄົນໃດໃນລະບົບເຮົາເລີຍ (ອາດເປັນຄົນທີ່ອອກໄປແລ້ວ ຫຼື PIN ທົດລອງເກົ່າ) —
          ເລືອກເຄື່ອງເພື່ອເບິ່ງ ແລະ ດຶງສະເພາະເຄື່ອງນັ້ນ. ກົດ "ດຶງຂໍ້ມູນ" ລະບົບຈະລ້າງລາຍການເກົ່າຂອງເຄື່ອງນັ້ນອອກກ່ອນ (ສະເພາະໃນລະບົບ ບໍ່ລຶບຫຍັງໃນເຄື່ອງ) ແລ້ວຂໍໃຫ້ເຄື່ອງລາຍງານລ່າສຸດ (ໃຊ້ເວລາສັກຄູ່ ບໍ່ແມ່ນທັນທີ) — ກົດ "ໂຫຼດຄືນໃໝ່" ເພື່ອເບິ່ງຜົນ.
          "ລຶບທັງໝົດ" ລຶບທຸກແຖວທີ່ສະແດງຢູ່ (ຕາມເຄື່ອງທີ່ເລືອກ)
        </Typography.Paragraph>
      </div>

      <Table
        dataSource={orphaned}
        rowKey="id"
        loading={isLoading}
        pagination={{ pageSize: 20 }}
        sticky={{ offsetHeader }}
        size="small"
        locale={{ emptyText: 'ບໍ່ພົບ ID ທີ່ບໍ່ກົງກັບລະບົບ' }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as string[]),
          preserveSelectedRowKeys: true,
          // The header box ticks one page; these reach every page.
          selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
        }}
      >
        <Table.Column
          title="ເຄື່ອງສະແກນ"
          dataIndex="serialNumber"
          render={(sn: string) => <Tag>{sn}</Tag>}
        />
        <Table.Column title="PIN" dataIndex="pin" render={(pin: string) => <Typography.Text strong>{pin}</Typography.Text>} />
        <Table.Column title="ຊື່ໃນເຄື່ອງ" dataIndex="name" render={(name?: string) => name || '-'} />
        <Table.Column
          title="ພົບລ່າສຸດ"
          dataIndex="lastSeenAt"
          render={(value: string) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '-')}
        />
        <Table.Column
          title="ຈັດການ"
          width={100}
          align="center"
          render={(_, record: OrphanedDeviceUser) => (
            <Popconfirm
              title="ລຶບ PIN ນີ້ອອກຈາກເຄື່ອງ?"
              description={`ລຶບ PIN ${record.pin} ອອກຈາກເຄື່ອງ ${record.serialNumber}`}
              okText="ລຶບ"
              cancelText="ບໍ່"
              onConfirm={() => removeOne(record)}
            >
              <Button danger size="small" icon={<DeleteOutlined />} loading={deletingId === record.id} />
            </Popconfirm>
          )}
        />
      </Table>
    </List>
  );
};
