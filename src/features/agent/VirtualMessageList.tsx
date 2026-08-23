import { memo, useEffect, useRef, useState, type ReactNode } from 'react';

export interface VirtualListProps<T> {
  items: T[];
  itemHeightEstimate?: number;
  overscan?: number;
  threshold?: number;
  renderItem: (item: T, index: number) => ReactNode;
  keyExtractor: (item: T, index: number) => string | number;
  className?: string;
  style?: React.CSSProperties;
  autoScrollToBottom?: boolean;
}

/**
 * 轻量级虚拟滚动组件（零额外第三方依赖）
 * 当列表元素超过 threshold（默认 20 条）时启动虚拟窗口裁剪，
 * 保证长对话（100+ 轮次）下 DOM 节点数维持在常数级，实现 60 FPS 渲染。
 */
export function VirtualListInner<T>({
  items,
  itemHeightEstimate = 70,
  overscan = 5,
  threshold = 20,
  renderItem,
  keyExtractor,
  className,
  style,
  autoScrollToBottom = true,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      setScrollTop(el.scrollTop);
    };

    const updateHeight = () => {
      if (el.clientHeight > 0) {
        setContainerHeight(el.clientHeight);
      }
    };

    updateHeight();
    el.addEventListener('scroll', handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateHeight);
      resizeObserver.observe(el);
    }

    return () => {
      el.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
    };
  }, []);

  // 自动滚动到底部（使用直接赋值 scrollTop 避免 smooth 动画引发布局抖动）
  const prevItemCountRef = useRef(items.length);
  useEffect(() => {
    if (autoScrollToBottom && items.length > prevItemCountRef.current) {
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevItemCountRef.current = items.length;
  }, [items.length, autoScrollToBottom]);

  // 当数据量较少时直接渲染全部，避免不必要的计算
  if (items.length <= threshold) {
    return (
      <div ref={containerRef} className={className} style={{ overflowY: 'auto', ...style }}>
        {items.map((item, idx) => (
          <div key={keyExtractor(item, idx)}>{renderItem(item, idx)}</div>
        ))}
      </div>
    );
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeightEstimate) - overscan);
  const endIndex = Math.min(
    items.length - 1,
    Math.ceil((scrollTop + containerHeight) / itemHeightEstimate) + overscan,
  );

  const visibleItems = items.slice(startIndex, endIndex + 1);
  const topPadding = startIndex * itemHeightEstimate;
  const bottomPadding = Math.max(0, (items.length - 1 - endIndex) * itemHeightEstimate);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        overflowY: 'auto',
        position: 'relative',
        ...style,
      }}
    >
      <div style={{ height: topPadding, width: '100%' }} aria-hidden="true" />
      {visibleItems.map((item, i) => {
        const actualIndex = startIndex + i;
        return <div key={keyExtractor(item, actualIndex)}>{renderItem(item, actualIndex)}</div>;
      })}
      <div style={{ height: bottomPadding, width: '100%' }} aria-hidden="true" />
    </div>
  );
}

export const VirtualList = memo(VirtualListInner) as typeof VirtualListInner;
