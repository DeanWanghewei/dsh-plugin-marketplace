import { useEffect, useState } from 'react'
import { Card, Col, Row, Statistic, Table, Tag, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { api, type DownloadStats } from '../../api.js'

const { Text } = Typography

export default function Stats() {
  const [stats, setStats] = useState<DownloadStats>()
  useEffect(() => {
    void api.stats().then(setStats)
  }, [])

  if (!stats) return null

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24}>
        <Card>
          <Statistic title="累计安装次数" value={stats.total} prefix={<DownloadOutlined />} />
        </Card>
      </Col>
      <Col xs={24} md={14}>
        <Card title="插件安装榜">
          <Table
            rowKey="id"
            size="small"
            dataSource={stats.top}
            pagination={false}
            columns={[
              { title: '插件', dataIndex: 'name' },
              { title: 'ID', dataIndex: 'id' },
              { title: '安装次数', dataIndex: 'downloads' },
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} md={10}>
        <Card title="按客户端">
          {stats.byClient.length === 0 ? (
            <Text type="secondary">暂无数据</Text>
          ) : (
            stats.byClient.map((row) => (
              <p key={row.client}>
                <Tag>{row.client}</Tag> {row.downloads}
              </p>
            ))
          )}
        </Card>
        <Card title="按来源类型" style={{ marginTop: 16 }}>
          {stats.bySource.length === 0 ? (
            <Text type="secondary">暂无数据</Text>
          ) : (
            stats.bySource.map((row) => (
              <p key={row.source_type}>
                <Tag>{row.source_type}</Tag> {row.downloads}
              </p>
            ))
          )}
        </Card>
      </Col>
    </Row>
  )
}
