import type { ComponentChildren } from 'preact';

export interface PageHeaderProps {
  title: string;
  breadcrumb?: string;
  actions?: ComponentChildren;
  tabs?: ComponentChildren;
}

export function PageHeader({ title, breadcrumb, actions, tabs }: PageHeaderProps) {
  return (
    <div class="border-b border-[var(--color-border)]">
      {/* flex-wrap so the actions drop to a second line on a phone instead of
          being clipped off the right edge. Without it the primary action
          (New Task / New Agent) is unreachable below ~500px. */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 md:px-6 py-3">
        {breadcrumb && (
          <div class="flex items-center gap-2 text-[12px] text-[var(--color-text-muted)]">
            <span>{breadcrumb}</span>
            <span class="text-[var(--color-text-faint)]">›</span>
          </div>
        )}
        <h1 class="text-[14px] font-semibold text-[var(--color-text)] min-w-0">{title}</h1>
        <div class="ml-auto flex flex-wrap items-center justify-end gap-2 min-w-0">{actions}</div>
      </div>
      {tabs && (
        <div class="flex items-center gap-1 px-6 pb-2">{tabs}</div>
      )}
    </div>
  );
}

export interface TabProps {
  label: string;
  active?: boolean;
  count?: number;
  onClick?: () => void;
}

export function Tab({ label, active, count, onClick }: TabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      class={[
        'px-3 py-1 rounded-md text-[12px] transition-colors flex items-center gap-1.5',
        active
          ? 'bg-[var(--color-elevated)] text-[var(--color-text)]'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-elevated)]',
      ].join(' ')}
    >
      {label}
      {typeof count === 'number' && (
        <span class="text-[10px] text-[var(--color-text-faint)] tabular-nums">{count}</span>
      )}
    </button>
  );
}
