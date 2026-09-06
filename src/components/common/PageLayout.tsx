import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import '../../styles/page-layout.css';

export function PageLayout({
  children,
  variant = 'resource',
  className = '',
}: {
  children: ReactNode;
  variant?: 'resource' | 'form';
  className?: string;
}) {
  return (
    <div className={`page-layout page-layout--${variant} ${className}`.trim()}>{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <h1>
          {Icon && <Icon aria-hidden="true" size={22} strokeWidth={1.8} />}
          {title}
        </h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-heading-actions">{actions}</div>}
    </header>
  );
}

export function PageTabs<T extends string>({
  label,
  value,
  items,
  onChange,
  children,
}: {
  label: string;
  value: T;
  items: Array<{ value: T; label: string; count?: number; icon?: LucideIcon; testId?: string }>;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <div className="page-tabs" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            type="button"
            key={item.value}
            role="tab"
            id={`${id}-${item.value}`}
            data-testid={item.testId}
            aria-selected={item.value === value}
            aria-controls={`${id}-panel`}
            tabIndex={item.value === value ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => {
              const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : direction
                      ? (index + direction + items.length) % items.length
                      : -1;
              if (nextIndex < 0) return;
              event.preventDefault();
              onChange(items[nextIndex].value);
              const tabs =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              tabs?.[nextIndex]?.focus();
            }}
          >
            {item.icon && <item.icon aria-hidden="true" size={16} strokeWidth={1.8} />}
            {item.label}
            {item.count !== undefined && <span className="page-tab-count"> ({item.count})</span>}
          </button>
        ))}
      </div>
      <section
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${value}`}
        className="page-tab-panel"
      >
        {children}
      </section>
    </>
  );
}
