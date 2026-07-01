/**
 * BookCard — 书籍卡片组件。
 *
 * 在书库、搜索等页面展示书籍摘要信息。
 * 结构：封面占位（首字）+ 书名 + 作者 + 标签 + 可选进度条。
 *
 * @param title - 书名
 * @param author - 作者
 * @param coverUrl - 封面图 URL（可选，无则使用首字占位）
 * @param progress - 阅读进度 0-1（可选）
 * @param tags - 标签列表（可选）
 * @param onClick - 点击回调
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

export interface BookCardProps {
  title: string;
  author?: string;
  coverUrl?: string;
  progress?: number;
  tags?: string[];
  onClick?: () => void;
}

export const BookCard: React.FC<BookCardProps> = ({
  title,
  author,
  coverUrl,
  progress,
  tags,
  onClick,
}) => {
  /** 提取书名首字作为封面占位 */
  const firstChar = title.replace(/[\[\]【】《》「」\s]/g, '').charAt(0) || '书';

  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="flex gap-3 p-3 w-full h-auto text-left justify-start border border-border rounded-[10px] bg-card hover:bg-accent"
    >
      {/* 封面占位 — 首字或图片 */}
      <div
        className="w-14 h-[76px] flex-shrink-0 rounded-md flex items-center justify-center text-[26px] font-bold text-primary"
        style={{
          background: coverUrl
            ? `url(${coverUrl}) center/cover`
            : undefined,
        }}
      >
        {!coverUrl && firstChar}
      </div>

      {/* 信息区 */}
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-semibold mb-1 truncate">
          {title}
        </div>
        {author && (
          <div className="text-xs text-muted-foreground mb-1.5">
            {author}
          </div>
        )}
        {/* 标签 */}
        {tags && tags.length > 0 && (
          <div className="flex gap-1 flex-wrap mb-1.5">
            {tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px] py-0 px-1.5">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {/* 进度条 */}
        {progress !== undefined && progress > 0 && (
          <Progress value={Math.round(progress * 100)} className="h-[3px]" />
        )}
      </div>
    </Button>
  );
};
