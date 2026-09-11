import { Refine, Authenticated } from '@refinedev/core';
import {
  ThemedLayoutV2,
  ErrorComponent,
  useNotificationProvider,
} from '@refinedev/antd';
import '@refinedev/antd/dist/reset.css';
import routerBindings, {
  NavigateToResource,
  CatchAllNavigate,
  UnsavedChangesNotifier,
  DocumentTitleHandler,
} from '@refinedev/react-router-v6';
import { Route, Routes, Outlet } from 'react-router-dom';
import {
  DashboardOutlined,
  TeamOutlined,
  ApartmentOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  HistoryOutlined,
  BarChartOutlined,
  ScheduleOutlined,
  SwapOutlined,
  EditOutlined,
  TagsOutlined,
} from '@ant-design/icons';

import { dataProvider } from './providers/dataProvider';
import { authProvider } from './providers/authProvider';
import { i18nProvider } from './providers/i18nProvider';
import { ColorModeContextProvider } from './contexts/color-mode';
import { AppHeader } from './components/AppHeader';
import { AppTitle } from './components/AppTitle';
import { AppSider } from './components/AppSider';

import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { EmployeeList, EmployeeCreate, EmployeeEdit, EmployeeShow } from './pages/employees';
import { OrganizationPage } from './pages/organization';
import { AttendanceOverviewPage, AttendanceLogsPage, AttendanceDailyPage } from './pages/attendance';
import { LeaveListPage } from './pages/leaves';
import { SchedulePage } from './pages/schedule';
import { ShiftSwapListPage } from './pages/schedule/swaps';
import { BulkShiftEditPage } from './pages/schedule/bulk';
import { ShiftCategoryListPage } from './pages/schedule/categories';

function App() {
  return (
    <ColorModeContextProvider>
      <Refine
        dataProvider={dataProvider}
        authProvider={authProvider}
        i18nProvider={i18nProvider}
        routerProvider={routerBindings}
        notificationProvider={useNotificationProvider}
        resources={[
          {
            name: 'dashboard',
            list: '/',
            meta: { label: 'ແດຊບອດ', icon: <DashboardOutlined /> },
          },
          {
            name: 'employees',
            list: '/employees',
            create: '/employees/create',
            edit: '/employees/edit/:id',
            show: '/employees/show/:id',
            meta: { label: 'ພະນັກງານ', icon: <TeamOutlined /> },
          },
          {
            name: 'organization',
            list: '/organization',
            meta: { label: 'ພະແນກ / ຕໍາແໜ່ງ', icon: <ApartmentOutlined /> },
          },
          {
            name: 'attendance',
            list: '/attendance',
            meta: { label: 'ລົງເວລາ', icon: <ClockCircleOutlined /> },
          },
          {
            name: 'attendance-daily',
            list: '/attendance/daily',
            meta: { label: 'ບົດລາຍງານລາຍວັນ', icon: <BarChartOutlined />, parent: 'attendance' },
          },
          {
            name: 'attendance-logs',
            list: '/attendance/logs',
            meta: { label: 'ປະຫວັດການສະແກນ', icon: <HistoryOutlined />, parent: 'attendance' },
          },
          {
            name: 'leaves',
            list: '/leaves',
            meta: { label: 'ການລາ', icon: <CalendarOutlined /> },
          },
          {
            name: 'schedule',
            list: '/schedule',
            meta: { label: 'ຕາຕະລາງກະ', icon: <ScheduleOutlined /> },
          },
          {
            name: 'shift-swaps',
            list: '/schedule/swaps',
            meta: { label: 'ຄໍາຂໍສະຫຼັບກະ', icon: <SwapOutlined />, parent: 'schedule' },
          },
          {
            name: 'schedule-bulk',
            list: '/schedule/bulk',
            meta: { label: 'ແກ້ໄຂກະແບບກຸ່ມ', icon: <EditOutlined />, parent: 'schedule' },
          },
          {
            name: 'shift-categories',
            list: '/schedule/categories',
            meta: { label: 'ໝວດໝູ່ກະ', icon: <TagsOutlined />, parent: 'schedule' },
          },
        ]}
        options={{
          syncWithLocation: true,
          warnWhenUnsavedChanges: true,
          disableTelemetry: true,
          projectId: 'hr-system-mvp',
        }}
      >
        <Routes>
          <Route
            element={
              <Authenticated key="authenticated-layout" fallback={<CatchAllNavigate to="/login" />}>
                <ThemedLayoutV2 Header={AppHeader} Title={AppTitle} Sider={AppSider}>
                  <Outlet />
                </ThemedLayoutV2>
              </Authenticated>
            }
          >
            <Route index element={<DashboardPage />} />

            <Route path="/employees">
              <Route index element={<EmployeeList />} />
              <Route path="create" element={<EmployeeCreate />} />
              <Route path="edit/:id" element={<EmployeeEdit />} />
              <Route path="show/:id" element={<EmployeeShow />} />
            </Route>

            <Route path="/organization" element={<OrganizationPage />} />

            <Route path="/attendance">
              <Route index element={<AttendanceOverviewPage />} />
              <Route path="daily" element={<AttendanceDailyPage />} />
              <Route path="logs" element={<AttendanceLogsPage />} />
            </Route>

            <Route path="/leaves" element={<LeaveListPage />} />

            <Route path="/schedule">
              <Route index element={<SchedulePage />} />
              <Route path="swaps" element={<ShiftSwapListPage />} />
              <Route path="bulk" element={<BulkShiftEditPage />} />
              <Route path="categories" element={<ShiftCategoryListPage />} />
            </Route>

            <Route path="*" element={<ErrorComponent />} />
          </Route>

          <Route
            element={
              <Authenticated key="authenticated-auth" fallback={<Outlet />}>
                <NavigateToResource resource="dashboard" />
              </Authenticated>
            }
          >
            <Route path="/login" element={<LoginPage />} />
          </Route>
        </Routes>

        <UnsavedChangesNotifier />
        <DocumentTitleHandler handler={() => 'ລະບົບ HR ແລະ ລົງເວລາ'} />
      </Refine>
    </ColorModeContextProvider>
  );
}

export default App;
