import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Input, Space, Typography, message } from 'antd'
import { KeyOutlined } from '@ant-design/icons'
import { api, setAdminToken } from '../../api.js'

const { Title, Text } = Typography

export default function AdminLogin() {
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setLoading(true)
    try {
      setAdminToken(token.trim())
      await api.tokens()
      navigate('/admin')
    } catch {
      setAdminToken(null)
      void message.error('令牌无效或无管理员权限')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '80vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Card style={{ width: 420 }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Title level={3} style={{ marginBottom: 0 }}>
            管理员登录
          </Title>
          <Text type="secondary">粘贴管理员令牌（Bearer token）。可在服务器上用 dshm-server token create 创建。</Text>
          <Input.Password
            prefix={<KeyOutlined />}
            placeholder="管理员令牌"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            onPressEnter={submit}
          />
          <Button type="primary" block loading={loading} onClick={submit}>
            登录
          </Button>
        </Space>
      </Card>
    </div>
  )
}
