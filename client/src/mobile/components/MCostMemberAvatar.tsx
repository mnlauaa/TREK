const AVATAR_TONE = {
  accent: 'bg-m-act text-m-actfg',
  neutral: 'bg-[color:var(--m-ic)] text-m-ink',
  // On a chip that is itself filled with the accent: the circle turns over, or
  // it vanishes into the chip.
  onAccent: 'bg-m-actfg text-m-act',
} as const;

/**
 * Avatar or initials circle; `variant` picks the accent (member chips), the
 * neutral (balances) tone, or the inverse one for a selected chip. The initial
 * is the member's own, yours included: "You" is the label beside the circle,
 * and the word squeezed into it read "Du Du" or ran out of it in Arabic.
 */
export default function MCostMemberAvatar({
  name,
  avatarUrl,
  variant,
  size,
}: {
  name: string;
  avatarUrl?: string | null;
  variant: keyof typeof AVATAR_TONE;
  size: number;
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
  const initial = (name || '?').charAt(0).toUpperCase();
  return (
    <span
      className={`flex flex-none items-center justify-center rounded-full font-geist font-extrabold ${AVATAR_TONE[variant]}`}
      style={{ width: size, height: size, fontSize: Math.max(8, size * 0.42) }}
    >
      {initial}
    </span>
  );
}
