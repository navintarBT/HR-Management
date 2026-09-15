import { useState } from 'react';
import { useNotification } from '@refinedev/core';
import { Upload, Avatar, Button, type UploadProps } from 'antd';
import { UserOutlined, UploadOutlined } from '@ant-design/icons';
import { axiosInstance, API_URL, resolvePhotoUrl } from '../providers/axios';
import { palette } from '../theme/palette';

interface EmployeePhotoUploadProps {
  value?: string;
  onChange?: (url: string | undefined) => void;
}

export const EmployeePhotoUpload: React.FC<EmployeePhotoUploadProps> = ({ value, onChange }) => {
  const [loading, setLoading] = useState(false);
  const { open: notify } = useNotification();

  const customRequest: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess, onError } = options;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('photo', file as File);
      const { data } = await axiosInstance.post(`${API_URL}/employees/upload-photo`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange?.(data.url);
      onSuccess?.(data);
    } catch (err: any) {
      notify?.({ type: 'error', message: err?.response?.data?.message || 'ອັບໂຫລດຮູບບໍ່ສໍາເລັດ' });
      onError?.(err as Error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Upload name="photo" showUploadList={false} customRequest={customRequest} accept="image/png,image/jpeg,image/webp">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <Avatar size={96} src={resolvePhotoUrl(value)} icon={<UserOutlined />} style={{ backgroundColor: palette.primary }} />
        <Button icon={<UploadOutlined />} size="small" loading={loading}>
          {value ? 'ປ່ຽນຮູບ' : 'ອັບໂຫລດຮູບ'}
        </Button>
      </div>
    </Upload>
  );
};
