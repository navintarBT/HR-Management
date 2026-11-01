import { useState } from 'react';
import { List } from '@refinedev/antd';
import { useCustom, useGetIdentity, useNotification } from '@refinedev/core';
import { Table, Button, Space, Typography, Tag, Switch, Modal, DatePicker, Tooltip, Alert } from 'antd';
import { ReloadOutlined, CloudDownloadOutlined, SyncOutlined, HistoryOutlined, CheckOutlined, StopOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { Identity, ScannerDevice } from '../../types';
import { useTableStickyOffset } from '../../hooks/useTableStickyOffset';
import { API_URL, axiosInstance } from '../../providers/axios';

const { RangePicker } = DatePicker;

// A scanner normally asks for commands every 30 seconds, and sends something
// (a scan, a heartbeat upload) at least every few minutes — longer than these
// and it's flagged.
const COMMAND_POLL_STALE_MINUTES = 10;
const CONTACT_STALE_MINUTES = 60;

const formatTime = (value?: string) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '-');

// "used / capacity", turning orange then red as the scanner fills up.
const CapacityLine: React.FC<{ label: string; used?: number; max?: number }> = ({ label, used, max }) => {
  if (used == null) return null;
  const ratio = max ? used / max : 0;
  const tone = ratio >= 0.95 ? 'danger' : ratio >= 0.85 ? 'warning' : undefined;
  return (
    <div>
      <Typography.Text type="secondary">{label}: </Typography.Text>
      <Typography.Text type={tone} strong={!!tone}>
        {used.toLocaleString()}
        {max ? ` / ${max.toLocaleString()}` : ''}
      </Typography.Text>
    </div>
  );
};

