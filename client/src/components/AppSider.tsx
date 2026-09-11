import { ThemedSiderV2, type RefineThemedLayoutV2SiderProps } from '@refinedev/antd';

// ThemedSiderV2 only pins itself to the viewport when given `fixed` — without
// it the sider scrolls away with the page content.
export const AppSider: React.FC<RefineThemedLayoutV2SiderProps> = (props) => <ThemedSiderV2 {...props} fixed />;
