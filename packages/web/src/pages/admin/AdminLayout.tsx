import { Outlet, useNavigate } from 'react-router-dom'
import { Layout, Menu, Button, Space } from 'antd'
import {
  AppstoreOutlined,
  DatabaseOutlined,
  KeyOutlined,
  LogoutOutlined,
  OrderedListOutlined,
  PieChartOutlined,
  ProfileOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { getAdminToken, setAdminToken } from '../../api.js'

const items = [
  { key: '/admin', icon: <UserOutlined />, label: '概览' },
  { key: '/admin/plugins', icon: <AppstoreOutlined />, label: '插件管理' },
  { key: '/admin/registry', icon: <DatabaseOutlined />, label: '导入 / 导出' },
  { key: '/admin/stats', icon: <PieChartOutlined />, label: '下载统计' },
  { key: '/admin/tokens', icon: <KeyOutlined />, label: '令牌管理' },
  { key: '/admin/audit', icon: <OrderedListOutlined />, label: '审计日志' },
]

export default function AdminLayout() {
  const navigate = useNavigate()
  if (!getAdminToken()) {
    navigate('/admin/login')
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="light" breakpoint="lg" collapsedWidth={0}>
        <div style={{ padding: 16, fontWeight: 600, fontSize: 16 }}>dshm 管理台</div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
      </Layout.Sider>
      <Layout.Content style={{ padding: 24, maxWidth: 1200 }}>
        <Space style={{ position: 'absolute', top: 16, right: 24 }}>
          <Button
            icon={<LogoutOutlined />}
            onClick={() => {
              setAdminToken(null)
              navigate('/admin/login')
            }}
          >
            退出
          </Button>
        </Space>
        <Outlet />
      </Layout.Content>
    </Layout>
  )
}
