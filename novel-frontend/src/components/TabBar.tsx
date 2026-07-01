/**
 * TabBar — 通用标签栏组件。
 *
 * 基于 shadcn/ui Tabs 组件，提供分段控件样式的标签切换。
 *
 * @param tabs - 标签配置数组
 * @param activeKey - 当前激活的标签 key
 * @param onChange - 标签切换回调
 */
import React from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface TabItem {
  key: string;
  label: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeKey, onChange }) => {
  return (
    <Tabs value={activeKey} onValueChange={onChange}>
      <TabsList className="w-full">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.key} value={tab.key} className="flex-1">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};
