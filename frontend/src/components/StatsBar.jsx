import React from 'react'

export default function StatsBar({ leads }) {
    const hot = leads.filter(l => l.motivationClass === 'HOT').length
    const warm = leads.filter(l => l.motivationClass === 'WARM').length
    const cold = leads.filter(l => l.motivationClass === 'COLD').length
    const avgScore = leads.length
        ? Math.round(leads.reduce((s, l) => s + l.motivationScore, 0) / leads.length)
        : 0

    const stats = [
        { label: 'Total Leads', value: leads.length, color: 'text-white' },
        { label: '🔥 HOT', value: hot, color: 'text-red-400' },
        { label: '🌡 WARM', value: warm, color: 'text-yellow-400' },
        { label: '❄️ COLD', value: cold, color: 'text-blue-400' },
        { label: 'Avg Score', value: avgScore, color: 'text-purple-400' },
    ]

    return (
        <div className="grid grid-cols-5 gap-3">
            {stats.map(s => (
                <div key={s.label} className="glass px-4 py-3 text-center">
                    <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{s.label}</div>
                </div>
            ))}
        </div>
    )
}
