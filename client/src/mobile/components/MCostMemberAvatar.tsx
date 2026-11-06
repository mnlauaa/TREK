import type { TranslationFn } from '../../types';

/** Avatar or initials circle; `variant` picks the accent (member chips) or neutral (balances) tone. */
export default function MCostMemberAvatar({
  name,
  avatarUrl,
  isMe,
  variant,
  size,
  t,
}: {
  name: string;
  avatarUrl?: string | null;
  isMe: boolean;
  variant: 'accent' | 'neutral';
  size: number;
  t: TranslationFn;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="flex-none rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  const initial = isMe ? t('costs.youShort') : (name || '?').charAt(0).toUpperCase();
  const toneCls = variant === 'accent' ? 'bg-m-act text-m-actfg' : 'bg-[color:var(--m-ic)] text-m-ink';
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-full font-geist font-extrabold ${toneCls}`}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }}
    >
      {initial}
    </span>
  );
}
