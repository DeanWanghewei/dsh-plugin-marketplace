import { useEffect, useState } from 'react'
import { Card, Col, Row, Statistic, Table, Typography } from 'antd'
import { AppstoreOutlined, DownloadOutlined, OrderedListOutlined } from '@ant-design/icons'
import { api } from '../../api.js'

export default function Overview() {
  const [plugins, setPlugins] = useState(0)
  const [totalDownloads, setTotalDownloads] = useState(0)
  const [recent, setRecent] = useState<
    Array<{ id: number; at: string; actor: string; action: string; target: string }>
  >([])

  useEffect(() => {
    void api.health().then((health) => setPlugins(health.plugins))
    void api.stats().then((stats) => setTotalDownloads(stats.total))
    void api.audit(10).then(setRecent)
  }, [])

  return (
    <Row gutter={[16, 16]}>
      <Col xs={12} md={8}>
        <Card>
          <Statistic title="插件总数" value={plugins} prefix={<AppstoreOutlined />} />
        </Card>
      </Col>
      <Col xs={12} md={8}>
        <Card>
          <Statistic title="累计安装次数" value={totalDownloads} prefix={<DownloadOutlined />} />
        </Card>
      </Col>
      <Col xs={24}>
        <Card title={<Typography.Text><OrderedListOutlined /> 最近操作</Typography.Text>}>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={recent}
            columns={[
              { title: '时间', dataIndex: 'at', render: (value: string) => value.slice(0, 19).replace('T', ' ') },
              { title: '操作者', dataIndex: 'actor' },
              { title: '动作', dataIndex: 'action' },
              { title: '对象', dataIndex: 'target' },
            ]}
          />
        </Card>
      </Col>
    </Row>
  )
}
