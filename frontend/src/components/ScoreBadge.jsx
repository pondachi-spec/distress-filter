import React from 'react'

export default function ScoreBadge({ score, cls }) {
    const classMap = {
        HOT: 'badge-hot',
        WARM: 'badge-warm',
        COLD: 'badge-cold',
    }
    const icons = { HOT: '🔥', WARM: '🌡', COLD: '❄️' }
    const className = classMap[cls] || 'badge-cold'

    return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${className}`}>
            {icons[cls]} {cls} · {score}
        </span>
    )
}
