import { useLocation } from 'react-router-dom';
import { ThemedSiderV2, type RefineThemedLayoutV2SiderProps } from '@refinedev/antd';

// Pages wide enough (lots of table columns) that the nav sider is worth
// giving up entirely for the extra width — ThemedLayoutV2's Content flexes to
// fill the space Sider would have taken once it renders nothing here.
const HIDDEN_ON_PATHS = ['/payroll-summary'];

// ThemedSiderV2 only pins itself to the viewport when given `fixed` — without
// it the sider scrolls away with the page content.
export const AppSider: React.FC<RefineThemedLayoutV2SiderProps> = (props) => {
  const location = useLocation();
  if (HIDDEN_ON_PATHS.some((path) => location.pathname.startsWith(path))) return null;
  return <ThemedSiderV2 {...props} fixed />;
};
