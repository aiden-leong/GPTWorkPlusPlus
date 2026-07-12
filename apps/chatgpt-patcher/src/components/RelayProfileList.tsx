// 可拖动排序的列表 - 基于 sortablejs
// 比 dnd-kit 简单很多，AntD 风格友好

import { useEffect, useRef } from "react";
import Sortable from "sortablejs";
import { Card, Space, Tag, Button, Typography, Tooltip } from "antd";
import {
  CheckCircleFilled,
  EditOutlined,
  ApiOutlined,
  SwapOutlined,
  ExperimentOutlined,
} from "@ant-design/icons";
import type { RelayProfile } from "@/lib/types";

const { Text, Paragraph } = Typography;

type Props = {
  profiles: RelayProfile[];
  activeId: string | null;
  onReorder: (newOrder: RelayProfile[]) => void;
  onEdit: (id: string) => void;
  onSwitch: (id: string) => void;
  onTest: (id: string) => void;
};

export const RelayProfileList = ({ profiles, activeId, onReorder, onEdit, onSwitch, onTest }: Props) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sortableRef = useRef<Sortable | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    sortableRef.current = Sortable.create(containerRef.current, {
      animation: 150,
      handle: ".drag-handle",
      ghostClass: "sortable-ghost",
      onEnd: (evt) => {
        const oldIdx = evt.oldIndex;
        const newIdx = evt.newIndex;
        if (oldIdx === undefined || newIdx === undefined || oldIdx === newIdx) return;
        const next = [...profiles];
        const [moved] = next.splice(oldIdx, 1);
        next.splice(newIdx, 0, moved);
        onReorder(next);
      },
    });
    return () => {
      sortableRef.current?.destroy();
    };
  }, [profiles, onReorder]);

  return (
    <div ref={containerRef}>
      {profiles.map((profile) => {
        const isActive = profile.id === activeId;
        return (
          <Card
            key={profile.id}
            size="small"
            style={{ marginBottom: 8 }}
            styles={{ body: { padding: 12 } }}
            hoverable
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="drag-handle" style={{ cursor: "grab", color: "#999" }}>
                <SwapOutlined rotate={90} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Space>
                  <Text strong>{profile.name || "(未命名)"}</Text>
                  {isActive && (
                    <Tag icon={<CheckCircleFilled />} color="success">
                      当前启用
                    </Tag>
                  )}
                  <Tag color={profile.relayMode === "official" ? "blue" : "purple"}>
                    {profile.relayMode}
                  </Tag>
                  <Tag>{profile.protocol}</Tag>
                </Space>
                <Paragraph
                  type="secondary"
                  style={{ margin: "4px 0 0", fontSize: 12 }}
                  ellipsis
                >
                  <ApiOutlined /> {profile.baseUrl || "—"}
                </Paragraph>
              </div>
              <Space>
                <Tooltip title="测试连接">
                  <Button
                    size="small"
                    icon={<ExperimentOutlined />}
                    onClick={() => onTest(profile.id)}
                  />
                </Tooltip>
                <Button
                  size="small"
                  type={isActive ? "default" : "primary"}
                  onClick={() => onSwitch(profile.id)}
                  disabled={isActive}
                >
                  {isActive ? "已启用" : "启用"}
                </Button>
                <Button size="small" icon={<EditOutlined />} onClick={() => onEdit(profile.id)}>
                  编辑
                </Button>
              </Space>
            </div>
          </Card>
        );
      })}
    </div>
  );
};
