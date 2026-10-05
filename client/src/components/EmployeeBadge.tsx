import { Avatar } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import type { Employee } from '../types';
import { palette, loginGradient } from '../theme/palette';
import { resolvePhotoUrl } from '../providers/axios';

// Real physical badge size — a standard lanyard-holder portrait size, close
// to CR80 (54 x 85.6mm) rounded to clean numbers. Every layout-critical
// dimension below is in mm (not px) specifically so the on-screen preview
// and the printed output are the SAME real-world size — see show.tsx's
// @page rule, which locks the printed page to exactly this.
export const EMPLOYEE_BADGE_WIDTH_MM = 55;
export const EMPLOYEE_BADGE_HEIGHT_MM = 85;

const AVATAR_DIAMETER_MM = 28;
// AntD's Avatar `size` prop only takes px — this is AVATAR_DIAMETER_MM
// converted at the CSS-standard 96px/inch, kept as a constant so it can
// only ever drift from the mm figure above by an intentional edit here.
const AVATAR_DIAMETER_PX = Math.round((AVATAR_DIAMETER_MM / 25.4) * 96); // ~106px

export const EmployeeBadge: React.FC<{ employee: Employee }> = ({ employee }) => {
  const department = employee.department && typeof employee.department === 'object' ? employee.department.name : undefined;
  const position = employee.position && typeof employee.position === 'object' ? employee.position.name : undefined;
  const fullName = `${employee.firstName ?? ''} ${employee.lastName ?? ''}`.trim() || '-';

  return (
    <div
      className="employee-badge-card"
      style={{
        width: `${EMPLOYEE_BADGE_WIDTH_MM}mm`,
        height: `${EMPLOYEE_BADGE_HEIGHT_MM}mm`,
        borderRadius: 14,
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 10px 26px rgba(159,18,57,0.28), 0 2px 8px rgba(0,0,0,0.1)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* header */}
      <div style={{ background: loginGradient, flex: `0 0 ${EMPLOYEE_BADGE_HEIGHT_MM * 0.32}mm`, position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '2.5mm' }}>
          <div
            style={{
              width: '13mm',
              height: '3mm',
              borderRadius: '3mm',
              background: 'rgba(0,0,0,0.18)',
              boxShadow: 'inset 0 0.3mm 0.8mm rgba(0,0,0,0.35)',
            }}
          />
        </div>
        <div
          style={{
            position: 'absolute',
            top: '8mm',
            left: 0,
            right: 0,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.8)',
            fontSize: '2.5mm',
            letterSpacing: '0.5mm',
            fontWeight: 600,
            textTransform: 'uppercase',
          }}
        >
          HR &amp; ລົງເວລາ
        </div>
      </div>

      {/* photo overlapping header/body seam by half its own height */}
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: `${-AVATAR_DIAMETER_MM / 2}mm` }}>
        <Avatar
          size={AVATAR_DIAMETER_PX}
          src={resolvePhotoUrl(employee.photoUrl)}
          icon={<UserOutlined />}
          style={{ backgroundColor: palette.primary, border: '1.2mm solid #fff', boxShadow: '0 2mm 5mm rgba(0,0,0,0.2)' }}
        />
      </div>

      {/* body — flex:1 fills whatever height is left, with a spacer pushing
          the ID block down to the bottom edge instead of leaving one big
          gap after the name/position/department cluster. */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '3mm 5mm 4mm', textAlign: 'center', minHeight: 0 }}>
        <div style={{ fontSize: '4.6mm', fontWeight: 700, color: '#1c1917', lineHeight: 1.25 }}>{fullName}</div>

        {position && (
          <div
            style={{
              marginTop: '2mm',
              padding: '1mm 4mm',
              borderRadius: '999px',
              background: 'rgba(159,18,57,0.09)',
              color: palette.primary,
              fontSize: '3mm',
              fontWeight: 600,
            }}
          >
            {position}
          </div>
        )}
        {department && <div style={{ marginTop: '1.5mm', fontSize: '2.8mm', color: '#8c8c8c' }}>{department}</div>}

        <div style={{ flex: 1 }} />

        <div style={{ width: '100%', borderTop: '0.35mm dashed #e5e0dc', paddingTop: '3mm' }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: '2mm' }}>
            <span style={{ fontSize: '2.3mm', color: '#a8a29e', letterSpacing: '0.4mm', textTransform: 'uppercase' }}>ID</span>
            <span style={{ fontSize: '3.8mm', fontWeight: 700, letterSpacing: '0.6mm', color: '#1c1917', fontFamily: 'monospace' }}>
              {employee.employeeCode || '-'}
            </span>
          </div>
        </div>
      </div>

      {/* footer accent */}
      <div style={{ flex: '0 0 2mm', background: `linear-gradient(90deg, ${palette.primary}, ${palette.warning})` }} />
    </div>
  );
};
