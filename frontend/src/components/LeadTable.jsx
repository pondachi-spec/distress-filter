import React, { useState } from 'react'
import ScoreBadge from './ScoreBadge'
import api from '../api'
import toast from 'react-hot-toast'

const STATUS_COLORS = {
    new: 'text-slate-400',
    sent_to_alisha: 'text-blue-400',
    calling: 'text-yellow-400',
    qualified: 'text-green-400',
    abandoned: 'text-red-400',
}

const STATUS_LABELS = {
    new: 'New',
    sent_to_alisha: 'Sent to Alisha',
    calling: 'Calling',
    qualified: 'Qualified',
    abandoned: 'Abandoned',
}

export default function LeadTable({ leads, onRefresh }) {
    const [sending, setSending] = useState({})
    const [expandedId, setExpandedId] = useState(null)

    async function sendToAlisha(lead) {
        setSending(prev => ({ ...prev, [lead._id]: true }))
        try {
            await api.post(`/leads/${lead._id}/send-to-alisha`)
            toast.success(`${lead.ownerName} sent to Alisha!`)
            onRefresh()
        } catch (err) {
            toast.error(err.response?.data?.error || 'Failed to send to Alisha.')
        } finally {
            setSending(prev => ({ ...prev, [lead._id]: false }))
        }
    }

    async function deleteLead(id) {
        if (!window.confirm('Delete this lead?')) return
        try {
            await api.delete(`/leads/${id}`)
            toast.success('Lead deleted.')
            onRefresh()
        } catch {
            toast.error('Delete failed.')
        }
    }

    if (!leads.length) {
        return (
            <div className="glass p-12 text-center text-slate-500">
                <div className="text-4xl mb-3">🔍</div>
                <p>Run a search to find distressed properties.</p>
            </div>
        )
    }

    return (
        <div className="glass overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-white/5 text-xs text-slate-500 uppercase tracking-wider">
                            <th className="text-left px-4 py-3">Address</th>
                            <th className="text-left px-4 py-3">Owner</th>
                            <th className="text-center px-4 py-3">Equity</th>
                            <th className="text-center px-4 py-3">Score</th>
                            <th className="text-center px-4 py-3">Flags</th>
                            <th className="text-center px-4 py-3">Status</th>
                            <th className="text-center px-4 py-3">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {leads.map((lead, i) => (
                            <React.Fragment key={lead._id}>
                                <tr
                                    className={`border-b border-white/5 hover:bg-white/3 transition-colors cursor-pointer ${expandedId === lead._id ? 'bg-white/5' : ''}`}
                                    onClick={() => setExpandedId(expandedId === lead._id ? null : lead._id)}
                                >
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-white">{lead.address}</span>
                                            {lead.isDemo && (
                                                <span className="text-xs bg-yellow-400/15 border border-yellow-400/40 text-yellow-300 px-1.5 py-0.5 rounded font-semibold tracking-wide">DEMO</span>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-500">{lead.city}, {lead.state} {lead.zip}</div>
                                    </td>
                                    <td className="px-4 py-3 text-slate-300">{lead.ownerName}</td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`font-semibold ${lead.equityPercent >= 40 ? 'text-green-400' : lead.equityPercent >= 20 ? 'text-yellow-400' : 'text-red-400'}`}>
                                            {lead.equityPercent}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <ScoreBadge score={lead.motivationScore} cls={lead.motivationClass} />
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex items-center justify-center gap-1 flex-wrap">
                                            {lead.isAbsenteeOwner && <span title="Absentee Owner" className="text-xs bg-orange-500/15 border border-orange-500/30 text-orange-400 px-1.5 py-0.5 rounded">AO</span>}
                                            {lead.isPreForeclosure && <span title="Pre-Foreclosure" className="text-xs bg-red-500/15 border border-red-500/30 text-red-400 px-1.5 py-0.5 rounded">NOD</span>}
                                            {lead.isTaxDelinquent && <span title="Tax Delinquent" className="text-xs bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 px-1.5 py-0.5 rounded">TAX</span>}
                                            {lead.yearsOwned >= 10 && <span title="Long-term owner" className="text-xs bg-purple-500/15 border border-purple-500/30 text-purple-400 px-1.5 py-0.5 rounded">{lead.yearsOwned}yr</span>}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className={`text-xs font-medium ${STATUS_COLORS[lead.status] || 'text-slate-400'}`}>
                                            {STATUS_LABELS[lead.status] || lead.status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                        <div className="flex items-center justify-center gap-2">
                                            <button
                                                onClick={() => sendToAlisha(lead)}
                                                disabled={sending[lead._id] || lead.status === 'sent_to_alisha'}
                                                title="Send to Alisha"
                                                className="bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 text-blue-400 text-xs px-2.5 py-1 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                {sending[lead._id] ? '...' : '📞 Alisha'}
                                            </button>
                                            <button
                                                onClick={() => deleteLead(lead._id)}
                                                title="Delete lead"
                                                className="bg-red-600/10 hover:bg-red-600/30 border border-red-500/20 text-red-400 text-xs px-2 py-1 rounded-lg transition-all"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </td>
                                </tr>

                                {/* Expanded detail row */}
                                {expandedId === lead._id && (
                                    <tr className="bg-white/3">
                                        <td colSpan={7} className="px-6 py-4">
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                                <div>
                                                    <span className="text-slate-500 block">Est. Value</span>
                                                    <span className="text-white font-medium">${(lead.estimatedValue || 0).toLocaleString()}</span>
                                                </div>
                                                <div>
                                                    <span className="text-slate-500 block">Loan Balance</span>
                                                    <span className="text-white font-medium">${(lead.loanBalance || 0).toLocaleString()}</span>
                                                </div>
                                                <div>
                                                    <span className="text-slate-500 block">Years Owned</span>
                                                    <span className="text-white font-medium">{lead.yearsOwned} years</span>
                                                </div>
                                                <div>
                                                    <span className="text-slate-500 block">Property Type</span>
                                                    <span className="text-white font-medium">{lead.propertyType || 'N/A'}</span>
                                                </div>
                                                {lead.ownerPhone && (
                                                    <div>
                                                        <span className="text-slate-500 block">Phone</span>
                                                        <span className="text-white font-medium">{lead.ownerPhone}</span>
                                                    </div>
                                                )}
                                                <div>
                                                    <span className="text-slate-500 block">Source</span>
                                                    <span className="text-white font-medium">{lead.source}</span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