// Every scanner that has talked to the system: what it reports about itself,
// whether it's actually picking up commands, how full it is, and the "ຊິງ"
// switch — a scanner with it on is sent every active employee (so new people
// only need to enroll a face/finger there) and every face/fingerprint enrolled
// on the other synced scanners, as long as it runs the same scan algorithm.
export const ScannerDevicesPage: React.FC = () => {
  const { open: notify } = useNotification();
  const { data: identity } = useGetIdentity<Identity>();
  const isAdmin = identity?.role === 'admin';
  const { ref: toolbarRef, stackTop, offsetHeader } = useTableStickyOffset();

  const { data, isLoading, refetch } = useCustom<ScannerDevice[]>({
    url: `${API_URL}/device-users/devices`,
    method: 'get',
  });
  const devices = [...(data?.data ?? [])].sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));

  const fail = (err: any) => notify?.({ type: 'error', message: err?.response?.data?.message || 'ດໍາເນີນການບໍ່ສຳເລັດ' });

  const [pulling, setPulling] = useState(false);
  const pullAll = async () => {
    setPulling(true);
    try {
      const res = await axiosInstance.post(`${API_URL}/device-users/pull`, {});
      notify?.({
        type: 'success',
        message: `ສົ່ງຄຳຂໍໄປ ${res.data.queued} ເຄື່ອງແລ້ວ — ເຄື່ອງຈະສົ່ງລາຍຊື່ ແລະ ໃບໜ້າ/ນິ້ວມືກັບມາເມື່ອມັນຖາມຫາຄຳສັ່ງຄັ້ງຕໍ່ໄປ`,
      });
    } catch (err) {
      fail(err);
    } finally {
      setPulling(false);
    }
  };

  // The hook (not static Modal.confirm) so the dialog picks up the app theme.
  const [modal, modalContext] = Modal.useModal();
  const [busySerial, setBusySerial] = useState<string | null>(null);
  const setSync = (device: ScannerDevice, enabled: boolean) => {
    modal.confirm({
      title: enabled ? `ເປີດຊິງຂໍ້ມູນໃຫ້ເຄື່ອງ ${device.serialNumber}?` : `ປິດຊິງຂໍ້ມູນຂອງເຄື່ອງ ${device.serialNumber}?`,
      content: enabled
        ? 'ລະບົບຈະສົ່ງພະນັກງານທີ່ໃຊ້ງານທັງໝົດ ແລະ ໃບໜ້າ/ນິ້ວມືທີ່ເຄື່ອງນີ້ໃຊ້ໄດ້ ໄປໃສ່ເຄື່ອງນີ້ — ຕໍ່ໄປເມື່ອເພີ່ມພະນັກງານ ຫຼື ມີຄົນລົງໃບໜ້າ/ນິ້ວມືຢູ່ເຄື່ອງອື່ນ ກໍ່ຈະສົ່ງມາເຄື່ອງນີ້ເອງ'
        : 'ເຄື່ອງນີ້ຈະບໍ່ໄດ້ຮັບພະນັກງານໃໝ່ ຫຼື ໃບໜ້າ/ນິ້ວມືຈາກເຄື່ອງອື່ນອີກ — ຂໍ້ມູນທີ່ຢູ່ໃນເຄື່ອງແລ້ວບໍ່ຖືກລຶບ',
      okText: enabled ? 'ເປີດ ແລະ ສົ່ງຂໍ້ມູນ' : 'ປິດ',
      cancelText: 'ຍົກເລີກ',
      onOk: async () => {
        setBusySerial(device.serialNumber);
        try {
          const res = await axiosInstance.patch(`${API_URL}/device-users/devices/${device.serialNumber}`, {
            syncEnabled: enabled,
            provision: enabled,
          });
          const provisioned = res.data.provisioned;
          notify?.({
            type: 'success',
            message: enabled
              ? `ເປີດແລ້ວ — ຕັ້ງຄິວ ${provisioned?.queued ?? 0} ຄຳສັ່ງ (ພະນັກງານ ${provisioned?.employees ?? 0} ຄົນ)`
              : 'ປິດຊິງຂໍ້ມູນແລ້ວ',
          });
          refetch();
        } catch (err) {
          fail(err);
        } finally {
          setBusySerial(null);
        }
      },
    });
  };

  // A serial number that turns up for the first time could be anyone posting
  // to this server, so nothing it sends counts until it's approved here.
  const setApproved = (device: ScannerDevice, approved: boolean) => {
    modal.confirm({
      title: approved ? `ອະນຸມັດເຄື່ອງ ${device.serialNumber}?` : `ບລັອກເຄື່ອງ ${device.serialNumber}?`,
      content: approved
        ? 'ກວດໃຫ້ແນ່ໃຈວ່າແມ່ນເຄື່ອງສະແກນຂອງຮ້ານແທ້ (ທຽບ serial ກັບສະຕິກເກີຫຼັງເຄື່ອງ) — ຫຼັງອະນຸມັດ ການສະແກນ ແລະ ໃບໜ້າ/ນິ້ວມືຈາກເຄື່ອງນີ້ຈະເຂົ້າລະບົບ, ອັນທີ່ເຄື່ອງເກັບໄວ້ລະຫວ່າງລໍຖ້າຈະສົ່ງເຂົ້າມາເອງ'
        : 'ການສະແກນ ແລະ ໃບໜ້າ/ນິ້ວມືຈາກເຄື່ອງນີ້ຈະບໍ່ເຂົ້າລະບົບອີກ ແລະ ປິດຊິງຂໍ້ມູນໃຫ້ — ຂໍ້ມູນທີ່ເຂົ້າມາແລ້ວບໍ່ຖືກລຶບ',
      okText: approved ? 'ອະນຸມັດ' : 'ບລັອກ',
      okButtonProps: approved ? undefined : { danger: true },
      cancelText: 'ຍົກເລີກ',
      onOk: async () => {
        setBusySerial(device.serialNumber);
        try {
          await axiosInstance.patch(`${API_URL}/device-users/devices/${device.serialNumber}`, { approved });
          notify?.({ type: 'success', message: approved ? 'ອະນຸມັດເຄື່ອງແລ້ວ' : 'ບລັອກເຄື່ອງແລ້ວ' });
          refetch();
        } catch (err) {
          fail(err);
        } finally {
          setBusySerial(null);
        }
      },
    });
  };
  const waitingCount = devices.filter((d) => !d.approved).length;

  const provision = async (device: ScannerDevice) => {
    setBusySerial(device.serialNumber);
    try {
      const res = await axiosInstance.post(`${API_URL}/device-users/devices/${device.serialNumber}/provision`, {});
      notify?.({ type: 'success', message: `ຕັ້ງຄິວ ${res.data.queued} ຄຳສັ່ງ (ພະນັກງານ ${res.data.employees} ຄົນ)` });
      refetch();
    } catch (err) {
      fail(err);
    } finally {
      setBusySerial(null);
    }
  };

  const [attDevice, setAttDevice] = useState<ScannerDevice | null>(null);
  const [attRange, setAttRange] = useState<[Dayjs, Dayjs]>(() => [dayjs().subtract(6, 'day'), dayjs()]);
  const [attLoading, setAttLoading] = useState(false);
  const pullAttendance = async () => {
    if (!attDevice) return;
    setAttLoading(true);
    try {
      await axiosInstance.post(`${API_URL}/device-users/devices/${attDevice.serialNumber}/pull-attlog`, {
        start: attRange[0].format('YYYY-MM-DD'),
        end: attRange[1].format('YYYY-MM-DD'),
      });
      notify?.({
        type: 'success',
        message: 'ສົ່ງຄຳຂໍແລ້ວ — ການສະແກນທີ່ຍັງບໍ່ມີໃນລະບົບຈະເຂົ້າມາເອງ (ອັນທີ່ມີແລ້ວຈະຖືກຂ້າມ)',
      });
      setAttDevice(null);
      refetch();
    } catch (err) {
      fail(err);
    } finally {
      setAttLoading(false);
    }
  };

  return (
    <List title="ເຄື່ອງສະແກນ" breadcrumb={false}>
      {modalContext}
      <div ref={toolbarRef} style={{ position: 'sticky', top: stackTop, zIndex: 9, background: 'var(--app-surface-bg)', paddingBottom: 16 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Button type="primary" icon={<CloudDownloadOutlined />} loading={pulling} onClick={pullAll}>
            ດຶງລາຍຊື່ ແລະ ໃບໜ້າ/ນິ້ວມືຈາກທຸກເຄື່ອງ
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
            ໂຫຼດຄືນໃໝ່
          </Button>
        </Space>
        {waitingCount > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`ມີ ${waitingCount} ເຄື່ອງລໍຖ້າອະນຸມັດ — ການສະແກນຈາກເຄື່ອງທີ່ຍັງບໍ່ອະນຸມັດຈະບໍ່ເຂົ້າລະບົບ`}
            description="ເຄື່ອງທີ່ຕິດຕໍ່ມາຄັ້ງທຳອິດຕ້ອງໃຫ້ແອດມິນອະນຸມັດກ່ອນ ເພື່ອກັນບໍ່ໃຫ້ຄົນອື່ນສົ່ງການສະແກນ ຫຼື ລາຍນິ້ວມືປອມເຂົ້າມາ. ຖ້າບໍ່ຮູ້ຈັກ serial ນັ້ນ ໃຫ້ກົດບລັອກ"
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          ເຄື່ອງທີ່ເປີດ "ຊິງ" ຈະໄດ້ຮັບພະນັກງານທີ່ໃຊ້ງານທຸກຄົນ (ພະນັກງານໃໝ່ພຽງແຕ່ໄປລົງໃບໜ້າ/ນິ້ວມືຢູ່ເຄື່ອງ) ແລະ ໃບໜ້າ/ນິ້ວມືທີ່ລົງຢູ່ເຄື່ອງອື່ນທີ່ເປີດຊິງ —
          ສະເພາະເຄື່ອງທີ່ໃຊ້ລະບົບສະແກນລຸ້ນດຽວກັນ (ເບິ່ງຖັນ "ລຸ້ນລະບົບສະແກນ"). ຄຳສັ່ງຈະໄປຮອດເຄື່ອງເມື່ອມັນຖາມຫາຄຳສັ່ງ (ປົກກະຕິທຸກ 30 ວິນາທີ)
        </Typography.Paragraph>
      </div>

      <Table
        dataSource={devices}
        rowKey="serialNumber"
        loading={isLoading}
        pagination={false}
        sticky={{ offsetHeader }}
        scroll={{ x: 'max-content' }}
        size="small"
      >
        <Table.Column
          title="ເຄື່ອງ"
          render={(_, d: ScannerDevice) => (
            <Space direction="vertical" size={0}>
              <Typography.Text strong>{d.serialNumber}</Typography.Text>
              {!d.approved && <Tag color="red">ລໍຖ້າອະນຸມັດ</Tag>}
              {!d.approved && d.blockedUploadAt && (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  ພະຍາຍາມສົ່ງຂໍ້ມູນລ່າສຸດ {formatTime(d.blockedUploadAt)} — ຍັງບໍ່ຮັບ
                </Typography.Text>
              )}
              {d.info.deviceName && <Tag>{d.info.deviceName}</Tag>}
              {d.info.ipAddress && <Typography.Text type="secondary">IP {d.info.ipAddress}</Typography.Text>}
              {d.info.firmware && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {d.info.firmware}
                </Typography.Text>
              )}
            </Space>
          )}
        />
        <Table.Column
          title="ການເຊື່ອມຕໍ່"
          render={(_, d: ScannerDevice) => {
            const sinceContact = d.lastSeenAt ? dayjs().diff(dayjs(d.lastSeenAt), 'minute') : null;
            const sincePoll = d.lastGetRequestAt ? dayjs().diff(dayjs(d.lastGetRequestAt), 'minute') : null;
            const accessControlMode = /\/iclock\/(registry|push)/.test(d.lastUnknownRequest?.path ?? '');
            return (
              <Space direction="vertical" size={2}>
                <Typography.Text>ສົ່ງຂໍ້ມູນລ່າສຸດ: {formatTime(d.lastSeenAt)}</Typography.Text>
                <Typography.Text>ຖາມຫາຄຳສັ່ງລ່າສຸດ: {formatTime(d.lastGetRequestAt)}</Typography.Text>
                {sinceContact != null && sinceContact > CONTACT_STALE_MINUTES && <Tag color="orange">ຂາດການຕິດຕໍ່</Tag>}
                {sincePoll == null ? (
                  <Tooltip title="ເຄື່ອງນີ້ບໍ່ເຄີຍຖາມຫາຄຳສັ່ງ — ດຶງ/ລຶບ/ສົ່ງພະນັກງານຈະບໍ່ໄປຮອດ. ກວດ Cloud Server Setting ໃນເຄື່ອງ">
                    <Tag color="red">ບໍ່ຮັບຄຳສັ່ງ</Tag>
                  </Tooltip>
                ) : (
                  sincePoll > COMMAND_POLL_STALE_MINUTES && <Tag color="orange">ບໍ່ໄດ້ຖາມຫາຄຳສັ່ງ {sincePoll} ນາທີ</Tag>
                )}
                {d.lastUnknownRequest &&
                  (accessControlMode ? (
                    <Tooltip title={`ເຄື່ອງສົ່ງ ${d.lastUnknownRequest.path} ມາ (${formatTime(d.lastUnknownRequest.receivedAt)}) — ລະບົບນີ້ຮັບແບບລົງເວລາ`}>
                      <Tag color="red">ເຄື່ອງຢູ່ໂໝດຄວບຄຸມປະຕູ — ປ່ຽນເປັນ TA push</Tag>
                    </Tooltip>
                  ) : (
                    <Tag color="orange">
                      ຄຳຂໍທີ່ບໍ່ຮູ້ຈັກ: {d.lastUnknownRequest.path} ({formatTime(d.lastUnknownRequest.receivedAt)})
                    </Tag>
                  ))}
              </Space>
            );
          }}
        />
        <Table.Column
          title="ຄວາມຈຸ"
          render={(_, d: ScannerDevice) =>
            d.info.userCount == null ? (
              <Typography.Text type="secondary">ຍັງບໍ່ມີຂໍ້ມູນ</Typography.Text>
            ) : (
              <>
                <CapacityLine label="ຜູ້ໃຊ້" used={d.info.userCount} max={d.info.maxUsers} />
                <CapacityLine label="ນິ້ວມື" used={d.info.fingerprintCount} max={d.info.maxFingerprints} />
                <CapacityLine label="ໃບໜ້າ" used={d.info.faceCount} max={d.info.maxFaces} />
                <CapacityLine label="ບັນທຶກສະແກນ" used={d.info.attLogCount} max={d.info.maxAttLogs} />
              </>
            )
          }
        />
        <Table.Column
          title="ລຸ້ນລະບົບສະແກນ"
          render={(_, d: ScannerDevice) =>
            d.info.fpVersion == null && d.info.faceVersion == null ? (
              '-'
            ) : (
              <Space direction="vertical" size={0}>
                {d.info.fpVersion != null && <Typography.Text>ນິ້ວມື V{d.info.fpVersion}</Typography.Text>}
                {d.info.faceVersion != null && <Typography.Text>ໃບໜ້າ {d.info.faceVersion}</Typography.Text>}
              </Space>
            )
          }
        />
        <Table.Column
          title="ຄຳສັ່ງ"
          render={(_, d: ScannerDevice) => (
            <Space direction="vertical" size={2}>
              {d.commands.pending > 0 && <Tag color="blue">ລໍຖ້າສົ່ງ {d.commands.pending}</Tag>}
              {d.commands.sent > 0 && <Tag color="gold">ສົ່ງແລ້ວ ລໍຖ້າຢືນຢັນ {d.commands.sent}</Tag>}
              {d.commands.failed > 0 && <Tag color="red">ລົ້ມເຫຼວ {d.commands.failed}</Tag>}
              <Typography.Text type="secondary">ສຳເລັດ {d.commands.acked}</Typography.Text>
            </Space>
          )}
        />
        <Table.Column
          title="ຊິງ"
          align="center"
          render={(_, d: ScannerDevice) => (
            <Switch
              checked={d.syncEnabled}
              disabled={!isAdmin || !d.approved}
              loading={busySerial === d.serialNumber}
              onChange={(checked) => setSync(d, checked)}
            />
          )}
        />
        <Table.Column
          title="ຈັດການ"
          render={(_, d: ScannerDevice) => (
            <Space direction="vertical" size={4}>
              {isAdmin && !d.approved && (
                <Button size="small" type="primary" icon={<CheckOutlined />} loading={busySerial === d.serialNumber} onClick={() => setApproved(d, true)}>
                  ອະນຸມັດເຄື່ອງນີ້
                </Button>
              )}
              {isAdmin && d.syncEnabled && (
                <Tooltip title="ສົ່ງພະນັກງານທີ່ໃຊ້ງານທັງໝົດ ແລະ ໃບໜ້າ/ນິ້ວມືທີ່ໃຊ້ໄດ້ ໄປເຄື່ອງນີ້ອີກຄັ້ງ">
                  <Button size="small" icon={<SyncOutlined />} loading={busySerial === d.serialNumber} onClick={() => provision(d)}>
                    ສົ່ງພະນັກງານອີກຄັ້ງ
                  </Button>
                </Tooltip>
              )}
              {d.approved && (
                <Button size="small" icon={<HistoryOutlined />} onClick={() => setAttDevice(d)}>
                  ດຶງການສະແກນຍ້ອນຫຼັງ
                </Button>
              )}
              {isAdmin && d.approved && (
                <Button size="small" type="text" danger icon={<StopOutlined />} onClick={() => setApproved(d, false)}>
                  ບລັອກ
                </Button>
              )}
            </Space>
          )}
        />
      </Table>

      <Modal
        title={`ດຶງການສະແກນຍ້ອນຫຼັງ — ${attDevice?.serialNumber ?? ''}`}
        open={!!attDevice}
        onOk={pullAttendance}
        onCancel={() => setAttDevice(null)}
        confirmLoading={attLoading}
        okText="ຂໍຂໍ້ມູນ"
        cancelText="ຍົກເລີກ"
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          ໃຫ້ເຄື່ອງສົ່ງການສະແກນໃນຊ່ວງນີ້ມາໃໝ່ — ໃຊ້ເມື່ອການສະແກນບາງມື້ບໍ່ເຂົ້າລະບົບ (ເຊັ່ນ ຄອມຕົວກາງປິດດົນ). ອັນທີ່ມີຢູ່ແລ້ວຈະຖືກຂ້າມ (ສູງສຸດ 62 ວັນ)
        </Typography.Paragraph>
        <RangePicker
          value={attRange}
          onChange={(v) => v && v[0] && v[1] && setAttRange([v[0], v[1]])}
          format="DD/MM/YYYY"
          allowClear={false}
          style={{ width: '100%' }}
        />
      </Modal>
    </List>
  );
};
