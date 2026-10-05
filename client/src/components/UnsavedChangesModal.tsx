import { useCallback, useEffect } from 'react';
import { useBlocker, useLocation, type BlockerFunction } from 'react-router-dom';
import { useWarnAboutChange } from '@refinedev/core';
import { Modal, Typography, Space } from 'antd';
import { ExclamationCircleFilled } from '@ant-design/icons';

// Replaces Refine's built-in <UnsavedChangesNotifier /> (which shows a plain
// window.confirm()) with an antd Modal for in-app navigation. The literal
// browser tab-close/refresh warning is still handled below via beforeunload —
// no website can restyle that one, it's always the browser's own generic text.
export const UnsavedChangesModal: React.FC = () => {
  const { warnWhen, setWarnWhen } = useWarnAboutChange();
  const location = useLocation();

  useEffect(() => {
    setWarnWhen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (!warnWhen) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [warnWhen]);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => warnWhen && currentLocation.pathname !== nextLocation.pathname,
    [warnWhen]
  );
  const blocker = useBlocker(shouldBlock);

  return (
    <Modal
      open={blocker.state === 'blocked'}
      title={
        <Space>
          <ExclamationCircleFilled style={{ color: '#faad14' }} />
          ມີການປ່ຽນແປງທີ່ຍັງບໍ່ໄດ້ບັນທຶກ
        </Space>
      }
      onOk={() => {
        setWarnWhen(false);
        blocker.proceed?.();
      }}
      onCancel={() => blocker.reset?.()}
      okText="ອອກໂດຍບໍ່ບັນທຶກ"
      cancelText="ຢູ່ໜ້ານີ້ຕໍ່"
      okButtonProps={{ danger: true }}
      centered
      maskClosable={false}
    >
      <Typography.Paragraph style={{ marginBottom: 0 }}>
        ຖ້າອອກຈາກໜ້ານີ້ ຂໍ້ມູນທີ່ທ່ານແກ້ໄຂໄວ້ຈະສູນຫາຍ. ຕ້ອງການອອກຫຼືບໍ່?
      </Typography.Paragraph>
    </Modal>
  );
};
