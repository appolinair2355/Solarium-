import React from 'react';

export default function Avatar({ user, size = 36, style = {}, onClick }) {
  if (!user) return null;
  const photo = user.profile_photo;
  const initial = (user.first_name || user.username || '?').trim().charAt(0).toUpperCase();

  const palette = ['#fbbf24', '#818cf8', '#34d399', '#f472b6', '#60a5fa', '#fb923c', '#a78bfa', '#22d3ee'];
  const idx = (user.id || initial.charCodeAt(0)) % palette.length;
  const bg = palette[idx];

  const base = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
    border: '2px solid rgba(255,255,255,0.15)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    cursor: onClick ? 'pointer' : 'default',
    ...style,
  };

  if (photo) {
    return (
      <span style={base} onClick={onClick} title={user.username || ''}>
        <img
          src={photo}
          alt={user.username || 'avatar'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </span>
    );
  }

  return (
    <span
      style={{
        ...base,
        background: `linear-gradient(135deg, ${bg}, ${bg}aa)`,
        color: '#0a0e1a',
        fontWeight: 800,
        fontSize: Math.round(size * 0.45),
        lineHeight: 1,
      }}
      onClick={onClick}
      title={user.username || ''}
    >
      {initial}
    </span>
  );
}
