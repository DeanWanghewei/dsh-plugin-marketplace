import { useEffect, useState } from 'react'
import { Card, Table, Tag } from 'antd'
import { api } from '../../api.js'

interface AuditRow {
  id: number
  at: string
  actor: string
  action: string
  target: string
  detail?: string | null
}

export default function Audit() {
  const [rows, setRows] = useState<AuditRow[]>([])
  useEffect(() => {
    void api.audit(200).then(setRows)
  }, [])

  return (
    <Card title="审计日志（全部管理操作）">
      <Table
        rowKey="id"
        size="small"
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        columns={[
          {
            title: '时间',
            dataIndex: 'at',
            width: 180,
            render: (value: string) => value.slice(0, 19).replace('T', ' '),
          },
          { title: '操作者', dataIndex: 'actor', width: 140 },
          {
            title: '动作',
            dataIndex: 'action',
            width: 150,
            render: (value: string) => <Tag>{value}</Tag>,
          },
          { title: '对象', dataIndex: 'target' },
          { title: '详情', dataIndex: 'detail' },
        ]}
      />
    </Card>
  )
}
