import React, { useState } from 'react'

const PROPERTY_TYPES = [
    { value: '', label: 'All Types' },
    { value: 'SFR', label: 'Single Family' },
    { value: 'CONDO', label: 'Condo' },
    { value: 'MFR', label: 'Multi-Family' },
    { value: 'LAND', label: 'Land' },
    { value: 'MOBILE', label: 'Mobile Home' },
]

export default function SearchPanel({ onSearch, loading }) {
    const [form, setForm] = useState({
        zipCode: '',
        propertyType: '',
        minEquity: 30,
        absenteeOwner: false,
        preForeclosure: false,
        taxDelinquent: false,
    })

    function update(field, value) {
        setForm(prev => ({ ...prev, [field]: value }))
    }

    function handleSubmit(e) {
        e.preventDefault()
        onSearch(form)
    }

    return (
        <div className="glass p-6">
            <h2 className="text-lg font-semibold text-white mb-5 flex items-center gap-2">
                <span className="text-purple-400">⚙</span> Search Criteria
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Zip Code */}
                <div>
                    <label className="block text-xs text-slate-400 mb-1">Zip Code *</label>
                    <input
                        type="text"
                        value={form.zipCode}
                        onChange={e => update('zipCode', e.target.value)}
                        placeholder="e.g. 90210"
                        maxLength={5}
                        required
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-slate-600 text-sm transition-all"
                    />
                </div>

                {/* Property Type */}
                <div>
                    <label className="block text-xs text-slate-400 mb-1">Property Type</label>
                    <select
                        value={form.propertyType}
                        onChange={e => update('propertyType', e.target.value)}
                        className="w-full bg-[#13131f] border border-white/10 rounded-lg px-3 py-2 text-white text-sm transition-all"
                    >
                        {PROPERTY_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                    </select>
                </div>

                {/* Min Equity */}
                <div>
                    <label className="block text-xs text-slate-400 mb-1">
                        Min Equity: <span className="text-purple-400 font-semibold">{form.minEquity}%</span>
                    </label>
                    <input
                        type="range"
                        min={0}
                        max={100}
                        value={form.minEquity}
                        onChange={e => update('minEquity', Number(e.target.value))}
                        className="w-full accent-purple-500"
                    />
                    <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                        <span>0%</span><span>100%</span>
                    </div>
                </div>

                {/* Toggles */}
                <div className="space-y-2 pt-1">
                    {[
                        { key: 'absenteeOwner', label: 'Absentee Owner Only', icon: '🏚' },
                        { key: 'preForeclosure', label: 'Pre-Foreclosure / NOD', icon: '⚠️' },
                        { key: 'taxDelinquent', label: 'Tax Delinquent Only', icon: '📋' },
                    ].map(({ key, label, icon }) => (
                        <label key={key} className="flex items-center justify-between cursor-pointer group">
                            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                                {icon} {label}
                            </span>
                            <div
                                onClick={() => update(key, !form[key])}
                                className={`relative w-10 h-5 rounded-full transition-all cursor-pointer ${form[key] ? 'bg-purple-600' : 'bg-white/10'}`}
                            >
                                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${form[key] ? 'left-5' : 'left-0.5'}`} />
                            </div>
                        </label>
                    ))}
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-all text-sm mt-2"
                >
                    {loading ? (
                        <span className="flex items-center justify-center gap-2">
                            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25"/>
                                <path d="M4 12a8 8 0 018-8v8" stroke="currentColor" strokeWidth="4" className="opacity-75"/>
                            </svg>
                            Searching ATTOM...
                        </span>
                    ) : '🔍 Run Distress Filter'}
                </button>
            </form>
        </div>
    )
}
