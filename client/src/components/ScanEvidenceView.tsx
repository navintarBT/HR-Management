import { Image, Space, Tag, Typography, Empty } from 'antd';
import dayjs from 'dayjs';
import type { ScanEvidence } from '../types';
import { API_URL } from '../providers/axios';

const KIND_LABEL = { in: 'ເຂົ້າວຽກ', out: 'ອອກວຽກ' } as const;
const time = (v?: string | null) => (v ? dayjs(v).format('DD/MM HH:mm') : '-');
const src = (path: string) => `${API_URL}${path}`;

// One shift's photo evidence from the employee's app (/me): the in and out
// photos side by side, when each was taken and sent, and what to look at
// twice — sent after the day (ຍ້ອນຫຼັງ), changed since (ແກ້ໄຂ, earlier photos
// kept), or the same picture used for another shift (ຮູບຊ້ຳ).
export const ScanEvidenceView: React.FC<{ slots: Partial<Record<'in' | 'out', ScanEvidence>> }> = ({ slots }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
    {(['in', 'out'] as const).map((kind) => {
      const e = slots[kind];
      return (
        <div key={kind} style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: 8 }}>
          <Typography.Text strong>{KIND_LABEL[kind]}</Typography.Text>
          {e ? (
            <>
              <Image.PreviewGroup items={[src(e.photoUrl), ...e.history.map((h) => src(h.photoUrl))]}>
                <Image src={src(e.thumbUrl)} preview={{ src: src(e.photoUrl) }} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 8, marginTop: 6 }} />
              </Image.PreviewGroup>
              <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
                <div>ຖ່າຍ: {time(e.takenAt)}</div>
                <div>ສົ່ງ: {time(e.uploadedAt)}</div>
              </div>
              <Space size={4} wrap style={{ marginTop: 4 }}>
                {e.backdated && <Tag color="orange">ອັບໂຫຼດຍ້ອນຫຼັງ</Tag>}
                {e.editedAt && <Tag color="blue">ແກ້ໄຂ {e.history.length ? `(ຮູບເກົ່າ ${e.history.length})` : ''}</Tag>}
                {e.duplicate && <Tag color="red">ຮູບຊ້ຳກັບກະອື່ນ</Tag>}
              </Space>
              {e.note && (
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '4px 0 0' }}>
                  ໝາຍເຫດ: {e.note}
                </Typography.Paragraph>
              )}
            </>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="ບໍ່ມີຮູບ" style={{ margin: '12px 0' }} />
          )}
        </div>
      );
    })}
  </div>
);
